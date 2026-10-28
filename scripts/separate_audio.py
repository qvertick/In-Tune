"""Isolated, offline inference. Only --install-model performs network I/O.

Uses one trusted official checkpoint, never a registry/model-name auto downloader.
The backend runs FFmpeg before this process so cancellation has no grandchildren.
"""
import argparse
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models" / "separation" / "htdemucs"
CHECKPOINT = "955717e8-8726e21a.th"
MODEL_BYTES = 84_141_911
MODEL_URL = "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/" + CHECKPOINT
MODEL_SHA256 = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"
SEGMENT_SECONDS = 4
OVERLAP_SECONDS = 1
MAX_SECONDS = 600


def atomic_json(path, value):
    temporary = path.with_name(path.name + ".part")
    with temporary.open("w", encoding="utf-8") as target:
        json.dump(value, target, allow_nan=False)
        target.flush()
        os.fsync(target.fileno())
    temporary.replace(path)


def verify_checkpoint(path):
    if path.stat().st_size != MODEL_BYTES:
        raise ValueError("Checkpoint size mismatch; rerun explicit installation.")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    if digest.hexdigest() != MODEL_SHA256:
        raise ValueError("Checkpoint SHA-256 does not match the pinned official checkpoint catalog.")
    return digest.hexdigest()


def install_model(directory):
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / CHECKPOINT
    if destination.is_file():
        checksum = verify_checkpoint(destination)
        atomic_json(directory / "installed.json", {"checkpoint": CHECKPOINT, "bytes": MODEL_BYTES, "sha256": checksum})
        print("Official checkpoint already installed; no download.", flush=True)
        return
    print(f"Explicit download: {MODEL_BYTES:,} bytes (80.24 MiB), one htdemucs checkpoint from Meta. No other models.", flush=True)
    # HEAD is advisory; actual GET bytes and checksum are always verified.
    try:
        with urlopen(Request(MODEL_URL, method="HEAD"), timeout=30) as response:
            print("Current server Content-Length: " + str(response.headers.get("Content-Length", "unknown")), flush=True)
    except OSError:
        print("Current server size unknown; pinned expected size is 84,141,911 bytes.", flush=True)
    with tempfile.TemporaryDirectory(prefix=".install-", dir=directory) as temporary:
        staged = Path(temporary) / CHECKPOINT
        count = 0
        with urlopen(MODEL_URL, timeout=60) as response, staged.open("wb") as target:
            if response.headers.get("Content-Length") and int(response.headers["Content-Length"]) != MODEL_BYTES:
                raise ValueError("Server checkpoint size changed; download refused.")
            while block := response.read(1024 * 1024):
                count += len(block)
                if count > MODEL_BYTES:
                    raise ValueError("Checkpoint exceeds pinned byte limit.")
                target.write(block)
        checksum = verify_checkpoint(staged)
        staged.replace(destination)
        atomic_json(directory / "installed.json", {"checkpoint": CHECKPOINT, "bytes": count, "sha256": checksum})
    print(f"Installed {count:,} bytes: {destination}", flush=True)


def check_runtime():
    import torch
    import soundfile
    import demucs_infer
    from demucs_infer.pretrained import get_model  # noqa: F401
    from demucs_infer.apply import apply_model  # noqa: F401
    if "FLAC" not in soundfile.available_formats():
        raise RuntimeError("libsndfile has no FLAC encoder.")
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError("Use Python 3.12 for this optional environment.")
    marker = {"protocol": 1, "provider": "demucs-infer", "providerVersion": demucs_infer.__version__,
              "torch": torch.__version__, "python": sys.version.split()[0],
              "baseExecutable": str(Path(sys._base_executable).resolve()),
              "sitePackages": str(Path(sys.prefix) / ("Lib/site-packages" if os.name == "nt" else "lib/python3.12/site-packages"))}
    atomic_json(Path(sys.prefix) / "separation-runtime.json", marker)
    print(json.dumps(marker), flush=True)


def stream_stems(audio, predict, vocals, accompaniment, *, segment_frames, overlap_frames):
    """Bounded overlap-add. predict maps float32 [frames,channels] -> vocals.

    Only one segment, pending overlap, and model tensors occupy RAM. Same sample
    count as input, no encoder delay/padding because the final output is FLAC.
    """
    import numpy as np
    if not 0 < overlap_frames < segment_frames:
        raise ValueError("Invalid overlap.")
    hop = segment_frames - overlap_frames
    pending = pending_weight = None
    start, written = 0, 0
    while start < audio.frames:
        audio.seek(start)
        block = audio.read(min(segment_frames, audio.frames - start), dtype="float32", always_2d=True)
        length = len(block)
        if length == 0:
            raise ValueError("Truncated decoded input.")
        estimate = np.asarray(predict(block), dtype=np.float32)
        if estimate.shape != block.shape or not np.isfinite(estimate).all():
            raise ValueError("Model returned invalid samples.")
        weight = np.ones(length, dtype=np.float32)
        fade = min(overlap_frames, length)
        if start:
            weight[:fade] *= np.arange(1, fade + 1, dtype=np.float32) / (fade + 1)
        final = start + length == audio.frames
        if not final:
            weight[-fade:] *= np.arange(fade, 0, -1, dtype=np.float32) / (fade + 1)
        estimate *= weight[:, None]
        if pending is not None:
            count = len(pending)
            estimate[:count] += pending
            weight[:count] += pending_weight
        emit = length if final else hop
        normalized = estimate[:emit] / weight[:emit, None]
        # Residual accompaniment keeps the mixture's phase/level; no per-stem
        # rescaling, which would destroy relative gain. PCM24 clamps only overs.
        vocals.write(normalized)
        accompaniment.write(block[:emit] - normalized)
        written += emit
        if final:
            break
        pending = estimate[emit:].copy()
        pending_weight = weight[emit:].copy()
        start += hop
    if written != audio.frames:
        raise ValueError("Stem sample count differs from source.")
    return written


def infer(source, output, model_dir, device="cpu"):
    verify_checkpoint(model_dir / CHECKPOINT)
    import numpy as np
    import soundfile as sf
    import torch
    from demucs_infer.pretrained import get_model
    from demucs_infer.apply import apply_model

    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable; install a matching PyTorch CUDA wheel or use CPU.")
    # Explicit LocalRepo signature bypasses the network/registry resolver. Only
    # one model, no bags/ensembles, no pretrained fallback, no hub downloads.
    model = get_model("955717e8", repo=model_dir).eval().to(device)
    if model.samplerate != 44100 or model.audio_channels != 2 or set(model.sources) != {"drums", "bass", "other", "vocals"}:
        raise ValueError("Unexpected checkpoint architecture.")
    # HTDemucs normally pads to its training segment, even for short inputs.
    # Disable that padding explicitly to honor our 4 second memory bound.
    model.use_train_segment = False
    index = model.sources.index("vocals")

    def predict(block):
        reference = block.mean(axis=1)
        mean, deviation = float(reference.mean()), float(reference.std())
        if deviation < 1e-8:
            return np.zeros_like(block)
        mix = torch.from_numpy(np.ascontiguousarray(((block - mean) / deviation).T)).unsqueeze(0)
        with torch.inference_mode():
            result = apply_model(model, mix, device=device, shifts=0, split=False, num_workers=0)
        return (result[0, index].cpu().numpy().T * deviation + mean).copy()

    output.mkdir(parents=True, exist_ok=True)
    with ExitStack() as stack:
        audio = stack.enter_context(sf.SoundFile(str(source)))
        if audio.channels != 2 or audio.samplerate != 44100 or not 0 < audio.frames <= MAX_SECONDS * 44100:
            raise ValueError("Expected stereo 44.1 kHz decoded audio up to 10 minutes.")
        writers = [stack.enter_context(sf.SoundFile(str(output / f"{stem}.flac"), "w", samplerate=44100,
                    channels=2, format="FLAC", subtype="PCM_24")) for stem in ("vocals", "accompaniment")]
        frames = stream_stems(audio, predict, *writers, segment_frames=SEGMENT_SECONDS * 44100,
                              overlap_frames=OVERLAP_SECONDS * 44100)
    # Validate actual encoded files without loading whole tracks.
    for stem in ("vocals", "accompaniment"):
        info = sf.info(str(output / f"{stem}.flac"))
        if info.frames != frames or info.samplerate != 44100 or info.channels != 2:
            raise ValueError("Encoded stem has invalid timing or format.")
    atomic_json(output / "result.json", {"frames": frames, "sampleRate": 44100, "offsetSeconds": 0})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--install-model", action="store_true")
    mode.add_argument("--check-runtime", action="store_true")
    parser.add_argument("--model-dir", type=Path, default=MODEL_DIR)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--site-packages", type=Path, help="Trusted isolated environment packages when using direct Python -I -S")
    args = parser.parse_args()
    if args.site_packages:
        if not args.site_packages.is_dir():
            parser.error("Isolated package directory is missing.")
        sys.path.insert(0, str(args.site_packages.resolve()))
    try:
        if args.install_model:
            install_model(args.model_dir)
        elif args.check_runtime:
            check_runtime()
        elif args.input and args.output_dir:
            infer(args.input, args.output_dir, args.model_dir, args.device)
        else:
            parser.error("Supply --input and --output-dir, or an explicit installer/check mode.")
    except Exception as exc:
        print(f"Separation failed: {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
