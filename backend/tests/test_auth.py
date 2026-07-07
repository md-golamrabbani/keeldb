"""Local app-unlock auth: setup, recovery via security answer, 3-strike block."""
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


def _setup(pw="hunter2", q="First pet?", a="Rex"):
    auth.setup(pw, q, a)


def test_first_launch_needs_setup(data_dir):
    assert auth.enabled() and auth.needs_setup() and not auth.is_configured()


def test_setup_requires_question_and_answer(data_dir):
    with pytest.raises(ValueError):
        auth.setup("pw", "", "")


def test_setup_then_configured_no_plaintext(data_dir):
    _setup()
    assert auth.is_configured() and not auth.needs_setup()
    assert auth.security_question() == "First pet?"
    raw = (data_dir / "auth_password.json").read_text()
    assert "hunter2" not in raw and "Rex" not in raw  # neither pw nor answer stored plainly


def test_check_password(data_dir):
    _setup()
    assert auth.check_password("hunter2") is True
    assert auth.check_password("wrong") is False


def test_recover_with_correct_answer_resets_password(data_dir):
    _setup()
    res = auth.recover("  rex ", "newpass")  # answer is normalized (trim/case)
    assert res["ok"] is True
    assert auth.check_password("newpass") is True
    assert auth.check_password("hunter2") is False


def test_recover_wrong_answer_counts_down_then_blocks(data_dir):
    _setup()
    r1 = auth.recover("nope", "x"); assert r1 == {"ok": False, "blocked": False, "attempts_left": 2}
    r2 = auth.recover("nope", "x"); assert r2["attempts_left"] == 1 and not r2["blocked"]
    r3 = auth.recover("nope", "x"); assert r3["blocked"] is True and r3["attempts_left"] == 0
    assert auth.is_blocked() is True
    # once blocked, even the right answer won't help
    assert auth.recover("Rex", "y")["blocked"] is True


def test_token_round_trip_and_expiry(data_dir):
    assert auth.verify_token(auth.issue_token()) is True
    assert auth.verify_token("garbage") is False
    assert auth.verify_token(auth.issue_token(ttl=-5)) is False
    exp = int(time.time()) + 100
    assert auth.verify_token(f"{exp}.{'0' * 64}") is False


def test_env_and_off_modes(data_dir, monkeypatch):
    monkeypatch.setattr(auth, "_OFF", True)
    assert auth.enabled() is False
    monkeypatch.setattr(auth, "_OFF", False)
    monkeypatch.setattr(auth, "_ENV_PW", "shared")
    assert auth.is_configured() and not auth.needs_setup()
    assert auth.check_password("shared") is True
    with pytest.raises(ValueError):
        auth.recover("x", "y")  # recovery not available in shared mode
