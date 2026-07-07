"""AI assist — natural-language → SQL.

Optional: enabled only when the `anthropic` package is installed AND an API key
is configured (ANTHROPIC_API_KEY). Otherwise every call degrades gracefully with
available=false and a clear message, so the rest of the app never depends on it.

The model is given the schema (tables + columns) and asked for a single read-only
SELECT. We still return the SQL for the user to review and run themselves — the AI
never executes anything.
"""
from __future__ import annotations

import os
import re

import sqlalchemy as sa

from .connectors.base import Connector

DEFAULT_MODEL = os.environ.get("DBMS_AI_MODEL", "claude-opus-4-8")
_MAX_TABLES = 40


def _api_key() -> str:
    return os.environ.get("ANTHROPIC_API_KEY", "").strip()


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


def nl_to_sql(connector: Connector, schema: str, question: str) -> dict:
    if not question.strip():
        raise ValueError("ask a question")
    key = _api_key()
    if not key:
        return {"available": False, "sql": "",
                "message": "AI assist is not configured. Set ANTHROPIC_API_KEY on the backend to enable it."}
    try:
        import anthropic
    except ImportError:
        return {"available": False, "sql": "",
                "message": "AI assist needs the 'anthropic' package installed on the backend."}

    dialect = connector.engine.dialect.name
    schema_desc = _describe_schema(connector, schema)
    system = (
        f"You translate natural-language questions into a single {dialect} SQL SELECT query. "
        "Return ONLY the SQL — no explanation, no markdown fences. The query must be read-only "
        "(SELECT or WITH). Use only the tables and columns provided."
    )
    prompt = f"Schema:\n{schema_desc}\n\nQuestion: {question}\n\nSQL:"

    client = anthropic.Anthropic(api_key=key)
    resp = client.messages.create(
        model=DEFAULT_MODEL, max_tokens=1000,
        system=system, messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(block.text for block in resp.content if getattr(block, "type", "") == "text")
    return {"available": True, "sql": _strip_fences(text), "model": DEFAULT_MODEL}
