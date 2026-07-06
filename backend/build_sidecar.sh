#!/usr/bin/env bash
# Build the PyInstaller sidecar binary for the current OS (macOS / Linux).
# Produces dist/migration-backend
set -euo pipefail
cd "$(dirname "$0")"

python3 -m venv .build-venv
. .build-venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt pyinstaller
pyinstaller --noconfirm --clean migration-backend.spec
echo "Built: $(pwd)/dist/migration-backend"
