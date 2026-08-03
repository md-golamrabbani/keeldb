"""PostgresConnector.url() SSL-mode resolution — an explicit sslmode must be
able to override the managed-flavor default (self-hosted pooler without TLS)."""
from app.connectors.postgres import PostgresConnector
from app.models import SavedConnection


def _url(**kw) -> str:
    base = dict(id="1", name="t", flavor="postgresql", host="h", port=6432,
                database="postgres", user="u", password="p")
    base.update(kw)
    return PostgresConnector(SavedConnection(**base)).url()


def test_plain_pg_has_no_forced_sslmode():
    # libpq's default (prefer) — connects with or without SSL.
    assert "sslmode" not in _url()


def test_supabase_defaults_to_require():
    assert "sslmode=require" in _url(flavor="supabase")


def test_explicit_sslmode_overrides_managed_default():
    url = _url(flavor="supabase", sslmode="disable")
    assert "sslmode=disable" in url and "require" not in url


def test_ssl_toggle_defaults_to_require():
    assert "sslmode=require" in _url(ssl=True)


def test_extra_params_sslmode_used():
    assert "sslmode=prefer" in _url(extra_params={"sslmode": "prefer"})


def test_connection_string_gets_explicit_sslmode():
    url = _url(connection_string="postgresql://u:p@h:6432/postgres", sslmode="disable")
    assert url.startswith("postgresql+psycopg://") and "sslmode=disable" in url


def test_connection_string_supabase_default_require():
    assert "sslmode=require" in _url(
        flavor="supabase", connection_string="postgresql://u:p@h:6432/postgres")


def test_connection_string_keeps_existing_sslmode():
    url = _url(flavor="supabase",
               connection_string="postgresql://u:p@h:6432/postgres?sslmode=disable")
    assert "sslmode=disable" in url and "sslmode=require" not in url
