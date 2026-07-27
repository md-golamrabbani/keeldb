"""A corrupt/empty JSON store file must never crash a store — it degrades to
empty and the bad file is preserved as <name>.corrupt for recovery."""
import pytest


@pytest.fixture
def store(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    return store


@pytest.mark.parametrize("body", ["", "   ", "{ not json", "null", "[1,2,3]"])
def test_dict_store_tolerates_bad_file(store, tmp_path, body):
    cs = store.ConnectionStore()
    cs.path.write_text(body)
    # Must not raise, and must degrade to "no connections".
    assert cs.list() == []
    # A present-but-unparseable file is preserved, not destroyed.
    if body.strip() and body not in ("null", "[1,2,3]"):
        assert (tmp_path / "connections.json.corrupt").exists()


@pytest.mark.parametrize("body", ["", "   ", "{bad", '{"k": "v"}'])
def test_history_store_tolerates_bad_file(store, tmp_path, body):
    hs = store.HistoryStore()
    hs.path.write_text(body)
    assert hs.list() == []  # never raises


def test_store_recovers_after_corruption(store):
    from app.models import ConnectionProfileIn
    cs = store.ConnectionStore()
    cs.path.write_text("{ truncated write")
    assert cs.list() == []  # corrupt file moved aside
    # Store is usable again immediately after.
    made = cs.create(ConnectionProfileIn(name="db1", flavor="sqlite", sqlite_path=":memory:"))
    assert made.id
    assert [c.name for c in cs.list()] == ["db1"]
