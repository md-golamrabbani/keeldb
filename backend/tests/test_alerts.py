"""Alert rules — store CRUD + evaluation conditions + read-only guard."""
import pytest

from app import alerts
from app.models import AlertRule
from app.store.store import AlertStore

SEED = """
CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT, total REAL);
INSERT INTO orders VALUES (1,'ok',10),(2,'failed',20),(3,'failed',30)
"""


def test_alert_store_crud(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    s = AlertStore()
    saved = s.save(AlertRule(name="failures", sql="SELECT 1"))
    assert saved.id and saved.created_at
    assert len(s.list()) == 1
    assert s.delete(saved.id) is True and s.list() == []


def test_rows_gt_zero_fires_when_rows(make_conn):
    c = make_conn(SEED)
    rule = AlertRule(id="a", name="failed orders", sql="SELECT * FROM orders WHERE status='failed'")
    res = alerts.evaluate(c, rule, "main")
    c.dispose()
    assert res["triggered"] is True and res["value"] == 2


def test_rows_gt_zero_quiet_when_empty(make_conn):
    c = make_conn(SEED)
    rule = AlertRule(name="cancelled", sql="SELECT * FROM orders WHERE status='cancelled'")
    res = alerts.evaluate(c, rule, "main")
    c.dispose()
    assert res["triggered"] is False and res["value"] == 0


def test_value_gt_threshold(make_conn):
    c = make_conn(SEED)
    rule = AlertRule(name="too many failures", sql="SELECT count(*) FROM orders WHERE status='failed'",
                     condition="value_gt", threshold=1)
    res = alerts.evaluate(c, rule, "main")
    c.dispose()
    assert res["triggered"] is True  # 2 > 1


def test_value_lt_threshold(make_conn):
    c = make_conn(SEED)
    rule = AlertRule(name="low stock", sql="SELECT count(*) FROM orders",
                     condition="value_lt", threshold=10)
    res = alerts.evaluate(c, rule, "main")
    c.dispose()
    assert res["triggered"] is True  # 3 < 10


def test_rejects_write_query(make_conn):
    c = make_conn(SEED)
    try:
        with pytest.raises(ValueError):
            alerts.evaluate(c, AlertRule(name="bad", sql="DELETE FROM orders"), "main")
    finally:
        c.dispose()


def test_evaluate_all_isolates_errors(make_conn):
    c = make_conn(SEED)
    rules = [
        AlertRule(id="1", name="ok", sql="SELECT * FROM orders WHERE status='failed'"),
        AlertRule(id="2", name="broken", sql="SELECT * FROM nonexistent_table"),
    ]
    res = alerts.evaluate_all(c, rules, "main")
    c.dispose()
    assert res[0]["triggered"] is True
    assert res[1]["triggered"] is False and res[1]["error"]
