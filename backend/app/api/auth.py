from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .. import auth

router = APIRouter(prefix="/auth", tags=["auth"])


class PasswordIn(BaseModel):
    password: str = ""


@router.get("/status")
def status():
    return {"enabled": auth.enabled(), "configured": auth.is_configured(), "needs_setup": auth.needs_setup()}


@router.post("/setup")
def setup(req: PasswordIn):
    if not auth.enabled():
        return {"token": ""}
    try:
        auth.setup(req.password)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"token": auth.issue_token()}


@router.post("/login")
def login(req: PasswordIn):
    if not auth.enabled():
        return {"token": ""}
    if not auth.check_password(req.password):
        raise HTTPException(401, "invalid password")
    return {"token": auth.issue_token()}


@router.post("/refresh")
def refresh(request: Request):
    # /auth/* is exempt from the global gate, so verify the token here.
    if not auth.enabled():
        return {"token": ""}
    token = auth.token_from_header(request.headers.get("authorization", ""))
    if not auth.verify_token(token):
        raise HTTPException(401, "session expired")
    return {"token": auth.issue_token()}
