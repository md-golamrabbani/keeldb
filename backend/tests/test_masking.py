"""Data masking / anonymization transforms — determinism, safety, sandbox wiring."""
from app.transform import masking
from app.transform.expr import eval_expr, validate_expr


def test_deterministic_same_input_same_output():
    # The core guarantee: repeated values map identically, so FKs stay consistent.
    assert masking.fake_email("alice@corp.com") == masking.fake_email("alice@corp.com")
    assert masking.fake_name("employee-42") == masking.fake_name("employee-42")
    assert masking.fake_phone("555-0100") == masking.fake_phone("555-0100")


def test_different_inputs_differ():
    emails = {masking.fake_email(f"user{i}@x.com") for i in range(50)}
    assert len(emails) > 40  # low collision rate across distinct inputs


def test_no_pii_leaks_into_output():
    real = "john.smith@acme.com"
    out = masking.fake_email(real)
    assert "john" not in out and "smith" not in out and "acme" not in out
    assert out.split("@")[1] in masking.DOMAINS  # fictional domain only


def test_fake_phone_uses_fictional_exchange():
    for seed in ("a", "bb", "12345", "x@y.z"):
        assert "-555-" in masking.fake_phone(seed)


def test_blank_and_null_pass_through():
    for fn in (masking.fake_email, masking.fake_name, masking.fake_phone, masking.mask_email):
        assert fn(None) is None
        assert fn("") == ""


def test_mask_keep_first_last_and_all():
    assert masking.mask("Golam", 2) == "Go***"
    assert masking.mask("4711", -2) == "**11"
    assert masking.mask("secret", 0) == "******"
    assert masking.mask("ab", 5) == "ab"  # keep beyond length -> unchanged


def test_mask_email_keeps_domain():
    assert masking.mask_email("golam@company.com") == "g****@company.com"
    assert masking.mask_email("a@b.com") == "a*@b.com"
    assert masking.mask_email("not-an-email") == "n***********"


def test_hash_hex_stable_and_length():
    a = masking.hash_hex("v", 12)
    assert a == masking.hash_hex("v", 12) and len(a) == 12
    assert all(ch in "0123456789abcdef" for ch in a)


def test_redact():
    assert masking.redact("anything") == "REDACTED"
    assert masking.redact(None) is None


def test_available_in_sandbox():
    # Reachable through the same safe expression engine as other transforms.
    row = {"email": "real@corp.com", "name": "Real Person"}
    assert validate_expr("fake_email(value)") == ""
    assert validate_expr("mask(value, 2)") == ""
    assert eval_expr("fake_email(row['email'])", "real@corp.com", row) == masking.fake_email("real@corp.com")
    assert eval_expr("mask(value, -4)", "1234567890", row) == "******7890"
