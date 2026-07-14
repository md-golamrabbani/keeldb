"""MySQL -> PostgreSQL value sanitization (zero-dates, empty strings, bools)."""
from datetime import date, datetime

import sqlalchemy as sa

from app.connectors.sanitize import coerce_value, sanitize_rows_for_pg


def test_zero_date_and_empty_to_null():
    assert coerce_value("0000-00-00", sa.Date()) is None
    assert coerce_value("0000-00-00 00:00:00", sa.DateTime()) is None
    assert coerce_value("", sa.Date()) is None
    assert coerce_value("", sa.Integer()) is None
    assert coerce_value("", sa.Numeric()) is None


def test_date_strings_normalized_to_native_objects():
    # ISO stays correct, but is now a native date so it can't depend on datestyle.
    assert coerce_value("2020-03-17", sa.Date()) == date(2020, 3, 17)
    # DD-MM-YYYY is read day-first, not as an invalid month 17 (the bug fixed here).
    assert coerce_value("17-09-1968", sa.Date()) == date(1968, 9, 17)
    assert coerce_value("17/09/1968", sa.Date()) == date(1968, 9, 17)
    # Timestamp columns keep the time component; date-only values land at midnight.
    assert coerce_value("2021-05-01 08:30:00", sa.DateTime()) == datetime(2021, 5, 1, 8, 30)
    assert coerce_value("17-09-1968", sa.DateTime()) == datetime(1968, 9, 17, 0, 0)
    # Unrecognisable strings are left for Postgres to interpret as before.
    assert coerce_value("not-a-date", sa.Date()) == "not-a-date"


def test_valid_values_pass_through():
    assert coerce_value("42", sa.Integer()) == "42"
    assert coerce_value("hello", sa.String()) == "hello"
    assert coerce_value("", sa.String()) == ""            # empty string is valid for text
    assert coerce_value(date(2020, 1, 1), sa.Date()) == date(2020, 1, 1)
    assert coerce_value(5, sa.Integer()) == 5
    assert coerce_value(None, sa.Date()) is None


def test_bool_coercion():
    assert coerce_value("1", sa.Boolean()) is True
    assert coerce_value("0", sa.Boolean()) is False
    assert coerce_value("yes", sa.Boolean()) is True
    assert coerce_value("no", sa.Boolean()) is False
    assert coerce_value("", sa.Boolean()) is None


def test_mysqldump_null_sentinel():
    assert coerce_value(r"\N", sa.String()) is None


def test_sanitize_rows_for_pg():
    meta = sa.MetaData()
    t = sa.Table("admin_user_info", meta,
                 sa.Column("employee_id", sa.String(50)),
                 sa.Column("user_type", sa.SmallInteger()),
                 sa.Column("date", sa.Date()),
                 sa.Column("otp_verify", sa.SmallInteger()))
    rows = [
        {"employee_id": "E1", "user_type": "1", "date": "0000-00-00", "otp_verify": ""},
        {"employee_id": "E2", "user_type": "2", "date": "2021-05-01", "otp_verify": "1"},
    ]
    out = sanitize_rows_for_pg(t, rows)
    assert out[0]["date"] is None and out[0]["otp_verify"] is None
    assert out[1]["date"] == date(2021, 5, 1)
