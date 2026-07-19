# Desktop app (Tauri)

Packages the whole app — Next.js UI + the Python/FastAPI backend — into a native
desktop app for **Windows, macOS, and Linux**. The Python backend is frozen with
**PyInstaller** and shipped as a Tauri **sidecar**; the Rust shell starts it on a
free localhost port, points it at the OS app-data folder, and shuts it down on exit.

The web app is unchanged — `npm run dev` + `uvicorn` still work exactly as before.
This is an additive, opt-in build path (branch `desktop-tauri`).

## Prerequisites (per build machine)
- **Rust** (`rustup`), **Node 20+**, **Python 3.12+**
- **Tauri CLI**: installed via `npm ci` in `frontend/` (`@tauri-apps/cli`)
- Linux only: `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
- Tauri **cannot cross-compile** — build Windows on Windows, macOS on macOS, Linux on Linux
  (or use the GitHub Actions workflow in `.github/workflows/desktop.yml`, which does all three).

## One-time: app icons
Tauri needs icon files. Generate them from any square PNG:
```bash
cd frontend
npx @tauri-apps/cli icon path/to/logo.png   # writes src-tauri/icons/*
```

## Build (per OS)
From the repo root:

**1. Freeze the Python backend into a sidecar binary**
```bash
# macOS / Linux
bash backend/build_sidecar.sh
# Windows (PowerShell)
powershell -File backend\build_sidecar.ps1
```
This produces `backend/dist/migration-backend` (`.exe` on Windows).

**2. Copy it into Tauri's sidecar folder, named with your Rust target triple**
```bash
TRIPLE=$(rustc -Vv | grep '^host:' | cut -d' ' -f2)   # e.g. x86_64-unknown-linux-gnu
cp backend/dist/migration-backend "frontend/src-tauri/binaries/migration-backend-$TRIPLE"
# Windows: copy backend\dist\migration-backend.exe to
#          frontend\src-tauri\binaries\migration-backend-<triple>.exe
```

**3. Build the desktop app**
```bash
cd frontend
npm ci
npm run tauri build
```
Installers land in `frontend/src-tauri/target/release/bundle/` —
`.dmg` (macOS), `.msi`/`.exe` (Windows), `.AppImage`/`.deb`/`.rpm` (Linux).

## Develop
```bash
# build the sidecar once (steps 1–2 above), then:
cd frontend
npm run tauri dev
```

## How it fits together
- `backend/run_server.py` — sidecar entrypoint; takes a port arg, reads `DBMS_DATA_DIR`.
- `backend/migration-backend.spec` — PyInstaller recipe (bundles psycopg, pymysql, cryptography, paramiko, …).
- `frontend/src-tauri/` — Rust shell: `src/lib.rs` finds a free port, spawns the sidecar,
  exposes `backend_port`, kills it on close.
- `frontend/lib/backend.ts` — the UI resolves the backend URL: `/api` proxy in the browser,
  `http://127.0.0.1:<port>` in the desktop app.
- `TAURI=1 next build` → static export in `frontend/out/`, which Tauri bundles.

## Signing (later, for distribution)
Unsigned builds run fine locally/internally. To distribute without OS warnings:
- **macOS**: Apple Developer Program ($99/yr) → notarization.
- **Windows**: a code-signing cert (or Azure Trusted Signing).
- **Linux**: none required.
Add the signing config to `tauri.conf.json` / the workflow when ready.
