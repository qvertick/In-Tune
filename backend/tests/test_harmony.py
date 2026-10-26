import copy
import wave
from uuid import uuid4

import numpy as np
import pytest

from backend import harmony
from backend.audio import AnalysisError, Cancelled
from backend.harmony import analyze_chords, attach_intervals
from backend.schema import Song


def tone(notes, seconds, amplitude=0.6):
    time = np.arange(round(seconds * 16000)) / 16000
    if not notes:
        return np.zeros(len(time), dtype="<i2")
    signal = sum(np.sin(2 * np.pi * (440 * 2 ** ((note - 69) / 12)) * time)
                 for note in notes) / len(notes)
    return (signal * amplitude * 32767).astype("<i2")


def wav(tmp_path, *parts):
    path = tmp_path / "input.wav"
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        for part in parts:
            audio.writeframes(part.tobytes())
    return path


def analyze(path):
    return analyze_chords(path, lambda: None)


@pytest.mark.parametrize("notes,name", [([60, 64, 67], "C"), ([57, 60, 64], "Am")])
def test_real_triad(tmp_path, notes, name):
    assert analyze(wav(tmp_path, tone(notes, 2))) == [
        {"name": name, "start": 0.0, "end": 2.0}]


@pytest.mark.parametrize("name,notes", harmony.TRIADS)
def test_all_24_templates_with_real_audio(tmp_path, name, notes):
    # Put every pitch class in the same octave, including inverted voicings.
    assert analyze(wav(tmp_path, tone([60 + note for note in notes], 1)))[0]["name"] == name


def test_ambiguous_relative_triads_are_unknown(tmp_path):
    assert analyze(wav(tmp_path, tone([57, 60, 64, 67], 2))) == [
        {"name": None, "start": 0.0, "end": 2.0}]


@pytest.mark.parametrize("notes,amplitude", [([], 0.6), ([60], 0.6),
                                            ([60, 67], 0.6), ([60, 64, 67], 0.001)])
def test_silence_weak_and_incomplete_chords_are_unknown(tmp_path, notes, amplitude):
    assert analyze(wav(tmp_path, tone(notes, 2, amplitude))) == [
        {"name": None, "start": 0.0, "end": 2.0}]


def test_noise_is_unknown(tmp_path):
    noise = np.random.default_rng(7).integers(-8000, 8000, 32000, dtype="<i2")
    assert analyze(wav(tmp_path, noise)) == [{"name": None, "start": 0.0, "end": 2.0}]


def test_changes_and_unknown_have_contiguous_bounded_times(tmp_path):
    result = analyze(wav(tmp_path, tone([60, 64, 67], 2), tone([], 2), tone([57, 60, 64], 2)))
    assert [row["name"] for row in result] == ["C", None, "Am"]
    assert result[0]["start"] == 0.0 and result[-1]["end"] == 6.0
    for before, after in zip(result, result[1:]):
        assert before["end"] == after["start"]
    assert abs(result[1]["start"] - 2) <= 0.512
    assert abs(result[2]["start"] - 4) <= 0.512
    assert all(set(row) == {"name", "start", "end"} for row in result)


def test_direct_chord_change(tmp_path):
    result = analyze(wav(tmp_path, tone([60, 64, 67], 2), tone([57, 60, 64], 2)))
    assert result[0]["name"] == "C" and result[-1]["name"] == "Am"
    assert abs(result[-1]["start"] - 2) <= 0.512


def test_brief_change_is_smoothed(tmp_path):
    result = analyze(wav(tmp_path, tone([60, 64, 67], 2), tone([57, 60, 64], 0.1),
                         tone([60, 64, 67], 2)))
    assert result == [{"name": "C", "start": 0.0, "end": 4.1}]


@pytest.mark.parametrize("seconds", [1 / 16000, 0.02, 0.3, 8192 / 16000, 0.9])
def test_short_valid_audio_has_no_zero_length_or_past_end_intervals(tmp_path, seconds):
    result = analyze(wav(tmp_path, tone([60, 64, 67], seconds)))
    assert result[0]["start"] == 0 and result[-1]["end"] == seconds
    assert all(row["start"] < row["end"] <= seconds for row in result)
    if seconds < 1024 / 16000:
        assert result[0]["name"] is None


def test_empty_corrupt_missing_and_truncated_wav(tmp_path):
    with pytest.raises(AnalysisError):
        analyze(tmp_path / "absent.wav")
    path = wav(tmp_path)
    with pytest.raises(AnalysisError):
        analyze(path)
    path.write_bytes(b"not a wav")
    with pytest.raises(AnalysisError):
        analyze(path)
    path = wav(tmp_path, tone([60, 64, 67], 2))
    path.write_bytes(path.read_bytes()[:-100])
    with pytest.raises(AnalysisError, match="Truncated"):
        analyze(path)


@pytest.mark.parametrize("channels,rate,width", [(2, 16000, 2), (1, 44100, 2), (1, 16000, 1)])
def test_wrong_format(tmp_path, channels, rate, width):
    path = tmp_path / "wrong.wav"
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(channels)
        audio.setframerate(rate)
        audio.setsampwidth(width)
        audio.writeframes(bytes(1000 * width * channels))
    with pytest.raises(AnalysisError, match="mono 16 kHz"):
        analyze(path)


def test_duration_bound(tmp_path, monkeypatch):
    monkeypatch.setattr(harmony, "MAX_SECONDS", 1)
    with pytest.raises(AnalysisError, match="10 minutes"):
        analyze(wav(tmp_path, tone([], 2)))


def test_cancellation_before_open_and_during_stream(tmp_path):
    def cancel():
        raise Cancelled()

    with pytest.raises(Cancelled):
        analyze_chords(tmp_path / "absent", cancel)
    path = wav(tmp_path, tone([60, 64, 67], 3))
    calls = 0

    def check():
        nonlocal calls
        calls += 1
        if calls == 4:
            raise Cancelled()

    with pytest.raises(Cancelled):
        analyze_chords(path, check)
    assert calls == 4
    assert analyze(path)[0]["name"] == "C"


def test_reads_are_bounded_and_file_closes_on_cancel(tmp_path, monkeypatch):
    path = wav(tmp_path, tone([60, 64, 67], 3))
    original = wave.open
    reads, closed = [], []

    class Reader:
        def __init__(self):
            self.audio = original(str(path), "rb")

        def __getattr__(self, name):
            return getattr(self.audio, name)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.audio.close()
            closed.append(True)

        def readframes(self, count):
            assert count in (8192, 4096)
            reads.append(count)
            return self.audio.readframes(count)

    monkeypatch.setattr(harmony.wave, "open", lambda *args: Reader())
    analyze(path)
    assert reads[0] == 8192 and reads[1:] == [4096] * (len(reads) - 1)

    def cancel():
        if len(reads) > 1:
            raise Cancelled()

    reads.clear()
    with pytest.raises(Cancelled):
        analyze_chords(path, cancel)
    assert closed == [True, True]


def document():
    palette_id = str(uuid4())
    return {"schemaVersion": 1, "id": str(uuid4()), "title": "Manual", "artist": "Artist",
            "language": "en", "palette": [{"id": palette_id, "name": "C"}],
            "sections": [{"id": str(uuid4()), "name": "Verse", "lines": [
                {"id": str(uuid4()), "text": "🎵 Hello", "manuallyEdited": True,
                 "words": [{"text": "Hello", "start": 0.0, "end": 1.0}],
                 "chords": [{"id": str(uuid4()), "paletteId": palette_id, "offset": 2,
                             "source": "manual", "manuallyEdited": True}]}]}],
            "performance": {"fontSize": 24, "bpm": 120, "beats": 4}, "audio": None,
            "updatedAt": "2026-10-25T10:00:00Z", "source": "manual"}


def test_attach_separate_timeline_preserves_manual_text_words_and_chords():
    song = document()
    before = copy.deepcopy(song)
    intervals = [{"name": name, "start": float(i), "end": float(i + 1)}
                 for i, name in enumerate(["C", None, "Am"])]
    result = attach_intervals(song, intervals)
    Song.model_validate(result)
    assert song == before
    assert result["sections"][:-1] == song["sections"]
    assert result["palette"][:1] == song["palette"]
    assert len(result["palette"]) == 2
    added = result["sections"][-1]["lines"]
    assert all(line["text"] == "" and line["source"] == "model" for line in added)
    assert added[1]["start"] == 1.0 and added[1]["chords"] == []
    assert added[0]["chords"][0]["paletteId"] == song["palette"][0]["id"]
    assert added[2]["chords"][0]["start"] == 2 and added[2]["chords"][0]["end"] == 3
    assert added[2]["chords"][0]["offset"] == 0
    result["sections"][0]["lines"][0]["text"] = "changed copy"
    assert song == before


def test_empty_attach_returns_independent_copy():
    song = document()
    result = attach_intervals(song, [])
    assert result == song and result is not song
    assert result["sections"] is not song["sections"]


@pytest.mark.parametrize("rows", [
    [{"name": "C7", "start": 0, "end": 1}],
    [{"name": "C", "start": -1, "end": 1}],
    [{"name": "C", "start": 1, "end": 1}],
    [{"name": "C", "start": 0, "end": float("nan")}],
    [{"name": "C", "start": 0, "end": float("inf")}],
    [{"name": "C", "start": 0, "end": 601}],
    [{"name": "C", "start": 0, "end": 2}, {"name": None, "start": 1, "end": 3}],
])
def test_attach_rejects_invalid_intervals_without_mutation(rows):
    song = document()
    before = copy.deepcopy(song)
    with pytest.raises(AnalysisError):
        attach_intervals(song, rows)
    assert song == before


@pytest.mark.parametrize("limit", ["sections", "lines", "palette", "chords", "intervals"])
def test_attach_v1_capacity_limits(limit):
    song = document()
    rows = [{"name": "Am", "start": 0.0, "end": 1.0}]
    if limit == "sections":
        song["sections"] = [{"id": str(uuid4()), "name": "Manual", "lines": []}
                            for _ in range(200)]
    elif limit == "lines":
        song["sections"][0]["lines"] = [{"id": str(uuid4()), "text": "", "chords": []}
                                          for _ in range(2000)]
    elif limit == "palette":
        song["palette"].extend({"id": str(uuid4()), "name": "C"} for _ in range(199))
    elif limit == "chords":
        song["sections"][0]["lines"] = [
            {"id": str(uuid4()), "text": "", "chords": [
                {"id": str(uuid4()), "paletteId": song["palette"][0]["id"],
                 "offset": 0, "source": "manual"} for _ in range(2000)]}
            for _ in range(10)]
    else:
        rows = [{"name": None, "start": i / 10, "end": (i + 1) / 10}
                for i in range(2001)]
    Song.model_validate(song)
    before = copy.deepcopy(song)
    with pytest.raises(AnalysisError, match="limit"):
        attach_intervals(song, rows)
    assert song == before
