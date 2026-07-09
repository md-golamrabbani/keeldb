from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import auth
from .api import admin, ai, alerts, auth as auth_api, connections, diagrams, explorer, introspect, mappings, migrate, portable, preview, projects, snippets

app = FastAPI(title="KeelDB", version="0.1.0")


# Auth gate — registered BEFORE CORS so CORS stays the outermost middleware and
# still attaches headers to 401s (otherwise the browser sees an opaque CORS error
# instead of a clean 401). No-op unless KEELDB_PASSWORD is set.
@app.middleware("http")
async def require_auth(request: Request, call_next):
    if auth.enabled() and request.method != "OPTIONS":
        path = request.url.path
        # /migrate/export/<id> is a file download opened via the browser (can't
        # carry an auth header); the random export id acts as the capability.
        if not (path.startswith("/auth/") or path == "/health" or path.startswith("/migrate/export/")):
            hdr = request.headers.get("authorization", "")
            token = hdr[7:] if hdr[:7].lower() == "bearer " else ""
            if not auth.verify_token(token):
                return JSONResponse({"detail": "authentication required"}, status_code=401)
    return await call_next(request)


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

app.include_router(auth_api.router)
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
app.include_router(ai.router)
app.include_router(diagrams.router)


@app.get("/health")
def health():
    return {"ok": True}
