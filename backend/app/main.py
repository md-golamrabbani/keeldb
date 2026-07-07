from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import admin, alerts, connections, explorer, introspect, mappings, migrate, portable, preview, projects, snippets

app = FastAPI(title="KeelDB", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # Web dev origins + the Tauri desktop webview origins: tauri://localhost and
    # http(s)://tauri.localhost, plus the opaque "null" origin that WebKitGTK
    # (Linux) reports for the custom tauri:// scheme. The backend only ever
    # listens on localhost, so allowing these is safe.
    allow_origin_regex=r"^(null|tauri://localhost|https?://tauri\.localhost|https?://(localhost|127\.0\.0\.1)(:\d+)?)$",
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
app.include_router(projects.router)
app.include_router(snippets.router)
app.include_router(alerts.router)
app.include_router(portable.router)


@app.get("/health")
def health():
    return {"ok": True}
