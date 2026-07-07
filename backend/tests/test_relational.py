"""Relational debugger — reverse-FK dependents, self-references, cascade info."""
import pytest

from app import relational

SEED = """
CREATE TABLE dept (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE emp (
  id INTEGER PRIMARY KEY, name TEXT,
  dept_id INTEGER REFERENCES dept(id),
  manager_id INTEGER REFERENCES emp(id)
);
CREATE TABLE project (id INTEGER PRIMARY KEY, lead_id INTEGER REFERENCES emp(id));
INSERT INTO dept VALUES (1,'Eng'),(2,'HR');
INSERT INTO emp VALUES (1,'Boss',1,NULL),(2,'A',1,1),(3,'B',1,1),(4,'H',2,NULL);
INSERT INTO project VALUES (10,1),(11,1)
"""


def test_dependents_of_parent_row(make_conn):
    c = make_conn(SEED)
    res = relational.dependents(c, "main", "dept", {"id": 1})
    c.dispose()
    assert res["found"] is True
    emp = next(g for g in res["dependents"] if g["table"] == "emp")
    assert emp["columns"] == ["dept_id"] and emp["count"] == 3  # emps 1,2,3 in dept 1
    assert res["total_dependents"] == 3 and res["referencing_tables"] == 1


def test_self_reference_and_multiple_children(make_conn):
    c = make_conn(SEED)
    # Boss (emp 1) is referenced by emp.manager_id (2 reports) and project.lead_id (2).
    res = relational.dependents(c, "main", "emp", {"id": 1})
    c.dispose()
    by_table = {(g["table"], tuple(g["columns"])): g for g in res["dependents"]}
    assert by_table[("emp", ("manager_id",))]["count"] == 2
    assert by_table[("project", ("lead_id",))]["count"] == 2
    assert res["total_dependents"] == 4 and res["referencing_tables"] == 2


def test_dept_with_single_dependent(make_conn):
    c = make_conn(SEED)
    res = relational.dependents(c, "main", "dept", {"id": 2})
    c.dispose()
    emp = next(g for g in res["dependents"] if g["table"] == "emp")
    assert emp["count"] == 1  # only emp 4 is in dept 2


def test_leaf_row_has_zero(make_conn):
    c = make_conn(SEED)
    res = relational.dependents(c, "main", "emp", {"id": 4})  # H manages nobody, leads nothing
    c.dispose()
    assert res["total_dependents"] == 0 and res["referencing_tables"] == 0


def test_row_not_found(make_conn):
    c = make_conn(SEED)
    res = relational.dependents(c, "main", "dept", {"id": 999})
    c.dispose()
    assert res["found"] is False and res["total_dependents"] == 0


def test_sample_rows_included(make_conn):
    c = make_conn(SEED)
    res = relational.dependents(c, "main", "dept", {"id": 1})
    c.dispose()
    emp = next(g for g in res["dependents"] if g["table"] == "emp")
    assert len(emp["sample"]) == 3 and all("name" in row for row in emp["sample"])


def test_bad_input(make_conn):
    c = make_conn(SEED)
    try:
        with pytest.raises(ValueError):
            relational.dependents(c, "main", "dept", {})
        with pytest.raises(ValueError):
            relational.dependents(c, "main", "dept", {"nope": 1})
    finally:
        c.dispose()
