"""Transform engine: casts, sandboxed expressions, deterministic UUIDs, row map."""
from datetime import date, datetime

import pytest

from app.transform.registry import apply_cast
from app.transform.expr import eval_expr, validate_expr
from app.transform.uuidgen import det_uuid
from app.runner import transform_row
from app.models import ColumnMap


def test_casts_basic():
    assert apply_cast("123", "int") == 123
    assert apply_cast("1.5", "numeric", "") is not None
    assert apply_cast("yes", "bool") is True
    assert apply_cast("no", "bool") is False
    assert apply_cast("2020-03-17", "date") == date(2020, 3, 17)
    assert apply_cast("", "int") is None  # empty -> None


def test_cast_date_format():
    assert apply_cast("17/03/1988", "date", "%d/%m/%Y") == date(1988, 3, 17)
    with pytest.raises(Exception):
        apply_cast("not-a-date", "date", "%d/%m/%Y")


def test_expr_helpers():
    row = {"employee_name": "Golam Rabbani", "police": "No"}
    assert eval_expr("split_part(value, ' ', -1)", "Golam Rabbani", row) == "Rabbani"
    assert eval_expr("split_before(value, ' ')", "Golam Rabbani", row) == "Golam"
    assert eval_expr("to_bool(value, 'yes', 'no')", "No", row) is False
    assert eval_expr("upper(trim(value))", "  hi ", row) == "HI"
    assert eval_expr("map({'a': 1}, value)", "a", row) == 1
    assert eval_expr("row['police']", None, row) == "No"


def test_expr_sandbox_rejects_dangerous():
    for bad in ["__import__('os')", "open('/etc/passwd')", "value.__class__",
                "(lambda: 1)()", "row.pop('x')", "1 if x else 2"]:
        assert validate_expr(bad) != "", f"sandbox allowed: {bad}"
    assert validate_expr("split_part(value, ' ', -1)") == ""


def test_uuid5_deterministic_and_linked():
    a = det_uuid("people", "EMP-1")
    b = det_uuid("people", "EMP-1")
    assert a == b                      # deterministic
    assert det_uuid("people", "EMP-2") != a
    # same key + label from another migration links rows
    assert eval_expr("uuid5('people', row['id'])", None, {"id": "EMP-1"}) == a


def test_transform_row_collects_errors():
    maps = [
        ColumnMap(source_col="name", target_col="last", transform_expr="split_part(value, ' ', -1)"),
        ColumnMap(source_col="dob", target_col="dob", cast_type="date", cast_format="%d/%m/%Y"),
    ]
    ok, errs = transform_row({"name": "A B", "dob": "01/01/2000"}, maps)
    assert ok["last"] == "B" and ok["dob"] == date(2000, 1, 1) and not errs

    bad, errs2 = transform_row({"name": "A B", "dob": "bad"}, maps)
    assert errs2 and errs2[0][0] == "dob"
