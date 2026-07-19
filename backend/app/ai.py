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
import ssl
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


# A real User-Agent is required — Groq/OpenAI sit behind Cloudflare, which blocks
# the default "Python-urllib/x" signature (error 1010).
_UA = "KeelDB/1.0 (+https://github.com/md-golamrabbani/MigrationStudio)"


def _ssl_context() -> ssl.SSLContext:
    """Build a verifying SSL context that works everywhere the desktop app runs.

    The packaged sidecar on a fresh (or corporate) PC frequently hit
    "SSL: CERTIFICATE_VERIFY_FAILED ... unable to get local issuer certificate".
    Two independent causes: (a) a frozen Python that can't reach the OS trust
    store, and (b) an antivirus / corporate proxy that intercepts TLS with a
    private root CA that only lives in the OS store. No single source fixes both,
    so we layer three, verification always ON:

      1. OS-native trust store via `truststore` — includes the machine's own
         roots (so corporate/AV interception proxies validate) and uses a
         different code path than CPython's default, which is what failed.
      2. certifi's bundled public roots — deterministic, works even when a
         frozen build genuinely can't read the OS store.
      3. Python's default resolution — last resort.
    """
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:
        pass
    try:
        import certifi
        cafile = certifi.where()
        if cafile and os.path.exists(cafile):
            return ssl.create_default_context(cafile=cafile)
    except Exception:
        pass
    return ssl.create_default_context()


_SSL_CTX = _ssl_context()


def _post(url: str, headers: dict, body: dict) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={**headers, "content-type": "application/json", "accept": "application/json", "user-agent": _UA},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45, context=_SSL_CTX) as r:
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


_DBML_SYSTEM = (
    "You are a database schema designer working in DBML (Database Markup Language, "
    "as used by dbdiagram.io). You receive the current DBML source of a diagram and an "
    "instruction. Apply the instruction and return the COMPLETE updated DBML source.\n"
    "Rules:\n"
    "- Return ONLY DBML — no explanation, no markdown fences.\n"
    "- Preserve all existing tables, columns, refs and notes unless the instruction says to change them.\n"
    "- Use standard DBML: Table name { col type [pk, increment, not null, unique, note: '...'] }, "
    "Ref: a.col > b.col (many-to-one), < (one-to-many), - (one-to-one).\n"
    "- Prefer snake_case names, sensible types (int, bigint, varchar(255), text, timestamp, boolean, decimal(10,2), json), "
    "an integer 'id' primary key on new tables, and created_at/updated_at timestamps where they make sense."
)


def edit_dbml(dbml: str, instruction: str) -> dict:
    """AI diagram assistant: apply a natural-language instruction to a DBML
    schema and return the full updated source (never executed anywhere)."""
    if not instruction.strip():
        raise ValueError("give the assistant an instruction")
    provider, key, model = _resolve()
    if not key:
        return {"available": False, "dbml": "",
                "message": "AI assist is not configured. Choose a provider and add an API key in AI settings."}
    prompt = (
        f"Current DBML:\n```\n{dbml.strip() or '// (empty diagram)'}\n```\n\n"
        f"Instruction: {instruction}\n\nUpdated DBML:"
    )
    try:
        text = _call_llm(provider, key, model, _DBML_SYSTEM, prompt)
    except Exception as exc:
        detail = str(exc)
        if isinstance(exc, urllib.error.HTTPError):
            try:
                detail = exc.read().decode()[:300]
            except Exception:
                pass
        return {"available": True, "dbml": "", "message": f"{PROVIDER_LABELS.get(provider, provider)} error: {detail}"}
    m = re.search(r"```(?:dbml)?\s*(.+?)```", text, re.DOTALL | re.IGNORECASE)
    out = (m.group(1) if m else text).strip()
    return {"available": True, "dbml": out, "model": model, "provider": provider}


def explain_error(connector: Connector, schema: str, sql: str, error: str) -> dict:
    """Explain a failed query in plain language, with the user's actual schema
    for context, and suggest a corrected statement when possible."""
    if not error.strip():
        raise ValueError("no error to explain")
    provider, key, model = _resolve()
    if not key:
        return {"available": False, "explanation": "",
                "message": "AI assist is not configured. Choose a provider and add an API key in AI settings."}
    dialect = connector.engine.dialect.name
    system = (
        f"You are a {dialect} expert helping a developer debug a failed SQL statement. "
        "Explain in 2-4 short sentences what went wrong and how to fix it, referring to the "
        "schema when relevant. If a corrected statement is possible, end with it in a ```sql fence. "
        "Be direct and practical — no preamble."
    )
    prompt = (
        f"Schema:\n{_describe_schema(connector, schema)}\n\n"
        f"SQL that failed:\n{sql.strip()[:2000]}\n\n"
        f"Error message:\n{error.strip()[:1000]}"
    )
    try:
        text = _call_llm(provider, key, model, system, prompt)
    except Exception as exc:
        detail = str(exc)
        if isinstance(exc, urllib.error.HTTPError):
            try:
                detail = exc.read().decode()[:300]
            except Exception:
                pass
        return {"available": True, "explanation": "", "message": f"{PROVIDER_LABELS.get(provider, provider)} error: {detail}"}
    m = re.search(r"```sql\s*(.+?)```", text, re.DOTALL | re.IGNORECASE)
    return {
        "available": True,
        "explanation": re.sub(r"```sql.*?```", "", text, flags=re.DOTALL | re.IGNORECASE).strip(),
        "suggested_sql": (m.group(1).strip() if m else ""),
        "model": model,
    }


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
