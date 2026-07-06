from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import admin, connections, explorer, introspect, mappings, migrate, preview

app = FastAPI(title="Universal DB Migration Studio", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # Web dev origins + the Tauri desktop webview origins (tauri://localhost on
    # macOS/Linux, http(s)://tauri.localhost on Windows). The regex covers them
    # all; the backend only ever listens on localhost so this is safe.
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|tauri://localhost|https?://tauri\.localhost)$",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(connections.router)
app.include_router(introspect.router)
app.include_router(preview.router)
app.include_router(migrate.router)
app.include_router(mappings.router)
app.include_router(explorer.router)
app.include_router(admin.router)


@app.get("/health")
def health():
    return {"ok": True}
