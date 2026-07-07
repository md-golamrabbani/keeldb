"""Single shared-password auth: token issue/verify + enabled gating."""
import time

from app import auth


def test_disabled_when_no_password(monkeypatch):
    monkeypatch.setattr(auth, "PASSWORD", "")
    assert auth.enabled() is False
    assert auth.check_password("anything") is False


def test_check_password(monkeypatch):
    monkeypatch.setattr(auth, "PASSWORD", "s3cret")
    assert auth.enabled() is True
    assert auth.check_password("s3cret") is True
    assert auth.check_password("wrong") is False
    assert auth.check_password("") is False


def test_token_round_trip(monkeypatch, tmp_path):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    token = auth.issue_token()
    assert auth.verify_token(token) is True
    assert auth.verify_token("garbage") is False
    assert auth.verify_token("") is False
    assert auth.verify_token(token + "x") is False  # tampered signature


def test_expired_token_rejected(monkeypatch, tmp_path):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    token = auth.issue_token(ttl=-10)  # already expired
    assert auth.verify_token(token) is False


def test_token_signed_by_this_secret_only(monkeypatch, tmp_path):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    exp = int(time.time()) + 100
    forged = f"{exp}.{'0' * 64}"  # right shape, wrong signature
    assert auth.verify_token(forged) is False
