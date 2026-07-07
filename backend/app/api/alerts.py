from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..models import AlertCondition, AlertRule
from ..store import alert_store

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertIn(BaseModel):
    name: str
    sql: str
    condition: AlertCondition = "rows_gt_zero"
    threshold: float = 0


@router.get("")
def list_alerts():
    return [a.model_dump() for a in alert_store.list()]


@router.post("")
def create_alert(req: AlertIn):
    if not req.name.strip() or not req.sql.strip():
        raise HTTPException(400, "name and sql are required")
    rule = AlertRule(name=req.name.strip(), sql=req.sql, condition=req.condition, threshold=req.threshold)
    return alert_store.save(rule).model_dump()


@router.delete("/{alert_id}")
def delete_alert(alert_id: str):
    if not alert_store.delete(alert_id):
        raise HTTPException(404, "alert not found")
    return {"deleted": alert_id}
