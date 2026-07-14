from __future__ import annotations

import json
from typing import Literal

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..connectors import connector_for
from ..dbops import clean_error
from ..store import connection_store
from ..supabase_admin import iter_create_users

router = APIRouter(prefix="/supabase-auth", tags=["supabase-auth"])


class CreateAuthUsersRequest(BaseModel):
    source_conn_id: str
    source_schema: str = ""
    source_table: str
    email_column: str = "email"
    supabase_url: str = ""
    service_role_key: str = ""
    password_mode: Literal["email_prefix", "common"] = "email_prefix"
    common_password: str = ""
    confirm_email: bool = True
    dry_run: bool = True


def _fetch_emails(conn, schema: str, table: str, email_column: str) -> list[str]:
    """Read distinct, non-empty emails from the source. Uses the reflected column
    object (not string interpolation) so table/column names can't inject SQL."""
    c = connector_for(conn)
    try:
        t = c._table(schema, table)
        if email_column not in t.c:
            raise ValueError(f"column {email_column!r} not found in {table!r}")
        col = t.c[email_column]
        with c.engine.connect() as cx:
            rows = cx.execute(sa.select(col).where(col.isnot(None)).where(col != "")).all()
    finally:
        c.dispose()
    seen: set[str] = set()
    out: list[str] = []
    for (email,) in rows:
        e = (str(email) if email is not None else "").strip().lower()
        if e and "@" in e and e not in seen:
            seen.add(e)
            out.append(e)
    return out


@router.post("/create-users")
def create_users(req: CreateAuthUsersRequest):
    """Bulk-create Supabase Auth users from a source table via the Admin API,
    streaming NDJSON progress. The service_role key is used only for this request
    and never persisted."""
    conn = connection_store.get(req.source_conn_id)
    if not conn:
        raise HTTPException(404, "source connection not found")
    if not req.dry_run and (not req.supabase_url.strip() or not req.service_role_key.strip()):
        raise HTTPException(422, "Supabase URL and service_role key are required to create users")
    if not req.dry_run and req.password_mode == "common" and not req.common_password:
        raise HTTPException(422, "a common password is required for 'common' mode")
    try:
        emails = _fetch_emails(conn, req.source_schema, req.source_table, req.email_column)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        raise HTTPException(400, clean_error(exc))

    def stream():
        for ev in iter_create_users(
            req.supabase_url, req.service_role_key, emails,
            password_mode=req.password_mode, common_password=req.common_password,
            confirm=req.confirm_email, dry_run=req.dry_run,
        ):
            yield json.dumps(ev, default=str) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")
