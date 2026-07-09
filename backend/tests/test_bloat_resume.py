"""Bloat advisor graceful degradation + migration checkpoint/resume."""
from __future__ import annotations

import sqlalchemy as sa

from app import bloat
from app import runner as R
from app.models import ColumnMap, MappingProfile, SavedConnection
from app.runner import get_checkpoint, run_migration, set_checkpoint
from tests.test_runner import _SQLiteRW

SEED = """
CREATE TABLE src (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO src VALUES (1,'a'),(2,'b'),(3,'c'),(4,'d'),(5,'e');
"""


def test_bloat_unsupported_dialect_is_graceful(make_conn):
    c = make_conn(SEED)
    out = bloat.report(c, "")
    assert out["supported"] is False and out["advice"] == []
    c.dispose()


def _mapping() -> MappingProfile:
    return MappingProfile(
        id="m1", name="m", source_conn_id="s", target_conn_id="t",
        source_table="src", target_table="dst",
        output_mode="push", batch_size=2,
        column_maps=[
            ColumnMap(source_col="id", target_col="id", enabled=True),
            ColumnMap(source_col="name", target_col="name", enabled=True),
        ],
    )


def test_resume_offset_skips_already_written_rows(tmp_path, monkeypatch):
    src_path = str(tmp_path / "src.db")
    tgt_path = str(tmp_path / "tgt.db")
    e = sa.create_engine(f"sqlite:///{src_path}")
    with e.begin() as cx:
        cx.exec_driver_sql("CREATE TABLE src (id INTEGER PRIMARY KEY, name TEXT)")
        cx.exec_driver_sql("INSERT INTO src VALUES (1,'a'),(2,'b'),(3,'c'),(4,'d'),(5,'e')")
    e.dispose()
    # Target already holds the first 3 rows from the interrupted run.
    e = sa.create_engine(f"sqlite:///{tgt_path}")
    with e.begin() as cx:
        cx.exec_driver_sql("CREATE TABLE dst (id INTEGER PRIMARY KEY, name TEXT)")
        cx.exec_driver_sql("INSERT INTO dst VALUES (1,'a'),(2,'b'),(3,'c')")
    e.dispose()

    monkeypatch.setattr(R, "connector_for", lambda p: _SQLiteRW(p))
    src = SavedConnection(id="s", name="s", flavor="postgresql", database="s", sqlite_path=src_path)
    tgt = SavedConnection(id="t", name="t", flavor="postgresql", database="t", sqlite_path=tgt_path)

    events = list(run_migration(_mapping(), src, tgt, resume_offset=3))
    assert events[0]["resume_offset"] == 3
    report = events[-1]["report"]
    assert report["ok"] and report["rows_read"] == 2 and report["rows_written"] == 2
    assert report["target_count_after"] == 5

    # a clean finish clears the checkpoint
    assert get_checkpoint("m1") is None


def test_checkpoint_store_roundtrip():
    set_checkpoint("mx", 42)
    assert get_checkpoint("mx") == {"rows_read": 42}
    set_checkpoint("mx", 0, done=True)
    assert get_checkpoint("mx") is None
