"""Pydantic schemas shared across the API."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Flavor = Literal["mysql", "postgresql", "supabase", "neon", "sqlfile", "sqlite"]
ConflictStrategy = Literal["insert", "upsert", "skip"]
OutputMode = Literal["push", "sql", "csv", "json"]
Environment = Literal["dev", "staging", "prod"]

# flavor -> real engine
ENGINE_FOR_FLAVOR: dict[str, str] = {
    "mysql": "mysql",
    "postgresql": "postgres",
    "supabase": "postgres",
    "neon": "postgres",
    "sqlfile": "sqlfile",
    "sqlite": "sqlite",
}


class ConnectionProfileIn(BaseModel):
    name: str
    flavor: Flavor
    host: str = ""
    port: Optional[int] = None
    database: str = ""
    user: str = ""
    password: str = ""
    ssl: bool = False
    # Supabase/Neon preset: paste a full connection string instead of host fields.
    connection_string: str = ""
    service_role_key: str = ""
    extra_params: dict[str, str] = Field(default_factory=dict)
    # SQLite flavor: path to a local .db/.sqlite file.
    sqlite_path: str = ""
    # Optional SSH tunnel (bastion host) — applies to host/port style connections.
    ssh_enabled: bool = False
    ssh_host: str = ""
    ssh_port: int = 22
    ssh_user: str = ""
    ssh_password: str = ""
    ssh_private_key: str = ""
    # Guard: environment label (drives UI coloring + stricter write guards on prod)
    # and a read-only switch enforced by the backend.
    environment: Environment = "dev"
    read_only: bool = False


class ConnectionProfileOut(BaseModel):
    """Public view — secrets never leave the backend."""

    id: str
    name: str
    flavor: Flavor
    host: str = ""
    port: Optional[int] = None
    database: str = ""
    user: str = ""
    ssl: bool = False
    has_password: bool = False
    has_connection_string: bool = False
    extra_params: dict[str, str] = Field(default_factory=dict)
    ssh_enabled: bool = False
    ssh_host: str = ""
    ssh_port: int = 22
    ssh_user: str = ""
    has_ssh_key: bool = False
    # sqlfile connections: original filename + loaded table count, for display.
    source_filename: str = ""
    table_count: int = 0
    environment: Environment = "dev"
    read_only: bool = False


class TestResult(BaseModel):
    ok: bool
    server_version: str = ""
    latency_ms: float = 0
    error: str = ""


class ColumnInfo(BaseModel):
    name: str
    data_type: str
    nullable: bool = True
    is_pk: bool = False
    is_fk: bool = False
    fk_target: str = ""
    default: Optional[str] = None
    char_len: Optional[int] = None
    numeric_precision: Optional[int] = None
    enum_values: list[str] = []
    collation: Optional[str] = None


class TableInfo(BaseModel):
    name: str
    row_estimate: Optional[int] = None


class ColumnMap(BaseModel):
    source_col: str
    target_col: str = ""
    enabled: bool = True
    cast_type: str = ""  # '' | int | numeric | bool | date | timestamp | uuid | text
    cast_format: str = ""  # date/timestamp format string for the cast
    transform_expr: str = ""  # sandboxed expression, see transform/expr.py
    default_value: Optional[str] = None
    is_conflict_key: bool = False


class SupabaseAuthConfig(BaseModel):
    """Opt-in enrichment for pushing users into Supabase's `auth.users` table.

    Completely separate from normal migrations: nothing here runs unless
    `enabled` is True. When on, each row is filled with the fields Supabase Auth
    requires but a plain source table doesn't carry — a generated UUID `id`, a
    bcrypt-hashed common password every user shares, and a confirmed-email
    timestamp so they can log in. Every other `auth.users` column is left to
    Supabase's own defaults. See transform/../supabase_auth.py."""
    enabled: bool = False
    common_password: str = ""      # applied (bcrypt-hashed) to every migrated user
    email_column: str = "email"    # target column holding the email (id is derived from it)
    confirm_email: bool = True     # set email_confirmed_at so users can sign in immediately


class MappingProfile(BaseModel):
    id: str = ""
    name: str
    source_conn_id: str
    target_conn_id: str
    source_schema: str = ""
    source_table: str
    target_schema: str = ""
    target_table: str
    column_maps: list[ColumnMap] = Field(default_factory=list)
    conflict_strategy: ConflictStrategy = "insert"
    batch_size: int = 500
    where_filter: str = ""
    stop_on_error: bool = False
    # Where the transformed rows go: push to the target DB, or download a file.
    output_mode: OutputMode = "push"
    include_ddl: bool = True  # SQL export: emit CREATE TABLE before the INSERTs
    # Opt-in Supabase Auth (auth.users) enrichment — inert unless enabled.
    supabase_auth: SupabaseAuthConfig = Field(default_factory=SupabaseAuthConfig)


class MigrationProject(BaseModel):
    """An ordered group of mapping profiles run together (e.g. a whole-schema
    migration). Tables are loaded FK-parents-first when auto_order is on."""
    id: str = ""
    name: str
    mapping_ids: list[str] = Field(default_factory=list)
    auto_order: bool = True       # topologically order by target FKs before running
    stop_on_error: bool = True    # halt remaining tables if one fails (children need parents)


class Snippet(BaseModel):
    """A saved, named SQL query the user can re-run from the editor."""
    id: str = ""
    name: str
    sql: str
    created_at: str = ""


class Diagram(BaseModel):
    """A saved ER diagram: DBML source + per-table canvas positions."""
    id: str = ""
    name: str
    dbml: str = ""
    positions: dict[str, dict[str, float]] = {}
    created_at: str = ""
    updated_at: str = ""


AiProvider = Literal["anthropic", "openai", "groq"]


class AiSettings(BaseModel):
    """Which LLM powers Ask-AI. api_key is stored Fernet-encrypted, never returned."""
    provider: AiProvider = "anthropic"
    model: str = ""          # empty → provider default
    api_key: str = ""


AlertCondition = Literal["rows_gt_zero", "value_gt", "value_lt"]


class AlertRule(BaseModel):
    """A saved SQL check that fires when its condition is met (e.g. a query
    returns any rows, or a scalar crosses a threshold)."""
    id: str = ""
    name: str
    sql: str
    condition: AlertCondition = "rows_gt_zero"
    threshold: float = 0
    created_at: str = ""


class HistoryEntry(BaseModel):
    """One executed query, auto-recorded from the SQL editor."""
    id: str = ""
    conn_id: str = ""
    sql: str
    ok: bool = True
    rowcount: Optional[int] = None
    elapsed_ms: Optional[float] = None
    ran_at: str = ""


class PreviewRequest(BaseModel):
    conn_id: str
    schema_name: str = ""
    table: str
    limit: int = 20


class TransformPreviewRequest(BaseModel):
    mapping: MappingProfile
    limit: int = 20


class MigrateRequest(BaseModel):
    mapping: MappingProfile
    dry_run: bool = False
    resume_offset: int = 0  # skip this many source rows (checkpoint resume)


class RowError(BaseModel):
    row_index: int
    column: str = ""
    message: str


class Report(BaseModel):
    source_count: int = 0
    rows_read: int = 0
    rows_written: int = 0
    rows_skipped: int = 0
    rows_errored: int = 0
    target_count_after: Optional[int] = None
    errors: list[RowError] = Field(default_factory=list)
    ok: bool = True
    aborted: bool = False


class SavedConnection(BaseModel):
    """Full record as persisted (secrets encrypted by the store)."""

    id: str
    name: str
    flavor: Flavor
    host: str = ""
    port: Optional[int] = None
    database: str = ""
    user: str = ""
    password: str = ""  # plaintext in memory only; encrypted at rest
    ssl: bool = False
    connection_string: str = ""
    service_role_key: str = ""
    extra_params: dict[str, str] = Field(default_factory=dict)
    ssh_enabled: bool = False
    ssh_host: str = ""
    ssh_port: int = 22
    ssh_user: str = ""
    ssh_password: str = ""
    ssh_private_key: str = ""
    # sqlfile connections only.
    sqlite_path: str = ""
    source_filename: str = ""
    table_count: int = 0
    environment: Environment = "dev"
    read_only: bool = False

    def public(self) -> ConnectionProfileOut:
        return ConnectionProfileOut(
            id=self.id,
            name=self.name,
            flavor=self.flavor,
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            ssl=self.ssl,
            has_password=bool(self.password),
            has_connection_string=bool(self.connection_string),
            extra_params=self.extra_params,
            ssh_enabled=self.ssh_enabled,
            ssh_host=self.ssh_host,
            ssh_port=self.ssh_port,
            ssh_user=self.ssh_user,
            has_ssh_key=bool(self.ssh_private_key),
            source_filename=self.source_filename,
            table_count=self.table_count,
            environment=self.environment,
            read_only=self.read_only,
        )
