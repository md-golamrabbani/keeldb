"""Query history + saved snippets stores."""
from app.models import HistoryEntry, Snippet
from app.store.store import HistoryStore, SnippetStore


def test_snippet_save_list_delete(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    s = SnippetStore()
    saved = s.save(Snippet(name="active users", sql="SELECT * FROM users WHERE active"))
    assert saved.id and saved.created_at
    got = s.list()
    assert len(got) == 1 and got[0].name == "active users"
    assert s.delete(saved.id) is True
    assert s.list() == []
    assert s.delete("nope") is False


def test_snippet_update_preserves_id_and_created_at(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    s = SnippetStore()
    created = s.save(Snippet(name="Untitled query 1", sql=""))
    # auto-save: same id, new sql, created_at unchanged
    created.sql = "SELECT 1"
    updated = s.save(created)
    assert updated.id == created.id and updated.created_at == created.created_at
    assert s.get(created.id).sql == "SELECT 1"


def test_snippets_newest_first(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    s = SnippetStore()
    s.save(Snippet(name="a", sql="SELECT 1", created_at="2026-01-01T00:00:00"))
    s.save(Snippet(name="b", sql="SELECT 2", created_at="2026-06-01T00:00:00"))
    names = [x.name for x in s.list()]
    assert names == ["b", "a"]


def test_history_record_and_list(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    h = HistoryStore()
    h.record(HistoryEntry(conn_id="c1", sql="SELECT 1", ok=True, rowcount=1))
    h.record(HistoryEntry(conn_id="c1", sql="SELECT 2", ok=True, rowcount=2))
    items = h.list("c1")
    assert [i.sql for i in items] == ["SELECT 2", "SELECT 1"]  # newest first


def test_history_dedupes_consecutive(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    h = HistoryStore()
    h.record(HistoryEntry(conn_id="c1", sql="SELECT 1"))
    h.record(HistoryEntry(conn_id="c1", sql="SELECT 1"))  # duplicate, skipped
    h.record(HistoryEntry(conn_id="c1", sql="SELECT 2"))
    assert len(h.list("c1")) == 2


def test_history_filters_by_connection(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    h = HistoryStore()
    h.record(HistoryEntry(conn_id="c1", sql="SELECT 1"))
    h.record(HistoryEntry(conn_id="c2", sql="SELECT 2"))
    assert len(h.list("c1")) == 1 and len(h.list("c2")) == 1
    assert len(h.list()) == 2  # no filter → all


def test_history_cap(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    h = HistoryStore()
    h.MAX = 5
    for i in range(10):
        h.record(HistoryEntry(conn_id="c1", sql=f"SELECT {i}"))
    items = h.list("c1", limit=100)
    assert len(items) == 5 and items[0].sql == "SELECT 9"  # newest kept


def test_history_clear(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    h = HistoryStore()
    h.record(HistoryEntry(conn_id="c1", sql="SELECT 1"))
    h.record(HistoryEntry(conn_id="c2", sql="SELECT 2"))
    assert h.clear("c1") == 1
    assert len(h.list("c1")) == 0 and len(h.list("c2")) == 1
    assert h.clear() == 1  # clears the rest
    assert h.list() == []
