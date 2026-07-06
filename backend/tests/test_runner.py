"""Migration runner: transform + batched write, download modes, idempotency."""
import sqlalchemy as sa

from app import runner as R
from app.connectors.base import Connector
from app.models import ColumnMap, MappingProfile, SavedConnection


def _seed_source(path: str, n: int = 200):
    e = sa.create_engine(f"sqlite:///{path}")
    with e.begin() as c:
        c.execute(sa.text("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, dob TEXT)"))
        for i in range(1, n + 1):
            c.execute(sa.text("INSERT INTO t VALUES (:i,:n,:d)"),
                      {"i": i, "n": f"P{i}", "d": f"{(i % 28) + 1:02d}/03/1990"})
    e.dispose()


MAPS = [
    ColumnMap(source_col="id", target_col="id", transform_expr="uuid5('people', value)", is_conflict_key=True),
    ColumnMap(source_col="name", target_col="name"),
    ColumnMap(source_col="dob", target_col="dob", cast_type="date", cast_format="%d/%m/%Y"),
]


def test_download_csv(tmp_path):
    src_path = str(tmp_path / "src.db")
    _seed_source(src_path, 5)
    src = SavedConnection(id="s", name="s", flavor="sqlfile", database="main", sqlite_path=src_path)
    m = MappingProfile(name="x", source_conn_id="s", target_conn_id="", source_schema="main",
                       source_table="t", target_table="people", column_maps=MAPS, output_mode="csv", batch_size=2)
    done = list(R.run_migration(m, src, None))[-1]
    assert done["report"]["rows_written"] == 5 and done["report"]["ok"]
    csv_text = (R.EXPORT_DIR / f"{done['export_id']}.csv").read_text()
    assert "id,name,dob" in csv_text and "P1" in csv_text


class _SQLiteRW(Connector):
    """A writable SQLite connector for exercising the DB-push path in tests."""
    def url(self):
        return f"sqlite:///{self.profile.sqlite_path}"

    def _row_estimates(self, schema):
        return {}

    def write_batch(self, schema, table, rows, conflict_strategy="insert", conflict_keys=None):
        t = self._table(schema, table)
        stmt = sa.insert(t).values(rows)
        if conflict_strategy == "upsert":
            stmt = stmt.prefix_with("OR REPLACE")
        elif conflict_strategy == "skip":
            stmt = stmt.prefix_with("OR IGNORE")
        with self.engine.begin() as conn:
            conn.execute(stmt)
        return {"written": len(rows), "skipped": 0}


def test_push_is_idempotent(tmp_path, monkeypatch):
    src_path = str(tmp_path / "src.db")
    tgt_path = str(tmp_path / "tgt.db")
    _seed_source(src_path, 200)
    e = sa.create_engine(f"sqlite:///{tgt_path}")
    with e.begin() as c:
        c.execute(sa.text("CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT, dob DATE)"))
    e.dispose()

    monkeypatch.setattr(R, "connector_for", lambda p: _SQLiteRW(p))
    src = SavedConnection(id="s", name="s", flavor="postgresql", database="src", sqlite_path=src_path)
    tgt = SavedConnection(id="t", name="t", flavor="postgresql", database="tgt", sqlite_path=tgt_path)
    m = MappingProfile(name="x", source_conn_id="s", target_conn_id="t", source_table="t",
                       target_table="people", column_maps=MAPS, conflict_strategy="upsert",
                       batch_size=50, output_mode="push")

    def run():
        return list(R.run_migration(m, src, tgt))[-1]["report"]

    r1 = run()
    assert r1["rows_written"] == 200 and r1["target_count_after"] == 200 and r1["ok"]
    r2 = run()  # re-run must converge, not duplicate
    assert r2["target_count_after"] == 200


def test_bad_row_reported(tmp_path, monkeypatch):
    src_path = str(tmp_path / "src.db")
    e = sa.create_engine(f"sqlite:///{src_path}")
    with e.begin() as c:
        c.execute(sa.text("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, dob TEXT)"))
        c.execute(sa.text("INSERT INTO t VALUES (1,'ok','01/03/1990'),(2,'bad','not-a-date')"))
    e.dispose()
    src = SavedConnection(id="s", name="s", flavor="sqlfile", database="main", sqlite_path=src_path)
    m = MappingProfile(name="x", source_conn_id="s", target_conn_id="", source_schema="main",
                       source_table="t", target_table="people", column_maps=MAPS, output_mode="csv")
    report = list(R.run_migration(m, src, None))[-1]["report"]
    assert report["rows_written"] == 1 and report["rows_errored"] == 1
