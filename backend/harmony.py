"""Independent, experimental 24-triad baseline; not an arrangement estimator.

Input is the mono, 16 kHz, signed 16-bit PCM WAV from audio.decode_audio.
Only a window, its spectrum/chroma and a pending change are retained; there is
no spectrogram or frame history. Returned intervals alone grow with duration.
Thresholds are rejection heuristics, not calibrated confidence probabilities.
Polyphony, harmonics, tuning and inversions can all defeat this simple baseline.

NumPy API reference: https://numpy.org/doc/stable/reference/generated/numpy.fft.rfft.html
NumPy is BSD-3-Clause licensed: https://numpy.org/doc/stable/license.html
No external model, copied implementation or network access is used.
"""

from copy import deepcopy
import math
import wave
from uuid import uuid4

import numpy as np

from .audio import AnalysisError, MAX_SECONDS


RATE = 16000
FFT_SIZE = 8192
HOP = 4096
MIN_SAMPLES = 1024
SILENCE_RMS = 0.003
MIN_SCORE = 0.80
MIN_MARGIN = 0.08
ROOTS = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
TRIADS = tuple(
    (root + suffix, (pitch, (pitch + third) % 12, (pitch + 7) % 12))
    for pitch, root in enumerate(ROOTS)
    for suffix, third in (("", 4), ("m", 3))
)


def _classify(samples, window, bins, pitches):
    if len(samples) < MIN_SAMPLES:
        return None
    samples = samples.astype(np.float64) / 32768.0
    samples -= samples.mean()
    if np.sqrt(np.mean(samples * samples)) < SILENCE_RMS:
        return None
    # Short input is windowed over its actual support, then zero padded by rfft.
    taper = window if len(samples) == FFT_SIZE else np.hanning(len(samples))
    power = np.abs(np.fft.rfft(samples * taper, n=FFT_SIZE)) ** 2
    chroma = np.bincount(pitches, weights=power[bins], minlength=12)
    norm = float(np.linalg.norm(chroma))
    if not norm:
        return None
    scores = [float(chroma[list(notes)].sum()) / (math.sqrt(3) * norm)
              for _, notes in TRIADS]
    best = int(np.argmax(scores))
    runner_up = sorted(scores)[-2]
    notes = TRIADS[best][1]
    # Require evidence for all three notes; a lone note/fifth is not a triad.
    if (scores[best] < MIN_SCORE or scores[best] - runner_up < MIN_MARGIN
            or min(chroma[list(notes)]) < 0.08 * chroma.sum()):
        return None
    return TRIADS[best][0]


def analyze_chords(wav_path, check):
    """Return contiguous {name: str | None, start: float, end: float} intervals.

    check() is called before opening, per window, and before returning; any
    cancellation exception propagates unchanged and closes the file. Invalid,
    empty, truncated or over-limit WAVs raise AnalysisError. Very short valid
    audio returns an unknown interval. Changes need two consecutive windows;
    timestamps are approximate (window 512 ms, hop 256 ms).
    """
    check()
    window = np.hanning(FFT_SIZE)
    frequencies = np.fft.rfftfreq(FFT_SIZE, d=1 / RATE)
    bins = np.flatnonzero((frequencies >= 65) & (frequencies <= 2000))
    midi = 69 + 12 * np.log2(frequencies[bins] / 440)
    # Ignore bins far from equal-tempered note centers, reducing leakage/noise.
    in_tune = np.abs(midi - np.rint(midi)) <= 0.35
    bins = bins[in_tune]
    pitches = np.rint(midi[in_tune]).astype(int) % 12
    intervals = []
    current = pending = None
    current_start = pending_start = 0.0
    pending_count = 0
    initialized = False
    try:
        with wave.open(str(wav_path), "rb") as audio:
            if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth(),
                    audio.getcomptype()) != (1, RATE, 2, "NONE"):
                raise AnalysisError("Chord analysis requires mono 16 kHz 16-bit PCM WAV.")
            total = audio.getnframes()
            duration = total / RATE
            if not 0 < duration <= MAX_SECONDS:
                raise AnalysisError("Chord analysis requires nonempty audio up to 10 minutes.")
            data = audio.readframes(FFT_SIZE)
            position = 0
            span_start = 0.0
            while True:
                check()
                expected = min(FFT_SIZE, total - position)
                if len(data) != expected * 2:
                    raise AnalysisError("Truncated PCM WAV data during chord analysis.")
                label = _classify(np.frombuffer(data, dtype="<i2"), window, bins, pitches)
                if not initialized:
                    current = label
                    initialized = True
                elif label == current:
                    pending_count = 0
                else:
                    if pending_count and pending == label:
                        pending_count += 1
                    else:
                        pending, pending_start, pending_count = label, span_start, 1
                    if pending_count >= 2:
                        intervals.append({"name": current, "start": current_start,
                                          "end": pending_start})
                        current, current_start = label, pending_start
                        pending_count = 0
                if position + FFT_SIZE >= total:
                    break
                span_start = min(duration, (position + FFT_SIZE / 2 + HOP / 2) / RATE)
                position += HOP
                data = data[HOP * 2:] + audio.readframes(HOP)
            intervals.append({"name": current, "start": current_start, "end": duration})
    except (OSError, EOFError, wave.Error) as exc:
        raise AnalysisError("Could not read PCM WAV for chord analysis.") from exc
    check()
    return intervals


def attach_intervals(song: dict, intervals):
    """Return a separate Song dict with an added experimental timeline section.

    Existing text, words, chords and metadata remain untouched. Each interval
    becomes an empty model line with start; known chords have offset 0 and their
    original start/end. Unknowns have no chord occurrence. This intentionally
    avoids inferring lyric alignment or song structure. Reject capacity overflow
    rather than silently dropping intervals or exceeding the v1 contract.
    """
    result = deepcopy(song)
    rows = []
    last_end = 0.0
    names = {name for name, _ in TRIADS}
    for interval in intervals:
        name, start, end = interval["name"], interval["start"], interval["end"]
        if (name is not None and name not in names
                or type(start) not in (int, float) or type(end) not in (int, float)
                or not math.isfinite(start) or not math.isfinite(end)
                or start < last_end or end <= start or end > MAX_SECONDS):
            raise AnalysisError("Invalid chord interval.")
        rows.append((name, float(start), float(end)))
        last_end = end
        if len(rows) > 2000:
            raise AnalysisError("Chord timeline exceeds the v1 line limit.")
    if not rows:
        return result
    sections, palette = result["sections"], result["palette"]
    lines = [line for section in sections for line in section["lines"]]
    existing = {entry["name"]: entry["id"] for entry in palette}
    needed = {name for name, _, _ in rows if name is not None} - existing.keys()
    known_count = sum(name is not None for name, _, _ in rows)
    if (len(sections) >= 200 or len(lines) + len(rows) > 2000
            or len(palette) + len(needed) > 200
            or sum(len(line["chords"]) for line in lines) + known_count > 20000):
        raise AnalysisError("Chord timeline exceeds v1 document limits.")
    for name in sorted(needed):
        identifier = str(uuid4())
        palette.append({"id": identifier, "name": name})
        existing[name] = identifier
    added = []
    for name, start, end in rows:
        chords = [] if name is None else [{"id": str(uuid4()), "paletteId": existing[name],
                                           "offset": 0, "source": "model",
                                           "start": start, "end": end}]
        added.append({"id": str(uuid4()), "text": "", "start": start,
                      "source": "model", "chords": chords})
    sections.append({"id": str(uuid4()), "name": "Experimental chord timeline", "lines": added})
    return result
