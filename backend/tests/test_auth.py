"""Local app-unlock auth: setup, verify, tokens, sliding-session expiry."""
import time

import pytest

from app import auth


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    import app.store.store as store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    monkeypatch.setattr(auth, "_ENV_PW", "")
    monkeypatch.setattr(auth, "_OFF", False)
    return tmp_path


def test_first_launch_needs_setup(data_dir):
    assert auth.enabled() is True
    assert auth.is_configured() is False
    assert auth.needs_setup() is True


def test_setup_then_configured(data_dir):
    auth.setup("hunter2")
    assert auth.is_configured() is True
    assert auth.needs_setup() is False
    # password is not stored in plaintext
    raw = (data_dir / "auth_password.json").read_text()
    assert "hunter2" not in raw


def test_setup_only_once(data_dir):
    auth.setup("first")
    with pytest.raises(ValueError):
        auth.setup("second")


def test_check_password(data_dir):
    auth.setup("correct-horse")
    assert auth.check_password("correct-horse") is True
    assert auth.check_password("wrong") is False
    assert auth.check_password("") is False


def test_disabled_via_env(data_dir, monkeypatch):
    monkeypatch.setattr(auth, "_OFF", True)
    assert auth.enabled() is False and auth.needs_setup() is False


def test_env_password_mode(data_dir, monkeypatch):
    monkeypatch.setattr(auth, "_ENV_PW", "shared")
    assert auth.is_configured() is True and auth.needs_setup() is False
    assert auth.check_password("shared") is True and auth.check_password("no") is False


def test_token_round_trip_and_forgery(data_dir):
    token = auth.issue_token()
    assert auth.verify_token(token) is True
    assert auth.verify_token("garbage") is False
    assert auth.verify_token("") is False
    exp = int(time.time()) + 100
    assert auth.verify_token(f"{exp}.{'0' * 64}") is False  # right shape, wrong sig


def test_expired_token(data_dir):
    assert auth.verify_token(auth.issue_token(ttl=-10)) is False


def test_token_from_header():
    assert auth.token_from_header("Bearer abc.def") == "abc.def"
    assert auth.token_from_header("bearer abc.def") == "abc.def"
    assert auth.token_from_header("") == ""
    assert auth.token_from_header("Basic x") == ""
