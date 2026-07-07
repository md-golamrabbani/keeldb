"""Portable project files — export strips secrets, import recreates + skips dups."""
import pytest

from app.models import AlertRule, MappingProfile, SavedConnection, Snippet


@pytest.fixture
def portable_env(tmp_path, monkeypatch):
    """Fresh, isolated stores wired into the portable module."""
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    stores = {
        "connection_store": store.ConnectionStore(),
        "mapping_store": store.MappingStore(),
        "project_store": store.ProjectStore(),
        "snippet_store": store.SnippetStore(),
        "alert_store": store.AlertStore(),
    }
    import app.portable as portable
    for name, inst in stores.items():
        monkeypatch.setattr(portable, name, inst)
    return portable, stores


def test_export_strips_secrets_and_sqlfile(portable_env):
    portable, s = portable_env
    s["connection_store"].add(SavedConnection(
        id="c1", name="prod", flavor="postgresql", host="db", user="u",
        password="SECRET", connection_string="postgres://secret", service_role_key="KEY"))
    s["connection_store"].add(SavedConnection(id="f1", name="dump", flavor="sqlfile", sqlite_path="/tmp/x.db"))

    bundle = portable.export_bundle()
    assert len(bundle["connections"]) == 1  # sqlfile excluded
    c = bundle["connections"][0]
    assert c["name"] == "prod"
    assert c["password"] == "" and c["connection_string"] == "" and c["service_role_key"] == ""


def test_export_includes_recipes(portable_env):
    portable, s = portable_env
    s["mapping_store"].save(MappingProfile(id="m1", name="m", source_conn_id="a", target_conn_id="b", source_table="t", target_table="t"))
    s["snippet_store"].save(Snippet(id="sn1", name="snip", sql="SELECT 1"))
    s["alert_store"].save(AlertRule(id="al1", name="al", sql="SELECT 1"))
    bundle = portable.export_bundle()
    assert [m["id"] for m in bundle["mappings"]] == ["m1"]
    assert [x["id"] for x in bundle["snippets"]] == ["sn1"]
    assert [a["id"] for a in bundle["alerts"]] == ["al1"]


def test_import_recreates_and_skips_existing(portable_env):
    portable, s = portable_env
    s["snippet_store"].save(Snippet(id="keep", name="existing", sql="SELECT 1"))
    bundle = {
        "version": 1,
        "connections": [{"id": "c9", "name": "imported", "flavor": "mysql", "host": "h", "user": "u", "password": "x"}],
        "mappings": [{"id": "m9", "name": "m", "source_conn_id": "a", "target_conn_id": "b", "source_table": "t", "target_table": "t"}],
        "snippets": [{"id": "keep", "name": "dup", "sql": "SELECT 2"}, {"id": "new", "name": "fresh", "sql": "SELECT 3"}],
        "alerts": [{"id": "a9", "name": "al", "sql": "SELECT 1", "condition": "rows_gt_zero", "threshold": 0}],
    }
    res = portable.import_bundle(bundle)["imported"]
    assert res["connections"] == 1 and res["mappings"] == 1 and res["alerts"] == 1
    assert res["snippets"] == 1  # "keep" skipped, only "new" added

    # imported connection carries no secret
    imported = s["connection_store"].get("c9")
    assert imported.name == "imported" and imported.password == ""
    # existing snippet not clobbered
    assert next(x for x in s["snippet_store"].list() if x.id == "keep").name == "existing"


def test_import_rejects_garbage(portable_env):
    portable, _ = portable_env
    with pytest.raises(ValueError):
        portable.import_bundle({"nope": True})
    with pytest.raises(ValueError):
        portable.import_bundle("not a dict")
