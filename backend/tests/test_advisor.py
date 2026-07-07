"""Index advisor — duplicate/redundant index + missing-PK detection (SQLite)."""
from app import advisor

SEED = """
CREATE TABLE emp (id INTEGER PRIMARY KEY, dept_id INTEGER, name TEXT, email TEXT);
CREATE INDEX ix_a ON emp(dept_id);
CREATE INDEX ix_dup ON emp(dept_id);
CREATE INDEX ix_multi ON emp(name, email);
CREATE INDEX ix_prefix ON emp(name);
CREATE TABLE logs (msg TEXT);
"""


def _by_kind(res, kind):
    return [f for f in res["findings"] if f["kind"] == kind]


def test_usage_unavailable_on_sqlite(make_conn):
    c = make_conn(SEED)
    res = advisor.index_advice(c, "main")
    c.dispose()
    assert res["dialect"] == "sqlite" and res["usage_available"] is False
    assert not _by_kind(res, "unused_index")  # no usage stats on sqlite


def test_missing_primary_key(make_conn):
    c = make_conn(SEED)
    res = advisor.index_advice(c, "main")
    c.dispose()
    pk = _by_kind(res, "no_primary_key")
    assert len(pk) == 1 and pk[0]["table"] == "logs"


def test_duplicate_index(make_conn):
    c = make_conn(SEED)
    res = advisor.index_advice(c, "main")
    c.dispose()
    dup = _by_kind(res, "duplicate_index")
    assert len(dup) == 1
    names = {dup[0]["index"], dup[0]["covered_by"]}
    assert names == {"ix_a", "ix_dup"}


def test_redundant_prefix_index(make_conn):
    c = make_conn(SEED)
    res = advisor.index_advice(c, "main")
    c.dispose()
    red = _by_kind(res, "redundant_index")
    assert any(f["index"] == "ix_prefix" and f["covered_by"] == "ix_multi" for f in red)


def test_clean_schema_no_findings(make_conn):
    c = make_conn("CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT); CREATE INDEX ix ON t(a)")
    res = advisor.index_advice(c, "main")
    c.dispose()
    assert res["findings"] == []
