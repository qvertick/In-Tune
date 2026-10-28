param(
    [switch]$DownloadModel,
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    throw 'Install FFmpeg and add it to PATH before installing separation.'
}
& $Python -c "import sys; assert sys.version_info[:2] == (3,12) and sys.maxsize > 2**32, 'Use 64-bit Python 3.12'"
if ($LASTEXITCODE -ne 0) { throw '64-bit Python 3.12 is required.' }
$separationEnv = Join-Path $PSScriptRoot '.venv-separation'
$separationPython = Join-Path $separationEnv 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $separationPython)) {
    & $Python -m venv $separationEnv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated separation environment.' }
}
$previousPythonPath = $env:PYTHONPATH
$previousPythonHome = $env:PYTHONHOME
try {
    Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
    Write-Host 'Installing optional CPU runtime only in .venv-separation. PyTorch/dependencies are large; model weights are separate.'
    & $separationPython -I -m pip install -r backend/requirements-separation-cpu.txt
    if ($LASTEXITCODE -ne 0) { throw 'CPU PyTorch installation failed.' }
    & $separationPython -I -m pip install -r backend/requirements-separation.txt
    if ($LASTEXITCODE -ne 0) { throw 'Separation provider installation failed.' }
    & $separationPython -I scripts/separate_audio.py --check-runtime
    if ($LASTEXITCODE -ne 0) { throw 'Separation runtime imports failed.' }
    if ($DownloadModel) {
        Write-Host 'Explicit download: one official Meta htdemucs checkpoint, checked HEAD size 84,141,911 bytes (80.24 MiB).'
        & $separationPython -I scripts/separate_audio.py --install-model
        if ($LASTEXITCODE -ne 0) { throw 'Checkpoint installation failed.' }
    } else {
        Write-Host 'No model downloaded. To install the single checkpoint, run .\install-separation.ps1 -DownloadModel.'
    }
    & $separationPython -I -m pip freeze | Set-Content -LiteralPath (Join-Path $separationEnv 'installed-requirements.txt') -Encoding utf8
} finally {
    $env:PYTHONPATH = $previousPythonPath
    $env:PYTHONHOME = $previousPythonHome
}
Write-Host 'Optional separation setup finished. CPU is the default. See docs/SEPARATION.md.'
