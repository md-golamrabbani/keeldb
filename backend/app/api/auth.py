from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .. import auth

router = APIRouter(prefix="/auth", tags=["auth"])


class SetupIn(BaseModel):
    password: str = ""
    question: str = ""
    answer: str = ""


class PasswordIn(BaseModel):
    password: str = ""


class RecoverIn(BaseModel):
    answer: str = ""
    new_password: str = ""


@router.get("/status")
def status():
    return {
        "enabled": auth.enabled(),
        "configured": auth.is_configured(),
        "needs_setup": auth.needs_setup(),
        "blocked": auth.is_blocked(),
        "question": auth.security_question(),
    }


@router.post("/setup")
def setup(req: SetupIn):
    if not auth.enabled():
        return {"token": ""}
    try:
        auth.setup(req.password, req.question, req.answer)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"token": auth.issue_token()}


@router.post("/login")
def login(req: PasswordIn):
    if not auth.enabled():
        return {"token": ""}
    if auth.is_blocked():
        raise HTTPException(403, "app is permanently locked")
    if not auth.check_password(req.password):
        raise HTTPException(401, "invalid password")
    return {"token": auth.issue_token()}


@router.post("/recover")
def recover(req: RecoverIn):
    if not auth.enabled():
        return {"ok": True, "token": ""}
    if auth.is_blocked():
        raise HTTPException(403, "app is permanently locked")
    try:
        res = auth.recover(req.answer, req.new_password)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if res["ok"]:
        return {"ok": True, "token": auth.issue_token()}
    return res  # {ok: false, blocked, attempts_left}


@router.post("/refresh")
def refresh(request: Request):
    if not auth.enabled():
        return {"token": ""}
    token = auth.token_from_header(request.headers.get("authorization", ""))
    if not auth.verify_token(token):
        raise HTTPException(401, "session expired")
    return {"token": auth.issue_token()}
