"""Database health — table stats + overview (SQLite path)."""
from app import health

SEED = """
CREATE TABLE small (id INTEGER PRIMARY KEY, x TEXT);
CREATE TABLE big (id INTEGER PRIMARY KEY, x TEXT);
INSERT INTO small VALUES (1,'a'),(2,'b');
INSERT INTO big VALUES (1,'a'),(2,'b'),(3,'c'),(4,'d'),(5,'e')
"""


def test_table_stats_sorted_by_rows(make_conn):
    c = make_conn(SEED)
    stats = health.table_stats(c, "main")
    c.dispose()
    names = [t["name"] for t in stats]
    assert names[0] == "big" and names[1] == "small"  # most rows first
    big = next(t for t in stats if t["name"] == "big")
    assert big["rows"] == 5 and big["size_bytes"] is None  # sqlite has no byte size


def test_report_overview(make_conn):
    c = make_conn(SEED)
    rep = health.report(c, "main")
    c.dispose()
    assert rep["dialect"] == "sqlite"
    ov = rep["overview"]
    assert ov["table_count"] == 2
    assert ov["total_rows"] == 7  # 2 + 5
    assert ov["total_size_bytes"] is None
    assert len(rep["tables"]) == 2


def test_empty_database(make_conn):
    c = make_conn("CREATE TABLE only (id INTEGER PRIMARY KEY)")
    rep = health.report(c, "main")
    c.dispose()
    assert rep["overview"]["table_count"] == 1 and rep["overview"]["total_rows"] == 0
