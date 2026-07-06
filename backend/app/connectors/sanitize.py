"""MySQL → PostgreSQL value compatibility.

MySQL is lenient about values that PostgreSQL rejects outright. When pushing
rows into a Postgres target we coerce those values to something Postgres
accepts (almost always NULL), keyed by the target column's real type:

  * Zero dates  '0000-00-00' / '0000-00-00 00:00:00'  → NULL
    (MySQL's "no date" sentinel; Postgres raises DatetimeFieldOverflow)
  * Empty string ''  in a date/time/number/bool/uuid/json column → NULL
    (MySQL coerces '' to 0 / zero-date; Postgres errors on the cast)
  * '0'/'1'/'yes'/'no'/'t'/'f'  in a boolean column → real bool
  * MySQL NULL sentinel '\\N' → NULL

Valid values pass through untouched, so a genuine '2020-01-01' still lands.
"""
from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

import sqlalchemy as sa

_ZERO_DATE_PREFIX = "0000-00-00"
_BOOL_TRUE = {"1", "true", "t", "yes", "y", "on"}
_BOOL_FALSE = {"0", "false", "f", "no", "n", "off"}


def _python_type(coltype: Any):
    try:
        return coltype.python_type
    except (NotImplementedError, AttributeError):
        return None


def coerce_value(value: Any, coltype: Any) -> Any:
    """Coerce one value to be Postgres-safe for the given column type."""
    if value is None or coltype is None:
        return value
    if not isinstance(value, str):
        return value  # driver-native objects (date, int, …) are already fine

    s = value.strip()
    if s == r"\N":  # mysqldump NULL sentinel that leaked through as text
        return None

    py = _python_type(coltype)
    type_name = type(coltype).__name__.lower()

    if py in (date, datetime, time) or any(k in type_name for k in ("date", "time")):
        if s == "" or s.startswith(_ZERO_DATE_PREFIX) or set(s) <= {"0", "-", ":", " "}:
            return None
        return value

    if py in (int, float, Decimal) or any(k in type_name for k in ("int", "numeric", "decimal", "float", "real", "double", "money")):
        return None if s == "" else value

    if py is bool or "bool" in type_name:
        if s == "":
            return None
        low = s.lower()
        if low in _BOOL_TRUE:
            return True
        if low in _BOOL_FALSE:
            return False
        return value

    if s == "" and any(k in type_name for k in ("uuid", "json")):
        return None

    return value


def sanitize_rows_for_pg(table: sa.Table, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return a copy of `rows` with each value coerced for its target column."""
    coltypes = {c.name: c.type for c in table.c}
    return [{k: coerce_value(v, coltypes.get(k)) for k, v in row.items()} for row in rows]
