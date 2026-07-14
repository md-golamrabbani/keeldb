"""Opt-in Supabase auth.users enrichment: id, common bcrypt password, defaults."""
import bcrypt

from app.models import SupabaseAuthConfig
from app.supabase_auth import SupabaseAuthEnricher, enricher_for


def test_disabled_is_completely_inert():
    assert enricher_for(SupabaseAuthConfig()) is None
    assert enricher_for(SupabaseAuthConfig(enabled=False, common_password="x")) is None


def test_enriches_required_auth_fields():
    e = SupabaseAuthEnricher(SupabaseAuthConfig(enabled=True, common_password="secret123"))
    row = e.enrich({"email": "abc@x.com", "phone": "0199"})
    # id generated, and stable across calls for the same email
    assert row["id"] and e.enrich({"email": "abc@x.com"})["id"] == row["id"]
    # password stored as a verifiable bcrypt hash — not plaintext
    assert row["encrypted_password"] != "secret123"
    assert bcrypt.checkpw(b"secret123", row["encrypted_password"].encode())
    # GoTrue defaults + confirmed email
    assert row["aud"] == "authenticated" and row["role"] == "authenticated"
    assert row["instance_id"] == "00000000-0000-0000-0000-000000000000"
    assert row["email_confirmed_at"] is not None


def test_common_password_shared_but_salted_once():
    e = SupabaseAuthEnricher(SupabaseAuthConfig(enabled=True, common_password="pw"))
    a = e.enrich({"email": "a@x.com"})["encrypted_password"]
    b = e.enrich({"email": "b@x.com"})["encrypted_password"]
    assert a == b  # hashed once, reused for every user
    assert bcrypt.checkpw(b"pw", a.encode())


def test_never_overwrites_explicit_values():
    e = SupabaseAuthEnricher(SupabaseAuthConfig(enabled=True, common_password="pw"))
    row = e.enrich({"email": "a@x.com", "id": "keep-me",
                    "encrypted_password": "mapped-hash", "role": "service_role"})
    assert row["id"] == "keep-me"
    assert row["encrypted_password"] == "mapped-hash"
    assert row["role"] == "service_role"


def test_confirm_email_can_be_disabled():
    e = SupabaseAuthEnricher(SupabaseAuthConfig(enabled=True, common_password="pw", confirm_email=False))
    row = e.enrich({"email": "a@x.com"})
    assert "email_confirmed_at" not in row
