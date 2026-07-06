"""Desktop sidecar entrypoint.

The Tauri shell launches this (frozen by PyInstaller) with a free port as the
first argument, e.g. `migration-backend 51763`. It also sets DBMS_DATA_DIR to
the OS app-data folder so connection/mapping profiles persist there.

Run standalone for testing:  python run_server.py 8010
"""
from __future__ import annotations

import sys

import uvicorn

from app.main import app  # imported eagerly so PyInstaller bundles the whole app


def main() -> None:
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
