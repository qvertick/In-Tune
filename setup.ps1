$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
python -m venv .venv
if ($LASTEXITCODE -ne 0) { throw 'Python 3.12+ is required.' }
& .\.venv\Scripts\python.exe -m pip install -r backend/requirements-lock.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if ($pnpmCommand) { $pnpmPath = $pnpmCommand.Source }
else {
    $bundledPnpm = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm.cmd'
    if (Test-Path -LiteralPath $bundledPnpm) { $pnpmPath = $bundledPnpm }
    else { throw 'Install Node.js 22+ and pnpm 11.25.0, then run setup.ps1 again.' }
}
Push-Location frontend
try {
    & $pnpmPath install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    & $pnpmPath run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
Write-Host 'Ready. Start: .\.venv\Scripts\python.exe run.py'
