"""Diagram store CRUD and the AI diagram endpoint's graceful degradation."""
from __future__ import annotations

from app import ai
from app.models import Diagram
from app.store import diagram_store


def test_diagram_store_roundtrip():
    d = diagram_store.save(Diagram(name="Blog", dbml="Table users { id int [pk] }",
                                   positions={"users": {"x": 10, "y": 20}}))
    assert d.id and d.created_at and d.updated_at

    got = diagram_store.get(d.id)
    assert got and got.name == "Blog" and got.positions["users"]["x"] == 10

    d.name = "Blog v2"
    diagram_store.save(d)
    assert diagram_store.get(d.id).name == "Blog v2"

    assert any(x.id == d.id for x in diagram_store.list())
    assert diagram_store.delete(d.id)
    assert diagram_store.get(d.id) is None


def test_ai_dbml_unconfigured_degrades(monkeypatch):
    monkeypatch.setattr(ai, "_resolve", lambda: ("anthropic", "", ""))
    out = ai.edit_dbml("Table t { id int }", "add a name column")
    assert out["available"] is False and "AI assist" in out["message"]


def test_ai_dbml_strips_fences(monkeypatch):
    monkeypatch.setattr(ai, "_resolve", lambda: ("anthropic", "k", "m"))
    monkeypatch.setattr(ai, "_call_llm", lambda *a: "```dbml\nTable t {\n  id int [pk]\n}\n```")
    out = ai.edit_dbml("", "make a table t")
    assert out["available"] and out["dbml"].startswith("Table t {") and out["dbml"].endswith("}")
