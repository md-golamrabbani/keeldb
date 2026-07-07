"""Duplicate record detector — grouping, redundant-row totals, multi-column keys."""
import pytest

from app import duplicates

SEED = """
CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, city TEXT);
INSERT INTO users VALUES
  (1,'a@x.com','Ann','NYC'),
  (2,'a@x.com','Ann','NYC'),
  (3,'a@x.com','Annie','LA'),
  (4,'b@x.com','Bob','SF'),
  (5,'c@x.com','Cyd','SF'),
  (6,'c@x.com','Cyd','SF')
"""


def test_single_column_duplicates(make_conn):
    c = make_conn(SEED)
    res = duplicates.find_duplicates(c, "main", "users", ["email"])
    c.dispose()
    # a@x.com x3 and c@x.com x2 are duplicated; b@x.com is unique.
    assert res["group_count"] == 2
    assert res["redundant_rows"] == 3  # (3-1) + (2-1)
    assert res["groups"][0]["values"]["email"] == "a@x.com" and res["groups"][0]["count"] == 3
    assert res["truncated"] is False


def test_multi_column_duplicates(make_conn):
    c = make_conn(SEED)
    res = duplicates.find_duplicates(c, "main", "users", ["email", "name", "city"])
    c.dispose()
    # only rows 1&2 (a@x.com/Ann/NYC) and 5&6 (c@x.com/Cyd/SF) match on all three.
    assert res["group_count"] == 2
    assert res["redundant_rows"] == 2
    assert all(g["count"] == 2 for g in res["groups"])


def test_no_duplicates(make_conn):
    c = make_conn(SEED)
    res = duplicates.find_duplicates(c, "main", "users", ["id"])
    c.dispose()
    assert res["group_count"] == 0 and res["redundant_rows"] == 0 and res["groups"] == []


def test_limit_truncates_groups(make_conn):
    c = make_conn(SEED)
    res = duplicates.find_duplicates(c, "main", "users", ["email"], limit=1)
    c.dispose()
    assert len(res["groups"]) == 1
    assert res["group_count"] == 2 and res["truncated"] is True  # totals stay unbounded


def test_rejects_bad_input(make_conn):
    c = make_conn(SEED)
    try:
        with pytest.raises(ValueError):
            duplicates.find_duplicates(c, "main", "users", [])
        with pytest.raises(ValueError):
            duplicates.find_duplicates(c, "main", "users", ["nope"])
    finally:
        c.dispose()
