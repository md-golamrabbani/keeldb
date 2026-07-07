"""AI assist — natural-language → SQL, provider-configurable.

Works with Anthropic (Claude), OpenAI (ChatGPT), or Groq — chosen in AI settings
with an API key. All calls go over plain HTTPS (stdlib urllib), so no provider
SDK is required. When no key is configured it degrades gracefully. The model is
given the schema and asked for a single read-only SELECT, returned for the user
to review and run — the AI never executes anything.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

import sqlalchemy as sa

from .connectors.base import Connector
from .store import ai_settings_store

_MAX_TABLES = 40
DEFAULT_MODELS = {
    "anthropic": "claude-opus-4-8",
    "openai": "gpt-4o-mini",
    "groq": "llama-3.3-70b-versatile",
}
PROVIDER_LABELS = {"anthropic": "Claude (Anthropic)", "openai": "ChatGPT (OpenAI)", "groq": "Groq"}


def _resolve() -> tuple[str, str, str]:
    s = ai_settings_store.get()
    key = s.api_key or (os.environ.get("ANTHROPIC_API_KEY", "").strip() if s.provider == "anthropic" else "")
    model = s.model or DEFAULT_MODELS.get(s.provider, "")
    return s.provider, key, model


def _describe_schema(connector: Connector, schema: str) -> str:
    insp = sa.inspect(connector.engine)
    sch = schema or None
    lines = []
    for t in insp.get_table_names(schema=sch)[:_MAX_TABLES]:
        cols = [f"{c['name']} {c['type']}" for c in insp.get_columns(t, schema=sch)]
        lines.append(f"{t}({', '.join(cols)})")
    return "\n".join(lines)


def _strip_fences(text: str) -> str:
    m = re.search(r"```(?:sql)?\s*(.+?)```", text, re.DOTALL | re.IGNORECASE)
    return (m.group(1) if m else text).strip().rstrip(";").strip()


def _post(url: str, headers: dict, body: dict) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={**headers, "content-type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode())


def _call_llm(provider: str, key: str, model: str, system: str, prompt: str) -> str:
    if provider == "anthropic":
        data = _post(
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": key, "anthropic-version": "2023-06-01"},
            {"model": model, "max_tokens": 1000, "system": system,
             "messages": [{"role": "user", "content": prompt}]},
        )
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    base = "https://api.openai.com/v1" if provider == "openai" else "https://api.groq.com/openai/v1"
    data = _post(
        f"{base}/chat/completions",
        {"authorization": f"Bearer {key}"},
        {"model": model, "max_tokens": 1000,
         "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]},
    )
    return data["choices"][0]["message"]["content"]


def nl_to_sql(connector: Connector, schema: str, question: str) -> dict:
    if not question.strip():
        raise ValueError("ask a question")
    provider, key, model = _resolve()
    if not key:
        return {"available": False, "sql": "",
                "message": "AI assist is not configured. Choose a provider and add an API key in AI settings."}

    dialect = connector.engine.dialect.name
    system = (
        f"You translate natural-language questions into a single {dialect} SQL SELECT query. "
        "Return ONLY the SQL — no explanation, no markdown fences. The query must be read-only "
        "(SELECT or WITH). Use only the tables and columns provided."
    )
    prompt = f"Schema:\n{_describe_schema(connector, schema)}\n\nQuestion: {question}\n\nSQL:"
    try:
        text = _call_llm(provider, key, model, system, prompt)
    except Exception as exc:
        detail = str(exc)
        if isinstance(exc, urllib.error.HTTPError):
            try:
                detail = exc.read().decode()[:300]
            except Exception:
                pass
        return {"available": True, "sql": "", "message": f"{PROVIDER_LABELS.get(provider, provider)} error: {detail}"}
    return {"available": True, "sql": _strip_fences(text), "model": model, "provider": provider}
