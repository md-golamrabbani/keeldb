# Build the PyInstaller sidecar binary on Windows. Produces dist\keeldb-backend.exe
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

python -m venv .build-venv
& .\.build-venv\Scripts\Activate.ps1
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt pyinstaller
pyinstaller --noconfirm --clean migration-backend.spec
Write-Host "Built: $PSScriptRoot\dist\keeldb-backend.exe"
