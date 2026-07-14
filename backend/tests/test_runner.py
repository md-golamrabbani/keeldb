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


def test_duplicate_in_batch_isolated_not_fatal(tmp_path, monkeypatch):
    """A unique-constraint clash on one row must not sink the whole batch:
    the other rows still land and only the offender is reported."""
    src_path = str(tmp_path / "src.db")
    tgt_path = str(tmp_path / "tgt.db")
    e = sa.create_engine(f"sqlite:///{src_path}")
    with e.begin() as c:
        c.execute(sa.text("CREATE TABLE d (id INTEGER PRIMARY KEY, code TEXT)"))
        # 'ALC' appears twice; both fall inside a single write batch.
        c.execute(sa.text("INSERT INTO d VALUES (1,'A'),(2,'B'),(3,'ALC'),(4,'C'),(5,'ALC')"))
    e.dispose()
    te = sa.create_engine(f"sqlite:///{tgt_path}")
    with te.begin() as c:
        c.execute(sa.text("CREATE TABLE departments (id TEXT PRIMARY KEY, code TEXT UNIQUE)"))
    te.dispose()

    monkeypatch.setattr(R, "connector_for", lambda p: _SQLiteRW(p))
    src = SavedConnection(id="s", name="s", flavor="postgresql", database="src", sqlite_path=src_path)
    tgt = SavedConnection(id="t", name="t", flavor="postgresql", database="tgt", sqlite_path=tgt_path)
    maps = [
        ColumnMap(source_col="id", target_col="id", transform_expr="uuid5('dept', value)", is_conflict_key=True),
        ColumnMap(source_col="code", target_col="code"),
    ]
    m = MappingProfile(name="x", source_conn_id="s", target_conn_id="t", source_table="d",
                       target_table="departments", column_maps=maps, conflict_strategy="insert",
                       batch_size=50, output_mode="push", stop_on_error=False)
    report = list(R.run_migration(m, src, tgt))[-1]["report"]
    assert report["rows_written"] == 4        # A, B, ALC, C all land
    assert report["rows_errored"] == 1        # the second ALC is the only casualty
    assert report["target_count_after"] == 4
    assert not report["aborted"]


def test_incompatible_target_aborts_fast(tmp_path, monkeypatch):
    """If the whole first batch fails (schema mismatch), abort instead of
    grinding every row of every batch."""
    src_path = str(tmp_path / "src.db")
    tgt_path = str(tmp_path / "tgt.db")
    _seed_source(src_path, 120)
    te = sa.create_engine(f"sqlite:///{tgt_path}")
    with te.begin() as c:
        # Target lacks the 'name' and 'dob' columns the mapping writes.
        c.execute(sa.text("CREATE TABLE people (id TEXT PRIMARY KEY)"))
    te.dispose()

    monkeypatch.setattr(R, "connector_for", lambda p: _SQLiteRW(p))
    src = SavedConnection(id="s", name="s", flavor="postgresql", database="src", sqlite_path=src_path)
    tgt = SavedConnection(id="t", name="t", flavor="postgresql", database="tgt", sqlite_path=tgt_path)
    m = MappingProfile(name="x", source_conn_id="s", target_conn_id="t", source_table="t",
                       target_table="people", column_maps=MAPS, conflict_strategy="insert",
                       batch_size=50, output_mode="push", stop_on_error=False)
    events = list(R.run_migration(m, src, tgt))
    report = events[-1]["report"]
    assert report["aborted"] and report["rows_written"] == 0
    assert any(e.get("event") == "fatal" for e in events)
    # Must not have ground through all 120 rows one at a time before giving up.
    assert report["rows_errored"] <= 50


def test_supabase_auth_push_fills_required_columns(tmp_path, monkeypatch):
    """End-to-end: enabling Supabase Auth mode makes a bare (email-only) source
    land in an auth.users-shaped table with id + bcrypt password + defaults."""
    import bcrypt
    from app.models import SupabaseAuthConfig

    src_path = str(tmp_path / "src.db")
    tgt_path = str(tmp_path / "tgt.db")
    e = sa.create_engine(f"sqlite:///{src_path}")
    with e.begin() as c:
        c.execute(sa.text("CREATE TABLE users (uid INTEGER PRIMARY KEY, mail TEXT)"))
        c.execute(sa.text("INSERT INTO users VALUES (1,'shakil@x.com'),(2,'abid@x.com')"))
    e.dispose()
    te = sa.create_engine(f"sqlite:///{tgt_path}")
    with te.begin() as c:
        c.execute(sa.text("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, "
                          "encrypted_password TEXT, aud TEXT, role TEXT, "
                          "instance_id TEXT, email_confirmed_at TEXT)"))
    te.dispose()

    monkeypatch.setattr(R, "connector_for", lambda p: _SQLiteRW(p))
    src = SavedConnection(id="s", name="s", flavor="postgresql", database="src", sqlite_path=src_path)
    tgt = SavedConnection(id="t", name="t", flavor="postgresql", database="tgt", sqlite_path=tgt_path)
    m = MappingProfile(
        name="x", source_conn_id="s", target_conn_id="t", source_table="users",
        target_table="users", output_mode="push", batch_size=50, conflict_strategy="insert",
        column_maps=[ColumnMap(source_col="mail", target_col="email")],
        supabase_auth=SupabaseAuthConfig(enabled=True, common_password="Welcome@123"),
    )
    report = list(R.run_migration(m, src, tgt))[-1]["report"]
    assert report["rows_written"] == 2 and report["ok"]

    te = sa.create_engine(f"sqlite:///{tgt_path}")
    with te.connect() as c:
        rows = c.execute(sa.text("SELECT id, email, encrypted_password, aud, role, "
                                 "instance_id, email_confirmed_at FROM users ORDER BY email")).all()
    te.dispose()
    assert len(rows) == 2
    for r in rows:
        assert r.id and r.aud == "authenticated" and r.role == "authenticated"
        assert r.instance_id == "00000000-0000-0000-0000-000000000000"
        assert r.email_confirmed_at is not None
        assert bcrypt.checkpw(b"Welcome@123", r.encrypted_password.encode())


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
