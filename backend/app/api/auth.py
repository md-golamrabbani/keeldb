from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import auth

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    password: str = ""


@router.get("/status")
def status():
    return {"enabled": auth.enabled()}


@router.post("/login")
def login(req: LoginIn):
    if not auth.enabled():
        return {"token": "", "enabled": False}
    if not auth.check_password(req.password):
        raise HTTPException(401, "invalid password")
    return {"token": auth.issue_token(), "enabled": True}
