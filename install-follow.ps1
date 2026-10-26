param([ValidateSet('ru','uk','en')][string]$Language='ru')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
if (Test-Path '.venv/Scripts/python.exe') {
    $pythonPath=Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
    & $pythonPath -m pip install -r backend/requirements-follow.txt
} else {
    $pythonPath=(Get-Command python).Source
    & $pythonPath -m pip install --target backend/.deps -r backend/requirements-follow.txt
}
if ($LASTEXITCODE -ne 0) {throw 'Vosk package installation failed.'}
$env:PYTHONPATH=Join-Path $PSScriptRoot 'backend/.deps'
& $pythonPath -m backend.follow_provider --install-model $Language
if ($LASTEXITCODE -ne 0) {throw 'Model installation failed.'}
Write-Host 'Ready. Restart the server, open Performance and start voice following.'
