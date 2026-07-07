# PyInstaller spec — freezes the FastAPI backend into a single self-contained
# executable used as the Tauri desktop "sidecar".
#   Build:  pyinstaller --noconfirm migration-backend.spec
#   Output: dist/migration-backend  (or dist/migration-backend.exe on Windows)
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas, binaries, hiddenimports = [], [], []

# Pull in everything these packages need (data files, compiled libs, submodules).
for pkg in (
    "psycopg", "psycopg_binary", "sqlalchemy", "pymysql", "cryptography",
    "paramiko", "sshtunnel", "fastapi", "starlette", "uvicorn", "anyio",
    "pydantic", "pydantic_core",
):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

hiddenimports += collect_submodules("uvicorn")
hiddenimports += ["app.main", "app"]

a = Analysis(
    ["run_server.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "PyQt5", "PySide6"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="keeldb-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,        # no console window on Windows; Tauri still pipes stdio
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
