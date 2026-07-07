"""Server metrics — SQLite reports unsupported."""
from app import metrics


def test_metrics_unsupported_on_sqlite(make_conn):
    c = make_conn("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    res = metrics.server_metrics(c)
    c.dispose()
    assert res["supported"] is False and res["dialect"] == "sqlite" and res["metrics"] == []
