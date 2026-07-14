"""Supabase Admin API bulk user creation (offline, via a fake create_fn)."""
from app.supabase_admin import iter_create_users, normalize_base_url, password_for


def test_normalize_base_url():
    assert normalize_base_url("https://x.supabase.co/") == "https://x.supabase.co"
    assert normalize_base_url("x.supabase.co") == "https://x.supabase.co"
    assert normalize_base_url("  https://x.supabase.co  ") == "https://x.supabase.co"


def test_password_rules():
    assert password_for("khalid.pervez@x.com", "email_prefix", "") == "khalid.pervez"
    assert password_for("musa@x.com", "email_prefix", "") == "musa@2024"   # padded to >= 6
    assert password_for("anyone@x.com", "common", "Shared#1") == "Shared#1"


def test_dry_run_previews_without_calling():
    calls = []
    events = list(iter_create_users("https://x.supabase.co", "k", ["a@x.com", "b@x.com"],
                                    dry_run=True, create_fn=lambda *a: calls.append(a) or (200, "")))
    assert calls == []  # nothing created in dry-run
    assert [e["event"] for e in events][0] == "start"
    assert any(e["event"] == "preview" and e["email"] == "a@x.com" for e in events)
    assert events[-1] == {"event": "done", "total": 2, "created": 0, "skipped": 0,
                          "failed": 0, "dry_run": True}


def test_create_counts_and_skips_existing():
    def fake(base, key, email, pw, confirm):
        if email == "dup@x.com":
            return 422, '{"msg":"A user with this email address has already been registered"}'
        if email == "bad@x.com":
            return 500, "boom"
        return 200, "{}"
    emails = ["ok1@x.com", "dup@x.com", "bad@x.com", "ok2@x.com"]
    events = list(iter_create_users("https://x.supabase.co", "k", emails,
                                    dry_run=False, sleep=0, create_fn=fake))
    done = events[-1]
    assert done["created"] == 2 and done["skipped"] == 1 and done["failed"] == 1
    assert any(e["event"] == "user_error" and e["email"] == "bad@x.com" for e in events)


def test_common_mode_uses_shared_password():
    seen = []
    list(iter_create_users("https://x.supabase.co", "k", ["a@x.com", "b@x.com"],
                           password_mode="common", common_password="Shared#1",
                           dry_run=False, sleep=0,
                           create_fn=lambda b, k, e, pw, c: seen.append(pw) or (200, "")))
    assert seen == ["Shared#1", "Shared#1"]
