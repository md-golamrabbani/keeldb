"""Built-in casts: text -> int / numeric / bool / date / timestamp / uuid / text.

Legacy systems store dates as varchar, so date/timestamp casts take a
configurable strptime format string (default ISO).
"""
from __future__ import annotations

import uuid as uuidlib
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

TRUE_WORDS = {"1", "true", "t", "yes", "y", "on"}
FALSE_WORDS = {"0", "false", "f", "no", "n", "off", ""}

CAST_TYPES = ["", "text", "int", "numeric", "bool", "date", "timestamp", "uuid"]


def apply_cast(value: Any, cast_type: str, fmt: str = "") -> Any:
    if not cast_type or value is None:
        return value
    if cast_type == "text":
        return str(value)
    if cast_type == "int":
        if isinstance(value, bool):
            return int(value)
        s = str(value).strip()
        if s == "":
            return None
        return int(float(s)) if "." in s else int(s)
    if cast_type == "numeric":
        s = str(value).strip()
        if s == "":
            return None
        try:
            return Decimal(s)
        except InvalidOperation as exc:
            raise ValueError(f"not numeric: {value!r}") from exc
    if cast_type == "bool":
        s = str(value).strip().lower()
        if s in TRUE_WORDS:
            return True
        if s in FALSE_WORDS:
            return False
        raise ValueError(f"not boolean: {value!r}")
    if cast_type == "date":
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        return _parse_dt(value, fmt).date()
    if cast_type == "timestamp":
        return value if isinstance(value, datetime) else _parse_dt(value, fmt)
    if cast_type == "uuid":
        return str(uuidlib.UUID(str(value).strip()))
    raise ValueError(f"unknown cast type: {cast_type}")


def _parse_dt(value: Any, fmt: str) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    s = str(value).strip()
    if s == "":
        raise ValueError("empty date string")
    if fmt:
        return datetime.strptime(s, fmt)
    # Sensible fallbacks for common legacy formats.
    for guess in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, guess)
        except ValueError:
            continue
    raise ValueError(f"cannot parse date {value!r}; set a format string")
