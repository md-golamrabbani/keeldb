"""Live activity — SQLite reports unsupported; kill validates and guards."""
import pytest

from app import activity


def test_activity_unsupported_on_sqlite(make_conn):
    c = make_conn("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    res = activity.list_activity(c)
    c.dispose()
    assert res["supported"] is False and res["dialect"] == "sqlite" and res["sessions"] == []


def test_kill_rejects_non_numeric_id(make_conn):
    c = make_conn("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    try:
        with pytest.raises(ValueError):
            activity.kill_session(c, "not-a-number")
    finally:
        c.dispose()


def test_kill_unsupported_on_sqlite(make_conn):
    c = make_conn("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    try:
        with pytest.raises(ValueError):
            activity.kill_session(c, "123")  # numeric, but SQLite has no sessions
    finally:
        c.dispose()
