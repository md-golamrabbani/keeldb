"""Index & constraint management — create/drop indexes, list constraints, guards."""
import sqlalchemy as sa
import pytest

from app import admin

SEED = """
CREATE TABLE dept (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE emp (
  id INTEGER PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  dept_id INTEGER REFERENCES dept(id)
);
INSERT INTO dept VALUES (1,'Eng');
INSERT INTO emp VALUES (1,'A','a@x.com',1),(2,'B','b@x.com',1)
"""


def _index_names(c):
    return {ix["name"] for ix in admin.list_indexes(c, "main", "emp")["indexes"]}


def test_create_and_list_index(make_conn):
    c = make_conn(SEED)
    try:
        admin.create_index(c, "main", "emp", "ix_emp_dept", ["dept_id"])
        idx = admin.list_indexes(c, "main", "emp")["indexes"]
        mine = next(i for i in idx if i["name"] == "ix_emp_dept")
        assert mine["columns"] == ["dept_id"] and mine["unique"] is False and mine["primary"] is False
        # the PK is reported too
        assert any(i["primary"] for i in idx)
    finally:
        c.dispose()


def test_create_unique_index(make_conn):
    c = make_conn(SEED)
    try:
        admin.create_index(c, "main", "emp", "ux_emp_name", ["name"], unique=True)
        mine = next(i for i in admin.list_indexes(c, "main", "emp")["indexes"] if i["name"] == "ux_emp_name")
        assert mine["unique"] is True
        # a unique index actually enforces uniqueness
        with pytest.raises(Exception):
            with c.engine.begin() as conn:
                conn.execute(sa.text("INSERT INTO emp VALUES (3,'A','z@x.com',1)"))
    finally:
        c.dispose()


def test_drop_index(make_conn):
    c = make_conn(SEED)
    try:
        admin.create_index(c, "main", "emp", "ix_tmp", ["email"])
        assert "ix_tmp" in _index_names(c)
        admin.drop_index(c, "main", "emp", "ix_tmp")
        assert "ix_tmp" not in _index_names(c)
    finally:
        c.dispose()


def test_create_index_unknown_column(make_conn):
    c = make_conn(SEED)
    try:
        with pytest.raises(ValueError):
            admin.create_index(c, "main", "emp", "ix_bad", ["nope"])
    finally:
        c.dispose()


def test_invalid_index_name_rejected(make_conn):
    c = make_conn(SEED)
    try:
        with pytest.raises(ValueError):
            admin.create_index(c, "main", "emp", "bad name; DROP TABLE emp", ["id"])
    finally:
        c.dispose()


def test_list_constraints(make_conn):
    c = make_conn(SEED)
    res = admin.list_constraints(c, "main", "emp")
    c.dispose()
    assert res["primary_key"]["columns"] == ["id"]
    fk = res["foreign_keys"][0]
    assert fk["ref_table"] == "dept" and fk["columns"] == ["dept_id"]
    assert any(u["columns"] == ["email"] for u in res["unique"])


def test_constraint_mutation_blocked_on_sqlite(make_conn):
    c = make_conn(SEED)
    try:
        with pytest.raises(ValueError):
            admin.add_foreign_key(c, "main", "emp", "fk", ["dept_id"], "dept", ["id"])
        with pytest.raises(ValueError):
            admin.add_unique(c, "main", "emp", "uq", ["name"])
        with pytest.raises(ValueError):
            admin.drop_constraint(c, "main", "emp", "fk")
    finally:
        c.dispose()
