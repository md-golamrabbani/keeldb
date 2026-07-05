from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import connections, introspect, mappings, migrate, preview

app = FastAPI(title="Universal DB Migration Studio", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(connections.router)
app.include_router(introspect.router)
app.include_router(preview.router)
app.include_router(migrate.router)
app.include_router(mappings.router)


@app.get("/health")
def health():
    return {"ok": True}
