"""Alert evaluation — run a saved SELECT and decide whether the alert fires.

Conditions:
  rows_gt_zero — fires if the query returns at least one row (e.g. "rows failing
                 a validation"). value is the row count.
  value_gt     — fires if the first cell of the first row is > threshold.
  value_lt     — fires if the first cell of the first row is < threshold.

Alerts are read-only: only SELECT / WITH queries are allowed. Scheduling and
delivery (email / Slack / cron) are a deployment concern; this module is the
"does it fire right now" core, driven on demand from the UI.
"""
from __future__ import annotations

from . import dbops
from .connectors.base import Connector
from .models import AlertRule

_ALLOWED = {"select", "with"}


def _scalar(rows: list) -> object:
    return rows[0][0] if rows and rows[0] else None


def evaluate(connector: Connector, rule: AlertRule, schema: str = "") -> dict:
    if dbops.first_keyword(rule.sql) not in _ALLOWED:
        raise ValueError("alert query must be a SELECT")

    result = dbops.run_sql(connector, rule.sql, schema=schema)
    if not result.get("ok"):
        return {"rule_id": rule.id, "name": rule.name, "triggered": False,
                "error": result.get("error", "query failed"), "value": None, "detail": ""}

    rows = result.get("rows") or []
    if rule.condition == "rows_gt_zero":
        triggered = len(rows) > 0
        return {"rule_id": rule.id, "name": rule.name, "triggered": triggered,
                "value": len(rows), "detail": f"{len(rows)} row(s) returned", "error": None}

    scalar = _scalar(rows)
    try:
        val = float(scalar)
    except (TypeError, ValueError):
        return {"rule_id": rule.id, "name": rule.name, "triggered": False,
                "error": "condition needs a numeric first column", "value": scalar, "detail": ""}

    triggered = val > rule.threshold if rule.condition == "value_gt" else val < rule.threshold
    op = ">" if rule.condition == "value_gt" else "<"
    return {"rule_id": rule.id, "name": rule.name, "triggered": triggered,
            "value": scalar, "detail": f"{val:g} {op} {rule.threshold:g}", "error": None}


def evaluate_all(connector: Connector, rules: list[AlertRule], schema: str = "") -> list[dict]:
    out = []
    for rule in rules:
        try:
            out.append(evaluate(connector, rule, schema))
        except Exception as exc:
            out.append({"rule_id": rule.id, "name": rule.name, "triggered": False,
                        "error": str(exc), "value": None, "detail": ""})
    return out
