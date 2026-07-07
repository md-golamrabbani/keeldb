"""Data profiler — null/distinct stats, numeric aggregates, pattern detection."""
import pytest

from app import profiler

SEED = """
CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  email TEXT,
  age INTEGER,
  city TEXT
);
INSERT INTO people VALUES
  (1,'a@x.com',30,'NYC'),
  (2,'b@x.com',40,'NYC'),
  (3,'c@x.com',50,NULL),
  (4,'d@x.com',NULL,'LA'),
  (5,'notanemail',20,'LA')
"""


def _col(res, name):
    return next(c for c in res["columns"] if c["name"] == name)


def test_row_count_and_columns(make_conn):
    c = make_conn(SEED)
    res = profiler.profile_table(c, "main", "people")
    c.dispose()
    assert res["total_rows"] == 5
    assert {col["name"] for col in res["columns"]} == {"id", "email", "age", "city"}


def test_null_and_distinct_stats(make_conn):
    c = make_conn(SEED)
    res = profiler.profile_table(c, "main", "people")
    c.dispose()
    city = _col(res, "city")
    assert city["null_count"] == 1 and city["null_pct"] == 20.0
    assert city["distinct"] == 2  # NYC, LA
    age = _col(res, "age")
    assert age["null_count"] == 1


def test_pk_flagged_unique(make_conn):
    c = make_conn(SEED)
    res = profiler.profile_table(c, "main", "people")
    c.dispose()
    assert _col(res, "id")["unique"] is True
    assert _col(res, "city")["unique"] is False


def test_numeric_min_max_avg(make_conn):
    c = make_conn(SEED)
    res = profiler.profile_table(c, "main", "people")
    c.dispose()
    age = _col(res, "age")
    assert age["kind"] == "numeric"
    assert age["min"] == 20 and age["max"] == 50
    assert age["avg"] == 35.0  # (30+40+50+20)/4
    # text columns carry no average
    assert _col(res, "city")["avg"] is None


def test_email_pattern_detection(make_conn):
    c = make_conn(SEED)
    res = profiler.profile_table(c, "main", "people")
    c.dispose()
    email = _col(res, "email")
    # 4 of 5 are valid emails (>= 0.9? no — 0.8). Ensure it does NOT over-claim.
    assert email["pattern"] is None
    # city has no recognizable pattern
    assert _col(res, "city")["pattern"] is None


def test_email_pattern_when_all_match(make_conn):
    c = make_conn("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT);"
                  "INSERT INTO t VALUES (1,'a@x.com'),(2,'b@y.com'),(3,'c@z.com'),(4,'d@w.com')")
    res = profiler.profile_table(c, "main", "t")
    c.dispose()
    email = _col(res, "email")
    assert email["pattern"] == "email" and email["pattern_pct"] == 1.0


def test_empty_table(make_conn):
    c = make_conn("CREATE TABLE e (id INTEGER PRIMARY KEY, name TEXT)")
    res = profiler.profile_table(c, "main", "e")
    c.dispose()
    assert res["total_rows"] == 0
    name = _col(res, "name")
    assert name["null_count"] == 0 and name["null_pct"] == 0.0 and name["distinct"] == 0


def test_bad_column(make_conn):
    c = make_conn(SEED)
    try:
        with pytest.raises(ValueError):
            profiler.profile_table(c, "main", "people", ["nope"])
    finally:
        c.dispose()
