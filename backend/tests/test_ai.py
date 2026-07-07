"""AI assist — graceful degradation when no API key is configured."""
import pytest

from app import ai


def test_unavailable_without_key(make_conn, monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    monkeypatch.setattr(ai, "ai_settings_store", store.AiSettingsStore())
    c = make_conn("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    res = ai.nl_to_sql(c, "main", "how many rows in t")
    c.dispose()
    assert res["available"] is False and res["sql"] == "" and "configured" in res["message"].lower()


def test_settings_store_encrypts_key(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    from app.models import AiSettings
    s = store.AiSettingsStore()
    s.save(AiSettings(provider="groq", model="llama-3.3-70b-versatile", api_key="secret-key"))
    # round-trips decrypted…
    assert s.get().api_key == "secret-key" and s.get().provider == "groq"
    # …but the key is not stored in plaintext
    raw = (tmp_path / "ai_settings.json").read_text()
    assert "secret-key" not in raw


def test_empty_question_rejected(make_conn):
    c = make_conn("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    try:
        with pytest.raises(ValueError):
            ai.nl_to_sql(c, "main", "   ")
    finally:
        c.dispose()


def test_strip_fences():
    assert ai._strip_fences("```sql\nSELECT 1;\n```") == "SELECT 1"
    assert ai._strip_fences("SELECT 1") == "SELECT 1"
    assert ai._strip_fences("```\nSELECT a FROM t\n```") == "SELECT a FROM t"


def test_describe_schema_lists_columns(make_conn):
    c = make_conn("CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT)")
    desc = ai._describe_schema(c, "main")
    c.dispose()
    assert "emp(" in desc and "id" in desc and "name" in desc
