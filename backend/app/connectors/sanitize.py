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

# Formats tried when normalising a legacy date/timestamp string to a native
# object. Order mirrors transform.registry so ambiguous dash/slash dates get
# the same day-first interpretation the manual cast uses. Separators are
# distinct, so e.g. '17-09-1968' (DD-MM-YYYY) can never be read as month 17.
_DATETIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M",
    "%d/%m/%Y %H:%M:%S", "%m/%d/%Y %H:%M:%S",
    "%d-%m-%Y %H:%M:%S", "%d.%m.%Y %H:%M:%S",
)
_DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%d.%m.%Y")


def _python_type(coltype: Any):
    try:
        return coltype.python_type
    except (NotImplementedError, AttributeError):
        return None


def _wants_time_component(py: Any, type_name: str) -> Any:
    """True → timestamp, False → date, None → time-only/unknown (leave as-is)."""
    if py is datetime:
        return True
    if py is date:
        return False
    if py is time:
        return None
    if "timestamp" in type_name or "datetime" in type_name:
        return True
    if "date" in type_name:
        return False
    return None  # pure TIME columns are unambiguous; don't touch them


def _normalize_date_string(s: str, py: Any, type_name: str) -> Any:
    """Parse a legacy date/timestamp string into a native object so the value
    no longer depends on the server's datestyle. Returns None if unparseable,
    leaving the original string for Postgres to interpret as before."""
    want_time = _wants_time_component(py, type_name)
    if want_time is None:
        return None
    for fmt in _DATETIME_FORMATS + _DATE_FORMATS:
        try:
            dt = datetime.strptime(s, fmt)
        except ValueError:
            continue
        return dt if want_time else dt.date()
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
        parsed = _normalize_date_string(s, py, type_name)
        return parsed if parsed is not None else value

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
