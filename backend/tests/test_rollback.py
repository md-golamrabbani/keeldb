"""Migration rollback simulator — classification, data-loss estimate, no writes."""
import sqlalchemy as sa

from app import rollback
from app.models import ColumnMap, MappingProfile, SavedConnection
from app.connectors import connector_for

SRC = """
CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
INSERT INTO emp VALUES (1,'A','a@x.com'),(2,'B','b@x.com'),(3,'C','c@x.com')
"""


def _target(tmp_path, ddl_and_data=""):
    path = str(tmp_path / "t.db")
    e = sa.create_engine(f"sqlite:///{path}")
    if ddl_and_data:
        with e.begin() as conn:
            for stmt in filter(None, (s.strip() for s in ddl_and_data.split(";"))):
                conn.execute(sa.text(stmt))
    e.dispose()
    return connector_for(SavedConnection(id="t", name="t", flavor="sqlfile", database="main", sqlite_path=path))


def _mapping(strategy="insert", keys=()):
    cols = [ColumnMap(source_col="id", target_col="id", is_conflict_key="id" in keys),
            ColumnMap(source_col="name", target_col="name"),
            ColumnMap(source_col="email", target_col="email", is_conflict_key="email" in keys)]
    return MappingProfile(name="m", source_conn_id="s", target_conn_id="t",
                          source_schema="main", source_table="emp",
                          target_schema="main", target_table="emp",
                          column_maps=cols, conflict_strategy=strategy)


def test_rollback_target_missing_is_clean(make_conn, tmp_path):
    src = make_conn(SRC)
    tgt = _target(tmp_path)  # no emp table created
    try:
        r = rollback.simulate_rollback(_mapping(), src, tgt)
    finally:
        src.dispose(); tgt.dispose()
    assert r["target_exists"] is False
    assert r["rollback"] == "clean" and r["data_loss_risk"] == "none"
    assert r["source_rows"] == 3 and r["lock_risk"] == "negligible"
    assert any("DROP TABLE" in step for step in r["plan"])


def test_rollback_empty_target_is_clean(make_conn, tmp_path):
    src = make_conn(SRC)
    tgt = _target(tmp_path, "CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT, email TEXT)")
    try:
        r = rollback.simulate_rollback(_mapping(), src, tgt)
    finally:
        src.dispose(); tgt.dispose()
    assert r["target_exists"] is True and r["target_rows_before"] == 0
    assert r["rollback"] == "clean" and r["data_loss_risk"] == "none"


def test_rollback_upsert_nonempty_is_lossy(make_conn, tmp_path):
    src = make_conn(SRC)  # 3 source rows
    tgt = _target(tmp_path,
                  "CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT, email TEXT);"
                  "INSERT INTO emp VALUES (1,'old','o@x.com'),(9,'keep','k@x.com')")
    try:
        r = rollback.simulate_rollback(_mapping("upsert", keys=("id",)), src, tgt)
    finally:
        src.dispose(); tgt.dispose()
    assert r["rollback"] == "lossy" and r["data_loss_risk"] == "high"
    assert r["max_overwrites"] == 2  # min(source=3, target=2)
    assert any("snapshot" in step.lower() for step in r["plan"])


def test_rollback_insert_nonempty_is_partial(make_conn, tmp_path):
    src = make_conn(SRC)
    tgt = _target(tmp_path,
                  "CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT, email TEXT);"
                  "INSERT INTO emp VALUES (9,'keep','k@x.com')")
    try:
        r = rollback.simulate_rollback(_mapping("insert"), src, tgt)
    finally:
        src.dispose(); tgt.dispose()
    assert r["rollback"] == "partial" and r["data_loss_risk"] == "none"
    assert r["max_overwrites"] == 0


def test_rollback_respects_where_filter(make_conn, tmp_path):
    src = make_conn(SRC)
    tgt = _target(tmp_path)
    m = _mapping()
    m.where_filter = "id <= 1"
    try:
        r = rollback.simulate_rollback(m, src, tgt)
    finally:
        src.dispose(); tgt.dispose()
    assert r["source_rows"] == 1  # only id=1 matches the filter
