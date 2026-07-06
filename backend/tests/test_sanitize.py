"""MySQL -> PostgreSQL value sanitization (zero-dates, empty strings, bools)."""
from datetime import date

import sqlalchemy as sa

from app.connectors.sanitize import coerce_value, sanitize_rows_for_pg


def test_zero_date_and_empty_to_null():
    assert coerce_value("0000-00-00", sa.Date()) is None
    assert coerce_value("0000-00-00 00:00:00", sa.DateTime()) is None
    assert coerce_value("", sa.Date()) is None
    assert coerce_value("", sa.Integer()) is None
    assert coerce_value("", sa.Numeric()) is None


def test_valid_values_pass_through():
    assert coerce_value("2020-03-17", sa.Date()) == "2020-03-17"
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
    assert out[1]["date"] == "2021-05-01"
