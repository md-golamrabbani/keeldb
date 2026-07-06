"""Shared test fixtures. All tests run against local SQLite databases (via the
sqlfile connector), which exercises the same dialect-agnostic SQLAlchemy Core
code paths used for MySQL/Postgres."""
from __future__ import annotations

import os
import tempfile

# Isolate the app's data dir (encryption key, exports) into a temp folder before
# importing any app module that reads DBMS_DATA_DIR at import time.
os.environ.setdefault("DBMS_DATA_DIR", tempfile.mkdtemp(prefix="dbms_test_"))

import sqlite3

import pytest

from app.connectors import connector_for
from app.models import SavedConnection


@pytest.fixture
def make_conn(tmp_path):
    """Returns factory(seed_sql, read_only=False, environment='dev') -> connector.

    `seed_sql` is executed once (via executescript, so triggers/multi-statement
    scripts work) to build the SQLite database; the factory then hands back fresh
    connectors (dispose is cheap for SQLite)."""
    state = {"path": None}

    def factory(seed_sql: str = "", *, read_only: bool = False, environment: str = "dev"):
        if state["path"] is None:
            path = str(tmp_path / "test.db")
            con = sqlite3.connect(path)
            try:
                con.executescript(seed_sql or "")
                con.commit()
            finally:
                con.close()
            state["path"] = path
        return connector_for(SavedConnection(
            id="t", name="t", flavor="sqlfile", database="main",
            sqlite_path=state["path"], read_only=read_only, environment=environment,
        ))

    return factory
