#!/usr/bin/env bash
# Build the x86_64 (Intel) PyInstaller sidecar on an Apple-Silicon runner.
#
# Why: PyInstaller only emits host-arch binaries, and our native deps
# (psycopg[binary], pydantic-core, bcrypt, pynacl) ship no universal2 wheels,
# so neither `lipo` nor PyInstaller's universal2 target can produce a single
# fat sidecar. Instead we build a clean single-arch x86_64 sidecar here using a
# standalone x86_64 CPython run under Rosetta 2 — letting one arm64 macOS runner
# emit both the Apple-Silicon and Intel .dmg with no dependence on the
# (unreliable) hosted Intel runner. Fixes #51.
#
# Produces dist/keeldb-backend as an x86_64 Mach-O.
set -euo pipefail
cd "$(dirname "$0")"

# Rosetta 2 lets the x86_64 interpreter run on Apple Silicon (no-op if present).
sudo softwareupdate --install-rosetta --agree-to-license >/dev/null 2>&1 || true

# Resolve a standalone x86_64 macOS CPython 3.12 (python-build-standalone).
asset=$(curl -fsSL https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest \
  | grep -oE 'https://[^"]*cpython-3\.12\.[0-9]+\+[0-9]+-x86_64-apple-darwin-install_only\.tar\.gz' \
  | head -1)
if [ -z "$asset" ]; then
  echo "ERROR: could not resolve an x86_64 CPython build-standalone asset" >&2
  exit 1
fi
echo "Fetching x86_64 CPython: $asset"
curl -fsSL "$asset" -o /tmp/py-x64.tar.gz
rm -rf /tmp/py-x64 && mkdir -p /tmp/py-x64
tar -xzf /tmp/py-x64.tar.gz -C /tmp/py-x64   # install_only extracts to python/
PYTHON="/tmp/py-x64/python/bin/python3"

# Execute the interpreter to confirm it's x86_64 AND that Rosetta can run it —
# fail loudly rather than silently shipping an arm64 binary.
arch=$("$PYTHON" -c 'import platform; print(platform.machine())')
echo "Interpreter arch: $arch"
if [ "$arch" != "x86_64" ]; then
  echo "ERROR: interpreter reports '$arch', expected x86_64" >&2
  exit 1
fi

PYTHON="$PYTHON" bash build_sidecar.sh

echo "Sidecar arch: $(file dist/keeldb-backend)"
if ! file dist/keeldb-backend | grep -q x86_64; then
  echo "ERROR: built sidecar is not x86_64" >&2
  exit 1
fi
