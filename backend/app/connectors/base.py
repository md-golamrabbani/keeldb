"""Connector abstraction: one uniform API over MySQL and Postgres.

All introspection goes through SQLAlchemy reflection so both engines behave
identically from the API's point of view. Only upsert SQL differs per dialect
(see mysql.py / postgres.py).
"""
from __future__ import annotations

import time
from abc import ABC, abstractmethod
from typing import Any, Iterator, Optional

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from ..models import ColumnInfo, SavedConnection, TableInfo, TestResult


class Connector(ABC):
    #: default TCP port for this engine (overridden per dialect)
    default_port: int = 0

    def __init__(self, profile: SavedConnection):
        self.profile = profile
        self._engine: Optional[Engine] = None
        self._tunnel = None  # sshtunnel.SSHTunnelForwarder
        self._pkey_path: Optional[str] = None
        # Effective host/port to connect to — replaced by the SSH tunnel's local
        # bind address when a tunnel is active.
        self.effective_host = profile.host
        self.effective_port = profile.port or self.default_port

    # -- engine ------------------------------------------------------------
    @abstractmethod
    def url(self) -> str:
        """SQLAlchemy connection URL for this profile."""

    def _open_tunnel_if_needed(self) -> None:
        """Open an SSH tunnel to the DB host and point the connector at the
        local forwarded port. Only applies to host/port style connections."""
        if not getattr(self.profile, "ssh_enabled", False) or self._tunnel is not None:
            return
        if not self.profile.host:
            return  # connection-string mode: nothing to forward
        import tempfile

        from sshtunnel import SSHTunnelForwarder

        kwargs: dict = {
            "ssh_username": self.profile.ssh_user or None,
            "remote_bind_address": (self.profile.host, self.profile.port or self.default_port),
        }
        if self.profile.ssh_private_key:
            fd, self._pkey_path = tempfile.mkstemp(prefix="dbms_key_")
            import os

            with os.fdopen(fd, "w") as f:
                f.write(self.profile.ssh_private_key)
            os.chmod(self._pkey_path, 0o600)
            kwargs["ssh_pkey"] = self._pkey_path
            if self.profile.ssh_password:
                kwargs["ssh_private_key_password"] = self.profile.ssh_password
        elif self.profile.ssh_password:
            kwargs["ssh_password"] = self.profile.ssh_password

        self._tunnel = SSHTunnelForwarder(
            (self.profile.ssh_host, int(self.profile.ssh_port or 22)), **kwargs
        )
        self._tunnel.start()
        self.effective_host = "127.0.0.1"
        self.effective_port = self._tunnel.local_bind_port

    @property
    def engine(self) -> Engine:
        if self._engine is None:
            self._open_tunnel_if_needed()
            self._engine = sa.create_engine(self.url(), pool_pre_ping=True)
        return self._engine

    def dispose(self) -> None:
        if self._engine is not None:
            self._engine.dispose()
            self._engine = None
        if self._tunnel is not None:
            try:
                self._tunnel.stop()
            except Exception:
                pass
            self._tunnel = None
        if self._pkey_path is not None:
            import os

            try:
                os.unlink(self._pkey_path)
            except OSError:
                pass
            self._pkey_path = None

    # -- introspection (read-only) ------------------------------------------
    def test_connection(self) -> TestResult:
        start = time.perf_counter()
        try:
            with self.engine.connect() as conn:
                version = conn.execute(sa.text("SELECT version()")).scalar() or ""
            latency = (time.perf_counter() - start) * 1000
            return TestResult(ok=True, server_version=str(version), latency_ms=round(latency, 1))
        except Exception as exc:  # surfaced to the UI status pill
            return TestResult(ok=False, error=str(exc))

    def list_schemas(self) -> list[str]:
        return sorted(sa.inspect(self.engine).get_schema_names())

    @abstractmethod
    def _row_estimates(self, schema: str) -> dict[str, int]:
        """Cheap per-table row estimates from catalog tables."""

    def list_tables(self, schema: str) -> list[TableInfo]:
        names = sa.inspect(self.engine).get_table_names(schema=schema or None)
        try:
            estimates = self._row_estimates(schema)
        except Exception:
            estimates = {}
        return [TableInfo(name=n, row_estimate=estimates.get(n)) for n in sorted(names)]

    def list_columns(self, schema: str, table: str) -> list[ColumnInfo]:
        insp = sa.inspect(self.engine)
        schema = schema or None
        pk = set(insp.get_pk_constraint(table, schema=schema).get("constrained_columns") or [])
        fks: dict[str, str] = {}
        for fk in insp.get_foreign_keys(table, schema=schema):
            target = f"{fk.get('referred_table')}({', '.join(fk.get('referred_columns') or [])})"
            for col in fk.get("constrained_columns") or []:
                fks[col] = target
        out: list[ColumnInfo] = []
        for col in insp.get_columns(table, schema=schema):
            ctype = col["type"]
            default = col.get("default")
            out.append(
                ColumnInfo(
                    name=col["name"],
                    data_type=str(ctype),
                    nullable=bool(col.get("nullable", True)),
                    is_pk=col["name"] in pk,
                    is_fk=col["name"] in fks,
                    fk_target=fks.get(col["name"], ""),
                    default=str(default) if default is not None else None,
                    char_len=getattr(ctype, "length", None),
                    numeric_precision=getattr(ctype, "precision", None),
                    enum_values=list(getattr(ctype, "enums", None) or []),
                    collation=getattr(ctype, "collation", None),
                )
            )
        return out

    def _table(self, schema: str, table: str) -> sa.Table:
        return sa.Table(table, sa.MetaData(), autoload_with=self.engine, schema=schema or None)

    def sample_rows(self, schema: str, table: str, limit: int = 20) -> list[dict[str, Any]]:
        t = self._table(schema, table)
        with self.engine.connect() as conn:
            rows = conn.execute(sa.select(t).limit(limit)).mappings().all()
        return [dict(r) for r in rows]

    def count_rows(self, schema: str, table: str, where: str = "") -> int:
        t = self._table(schema, table)
        q = sa.select(sa.func.count()).select_from(t)
        if where:
            q = q.where(sa.text(where))
        with self.engine.connect() as conn:
            return int(conn.execute(q).scalar() or 0)

    def read_batches(
        self,
        schema: str,
        table: str,
        columns: list[str],
        batch_size: int = 500,
        where: str = "",
    ) -> Iterator[list[dict[str, Any]]]:
        """Stream the source in batches. Keyset pagination when a single-column
        PK is available (stable + fast), otherwise ordered OFFSET pagination."""
        t = self._table(schema, table)
        cols = [t.c[c] for c in columns]
        pk_cols = list(t.primary_key.columns)
        keyset = pk_cols[0] if len(pk_cols) == 1 else None
        if keyset is not None and keyset.name not in columns:
            cols = cols + [keyset]

        with self.engine.connect() as conn:
            if keyset is not None:
                last = None
                while True:
                    q = sa.select(*cols).order_by(keyset.asc()).limit(batch_size)
                    if where:
                        q = q.where(sa.text(where))
                    if last is not None:
                        q = q.where(keyset > last)
                    rows = conn.execute(q).mappings().all()
                    if not rows:
                        return
                    last = rows[-1][keyset.name]
                    yield [{c: r[c] for c in columns} for r in rows]
            else:
                order = [t.c[c].asc() for c in columns]
                offset = 0
                while True:
                    q = sa.select(*cols).order_by(*order).limit(batch_size).offset(offset)
                    if where:
                        q = q.where(sa.text(where))
                    rows = conn.execute(q).mappings().all()
                    if not rows:
                        return
                    offset += len(rows)
                    yield [{c: r[c] for c in columns} for r in rows]

    # -- writes --------------------------------------------------------------
    @abstractmethod
    def write_batch(
        self,
        schema: str,
        table: str,
        rows: list[dict[str, Any]],
        conflict_strategy: str = "insert",
        conflict_keys: Optional[list[str]] = None,
    ) -> dict[str, int]:
        """Insert one batch inside a transaction. Returns {written, skipped}."""
