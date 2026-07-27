#!/usr/bin/env bash
# Build the PyInstaller sidecar binary for the current OS (macOS / Linux).
# Produces dist/keeldb-backend
#
# Honours $PYTHON to pick the interpreter — used to build the Intel (x86_64)
# slice on an Apple-Silicon runner via a standalone x86_64 CPython under Rosetta
# (see build_sidecar_macos_x86_64.sh). Defaults to python3.
set -euo pipefail
cd "$(dirname "$0")"

"${PYTHON:-python3}" -m venv .build-venv
. .build-venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt pyinstaller
pyinstaller --noconfirm --clean migration-backend.spec
echo "Built: $(pwd)/dist/keeldb-backend"
