# Optional local transcription model

Transcription requires an explicitly installed provider and a complete local
CTranslate2 Whisper tiny model. Neither API startup nor an analysis request
downloads models. Chord jobs use NumPy and FFmpeg and do not require Whisper.

Run from the project root, using the same Python environment as the server:

```powershell
backend/.venv/Scripts/python -m pip install -r backend/requirements-audio.txt
backend/.venv/Scripts/python -m backend.providers --install-model --revision d90ca5fe260221311c53c58e660288d3deb8d356
```

These are opt-in commands; no package or model installation was performed during
this implementation. The installer stages the download, checks the required
files, and then moves it into `models/whisper-tiny` at the project root. It
refuses to replace an existing destination. A complete manually supplied local
snapshot at the same location also works. Keep `tokenizer.json` with the weights
so no remote tokenizer fallback is needed.

## Verified upstream file sizes

Checked on 2026-10-25 through the official
[Hugging Face model metadata API](https://huggingface.co/api/models/Systran/faster-whisper-tiny?blobs=true).
Repository: `Systran/faster-whisper-tiny`.
Revision: `d90ca5fe260221311c53c58e660288d3deb8d356`.
These are upstream file sizes, not a measurement of local installed files or RAM.

| Required file | Bytes |
| --- | ---: |
| `model.bin` | 75,538,270 |
| `config.json` | 2,249 |
| `tokenizer.json` | 2,203,239 |
| `vocabulary.txt` | 459,861 |
| Total required files | **78,203,619** |

The four required files occupy approximately **78.20 MB / 74.58 MiB** before
filesystem overhead. The upstream README adds 1,991 bytes; download cache
metadata can add more. The published LFS SHA-256 for `model.bin` is
`dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1`.
The installer checks completeness; it does not independently verify that hash.

## Provider, resources and health

Optional direct runtime pins are `faster-whisper==1.2.1` and
`ctranslate2==4.8.4`, verified against their official
[faster-whisper metadata](https://pypi.org/pypi/faster-whisper/1.2.1/json) and
[CTranslate2 metadata](https://pypi.org/pypi/ctranslate2/4.8.4/json).
`requirements-audio.txt` is not a full transitive lock. Base runtime versions
are in `requirements-lock.txt`; test dependencies are separate in
`requirements-dev.txt`.

The provider uses CPU int8, two CPU threads, one worker, one cached model,
beam size 1 and `local_files_only=True`. See the official
[loading implementation](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py)
and [CTranslate2 quantization documentation](https://opennmt.net/CTranslate2/quantization.html).
Audio is limited to ten minutes; decoding uses temporary mono 16 kHz WAV files.
RAM use and inference speed were not measured because no model was installed.
Singing and overlapping instruments may reduce transcription accuracy.

`GET /api/health` checks provider distribution metadata and whether all required
model files exist and are nonempty, without importing inference libraries.
`providerAvailable` and `modelInstalled` do not certify valid weights, CPU support
or successful inference. Missing dependencies/models produce Russian job errors.

## Licenses

- faster-whisper uses the [MIT license](https://github.com/SYSTRAN/faster-whisper/blob/master/LICENSE).
- The converted tiny model is marked MIT on its [official model card](https://huggingface.co/Systran/faster-whisper-tiny).
- CTranslate2 uses the [MIT license](https://github.com/OpenNMT/CTranslate2/blob/master/LICENSE).
- NumPy uses [BSD-3-Clause](https://numpy.org/doc/stable/license.html).
- FFmpeg licensing depends on the supplied build; consult its
  [official legal documentation](https://ffmpeg.org/legal.html).

Retain applicable notices when distributing libraries or model files.
