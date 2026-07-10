# Building the KeelDB desktop app (Tauri)

How to produce native installers for **Linux**, **macOS**, and **Windows**.
The app has two halves that get bundled together:

1. **Backend sidecar** — the Python/FastAPI backend, frozen into a single
   executable with PyInstaller (`backend/migration-backend.spec`).
2. **Tauri shell** — the Next.js UI (static export) inside a Rust/WebView
   window that launches the sidecar on a free localhost port and stops it on exit.

> **Tauri cannot cross-compile.** Build each OS **on that OS** — Linux
> installers on Linux, `.dmg` on a Mac, `.msi`/`.exe` on Windows.
> Same repo, same commands; only the prerequisites differ.

---

## 1. Prerequisites (all platforms)

| Tool | Version | Check |
|---|---|---|
| Node.js | 20+ | `node -v` |
| Rust (via [rustup](https://rustup.rs)) | stable | `rustc -V` |
| Python | 3.12+ | `python3 --version` |

The Tauri CLI itself comes from `npm ci` in `frontend/` (`@tauri-apps/cli`) — no
global install needed.

### Linux — Fedora
```bash
sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel gcc gcc-c++ make patchelf \
  rpm-build dpkg
```
(`dpkg` lets Fedora also produce the `.deb`; `rpm-build` is for the `.rpm`.)

### Linux — Ubuntu / Debian
```bash
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

### macOS
```bash
xcode-select --install        # Xcode Command Line Tools (clang, codesign)
```
Nothing else — WebKit ships with the OS.

### Windows
1. **Microsoft Visual Studio Build Tools** (or VS Community) with the
   **“Desktop development with C++”** workload — gives Rust its MSVC linker.
2. **WebView2 Runtime** — pre-installed on Windows 10/11; the installer
   bootstraps it for users who lack it.
3. Use **PowerShell** for the commands below.

---

## 2. Build the backend sidecar (once per OS / per backend change)

The sidecar binary must match the OS **and** be named with the Rust
[target triple](https://doc.rust-lang.org/rustc/platform-support.html).

**Linux / macOS**
```bash
bash backend/build_sidecar.sh
# → backend/dist/keeldb-backend

TRIPLE=$(rustc -Vv | grep '^host:' | cut -d' ' -f2)
cp backend/dist/keeldb-backend "frontend/src-tauri/binaries/keeldb-backend-$TRIPLE"
```
Typical triples: `x86_64-unknown-linux-gnu` (Linux x64),
`aarch64-apple-darwin` (Apple Silicon), `x86_64-apple-darwin` (Intel Mac).

**Windows (PowerShell)**
```powershell
powershell -ExecutionPolicy Bypass -File backend\build_sidecar.ps1
# → backend\dist\keeldb-backend.exe

$triple = (rustc -Vv | Select-String '^host:').ToString().Split(' ')[1]
Copy-Item backend\dist\keeldb-backend.exe "frontend\src-tauri\binaries\keeldb-backend-$triple.exe"
```

> Rebuild the sidecar whenever backend Python code or `requirements.txt` changes —
> the Tauri build does **not** do this automatically.

---

## 3. Build the desktop app

Same on every OS:

```bash
cd frontend
npm ci                # first time / after dependency changes
npm run tauri build
```

`tauri build` runs `npm run build:tauri` (static Next.js export) first, then
compiles the Rust shell and bundles everything with the sidecar
(`externalBin: binaries/keeldb-backend` in `src-tauri/tauri.conf.json`).

### Where the installers land

Everything goes to `frontend/src-tauri/target/release/bundle/`:

| OS | Output |
|---|---|
| Linux | `deb/KeelDB_<ver>_amd64.deb` · `rpm/KeelDB-<ver>-1.x86_64.rpm` |
| macOS | `dmg/KeelDB_<ver>_<arch>.dmg` · `macos/KeelDB.app` |
| Windows | `nsis/KeelDB_<ver>_x64-setup.exe` · `msi/KeelDB_<ver>_x64_en-US.msi` |

Targets are pinned in `tauri.conf.json` (`"targets": ["deb","rpm","nsis","msi","dmg","app"]`).
AppImage is intentionally excluded — `linuxdeploy` is unreliable on Fedora; add
`"appimage"` back to the list if you need it and have FUSE set up.

### Install / test locally

```bash
# Fedora
sudo dnf install ./frontend/src-tauri/target/release/bundle/rpm/KeelDB-*.rpm
# Ubuntu/Debian
sudo apt install ./frontend/src-tauri/target/release/bundle/deb/KeelDB_*_amd64.deb
```
macOS: open the `.dmg`, drag to Applications. Windows: run the NSIS `-setup.exe`.

---

## 4. Development mode (hot reload)

```bash
# sidecar must exist (section 2), then:
cd frontend
npm run tauri dev     # starts `next dev` + the Tauri window together
```

Plain web development is unchanged and needs no Rust at all:
`uvicorn app.main:app` in `backend/` + `npm run dev` in `frontend/`.

---

## 5. Icons & version

- **Icon**: regenerate all platform icons from one square PNG:
  `cd frontend && npx tauri icon ../logo.png` (writes `src-tauri/icons/*`).
- **Version**: bump `"version"` in `frontend/src-tauri/tauri.conf.json`
  (shown in installers and used by the in-app update check against GitHub Releases).

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `failed to run linuxdeploy` | That's the AppImage target — it's already removed from the default targets; ignore, or install FUSE if you re-enable it. |
| Rust errors about `tauri-plugin-dialog` | Run `cargo fetch` inside `src-tauri/` or just re-run `npm run tauri build` — the crate downloads on first build after the file-picker feature was added. |
| `keeldb-backend-<triple>` not found | Section 2 wasn't run on this machine, or the triple in the filename doesn't match `rustc -Vv \| grep host`. |
| Ubuntu "Unknown publisher / Potentially unsafe" | Normal for any third-party package; only store publishing removes it (see below). |
| Next.js `prerender-manifest.json` ENOENT in dev | A production build clobbered `.next` while `next dev` was running: stop the dev server, `rm -rf frontend/.next`, start dev again. |
| PyInstaller sidecar won't start on target machine | Build on the **oldest** OS you want to support — PyInstaller binaries aren't backward-compatible with older glibc/macOS versions. |

---

## 7. Signing & auto-update (not set up)

Installers are currently **unsigned**, so macOS Gatekeeper and Windows
SmartScreen will warn on first launch. Removing those warnings requires:

- **Windows**: an OV/EV code-signing certificate (~$100–400/yr) → set
  `bundle.windows.certificateThumbprint` in `tauri.conf.json`.
- **macOS**: an Apple Developer ID ($99/yr) + notarization → set
  `APPLE_CERTIFICATE`/`APPLE_ID` env vars for `tauri build`.
- **Auto-update**: Tauri's updater plugin + a signed update manifest hosted
  somewhere (e.g. GitHub Releases). The app already shows an "Update available"
  pill in the header when a newer GitHub Release exists.
