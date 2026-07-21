from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from ..ai import DEFAULT_MODELS, PROVIDER_LABELS, _resolve
from ..models import AiProvider, AiSettings
from ..store import ai_settings_store

router = APIRouter(prefix="/ai", tags=["ai"])


class AiSettingsIn(BaseModel):
    provider: AiProvider = "anthropic"
    model: str = ""
    api_key: str = ""  # empty on update = keep the stored key


def _public() -> dict:
    s = ai_settings_store.get()
    _, key, model = _resolve()
    return {
        "provider": s.provider,
        "model": s.model,
        "effective_model": model,
        "has_key": bool(key),
        "providers": [{"value": v, "label": lbl, "default_model": DEFAULT_MODELS[v]} for v, lbl in PROVIDER_LABELS.items()],
    }


@router.get("/settings")
def get_settings():
    return _public()


@router.get("/settings/key")
def reveal_key():
    """Return the stored API key so the local UI can show it on demand. This is a
    single-user desktop app; the key never leaves the machine. `_public()`
    deliberately omits it so it isn't sent on every settings fetch."""
    return {"api_key": ai_settings_store.get().api_key}


@router.put("/settings")
def put_settings(req: AiSettingsIn):
    existing = ai_settings_store.get()
    key = req.api_key or existing.api_key  # blank keeps the stored secret
    ai_settings_store.save(AiSettings(provider=req.provider, model=req.model.strip(), api_key=key))
    return _public()
