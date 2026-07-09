export type Flavor = "mysql" | "postgresql" | "supabase" | "neon" | "sqlfile";
export type ConflictStrategy = "insert" | "upsert" | "skip";
export type OutputMode = "push" | "sql" | "csv" | "json";
export type Environment = "dev" | "staging" | "prod";

export interface ConnectionProfileIn {
  name: string;
  flavor: Flavor;
  host: string;
  port: number | null;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  connection_string: string;
  service_role_key: string;
  extra_params: Record<string, string>;
  ssh_enabled: boolean;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_password: string;
  ssh_private_key: string;
  environment: Environment;
  read_only: boolean;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  flavor: Flavor;
  host: string;
  port: number | null;
  database: string;
  user: string;
  ssl: boolean;
  has_password: boolean;
  has_connection_string: boolean;
  extra_params: Record<string, string>;
  ssh_enabled: boolean;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  has_ssh_key: boolean;
  source_filename: string;
  table_count: number;
  environment: Environment;
  read_only: boolean;
}

export interface OrphanCheck {
  columns: string[];
  ref_table: string;
  ref_columns: string[];
  orphans?: number;
  error?: string;
}
export interface OrphanResult {
  tables: { table: string; checks: OrphanCheck[] }[];
  total_orphans: number;
  scanned: number;
}

export interface RollbackSim {
  target_exists: boolean;
  source_rows: number;
  target_rows_before: number;
  strategy: ConflictStrategy;
  conflict_keys: string[];
  rollback: "clean" | "partial" | "lossy";
  data_loss_risk: "none" | "low" | "high";
  max_overwrites: number;
  lock_risk: "negligible" | "low" | "moderate" | "high";
  tables_affected: string[];
  plan: string[];
  recommendation: string;
}

export interface DuplicateGroup {
  values: Record<string, string | number | boolean | null>;
  count: number;
}
export interface DuplicateResult {
  columns: string[];
  groups: DuplicateGroup[];
  group_count: number;      // total duplicate groups (unbounded by limit)
  redundant_rows: number;   // rows beyond the first in each group
  truncated: boolean;
}

export interface DependentGroup {
  table: string;
  columns: string[];
  ref_columns: string[];
  on_delete: string | null;
  count: number;
  sample: Record<string, string | number | boolean | null>[];
}
export interface DependentsResult {
  found: boolean;
  pk: Record<string, string | number | boolean | null>;
  dependents: DependentGroup[];
  total_dependents: number;
  referencing_tables: number;
}

export interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}
export interface IndexList {
  table: string;
  indexes: TableIndex[];
}
export interface ConstraintList {
  table: string;
  primary_key: { name: string | null; columns: string[] };
  foreign_keys: { name: string | null; columns: string[]; ref_table: string; ref_columns: string[]; on_delete: string | null }[];
  unique: { name: string | null; columns: string[] }[];
  checks: { name: string | null; sqltext: string | null }[];
}

export interface TableStat {
  name: string;
  rows: number;
  size_bytes: number | null;
  index_bytes: number | null;
}
export interface HealthReport {
  dialect: string;
  overview: { table_count: number; total_rows: number; total_size_bytes: number | null };
  tables: TableStat[];
}

export interface MetricTile {
  key: string;
  label: string;
  value: number | null;
  unit: string;
}
export interface ServerMetrics {
  supported: boolean;
  dialect: string;
  metrics: MetricTile[];
}

export type AlertCondition = "rows_gt_zero" | "value_gt" | "value_lt";
export interface AlertRule {
  id: string;
  name: string;
  sql: string;
  condition: AlertCondition;
  threshold: number;
  created_at: string;
}
export interface AlertResult {
  rule_id: string;
  name: string;
  triggered: boolean;
  value: string | number | null;
  detail: string;
  error: string | null;
}

export interface Session {
  id: number;
  user: string | null;
  db: string | null;
  state: string | null;
  wait: string | null;
  query: string | null;
  duration_s: number | null;
  is_self: boolean;
}
export interface ActivityReport {
  supported: boolean;
  dialect: string;
  sessions: Session[];
}

export interface IndexFinding {
  level: "warn" | "info";
  kind: "no_primary_key" | "duplicate_index" | "redundant_index" | "unused_index";
  table: string;
  message: string;
  index: string | null;
  covered_by: string | null;
}
export interface IndexAdvice {
  dialect: string;
  usage_available: boolean;
  findings: IndexFinding[];
}

export interface AiSettingsPublic {
  provider: string;
  model: string;
  effective_model: string;
  has_key: boolean;
  providers: { value: string; label: string; default_model: string }[];
}

export interface Snippet {
  id: string;
  name: string;
  sql: string;
  created_at: string;
}
export interface HistoryEntry {
  id: string;
  conn_id: string;
  sql: string;
  ok: boolean;
  rowcount: number | null;
  elapsed_ms: number | null;
  ran_at: string;
}

export interface PlanHint {
  level: "warn" | "info";
  message: string;
  table: string | null;
}
export interface QueryPlan {
  dialect: string;
  sql: string;
  plan: { detail: string }[];
  plan_text: string;
  hints: PlanHint[];
  scans: string[];
  total_cost?: number;
}

export interface ColumnProfile {
  name: string;
  type: string;
  kind: "numeric" | "bool" | "datetime" | "text" | "other";
  null_count: number;
  null_pct: number;
  distinct: number;
  distinct_pct: number;
  unique: boolean;
  min: string | number | boolean | null;
  max: string | number | boolean | null;
  avg: number | null;
  pattern: string | null;
  pattern_pct: number;
}
export interface TableProfile {
  table: string;
  total_rows: number;
  columns: ColumnProfile[];
}

export interface MigrationProject {
  id: string;
  name: string;
  mapping_ids: string[];
  auto_order: boolean;
  stop_on_error: boolean;
}

// Streamed events from running a whole project.
export type ProjectEvent =
  | { event: "project_start"; order: string[]; count: number }
  | { event: "table_start"; table: string; mapping: string }
  | { event: "progress"; table: string; rows_read: number; rows_written: number; rows_skipped: number; rows_errored: number }
  | { event: "row_error"; table: string; row_index: number; column: string; message: string }
  | { event: "fatal"; table?: string; message: string }
  | { event: "project_aborted"; table: string }
  | { event: "done"; table: string; report: Report }
  | { event: "project_done"; tables: { table: string; mapping: string; report: Report | null }[]; totals: { rows_written: number; rows_skipped: number; rows_errored: number }; ok: boolean };

// Guard: estimated impact of write statements (from a rolled-back dry run).
export interface WritePreview {
  ok: boolean;
  error?: string;
  previews?: { kind: string; affected: number | null; previewable: boolean }[];
}

export interface TestResult {
  ok: boolean;
  server_version: string;
  latency_ms: number;
  error: string;
}

export interface TableInfo {
  name: string;
  row_estimate: number | null;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  is_pk: boolean;
  is_fk: boolean;
  fk_target: string;
  default: string | null;
  char_len: number | null;
  numeric_precision: number | null;
  enum_values?: string[];
  collation?: string | null;
}

export interface ColumnMap {
  source_col: string;
  target_col: string;
  enabled: boolean;
  cast_type: string;
  cast_format: string;
  transform_expr: string;
  default_value: string | null;
  is_conflict_key: boolean;
}

export interface MappingProfile {
  id: string;
  name: string;
  source_conn_id: string;
  target_conn_id: string;
  source_schema: string;
  source_table: string;
  target_schema: string;
  target_table: string;
  column_maps: ColumnMap[];
  conflict_strategy: ConflictStrategy;
  batch_size: number;
  where_filter: string;
  stop_on_error: boolean;
  output_mode: OutputMode;
  include_ddl: boolean;
}

export interface TransformedPreviewRow {
  row_index: number;
  data: Record<string, unknown>;
  errors: { column: string; message: string }[];
}

export interface RowError {
  row_index: number;
  column: string;
  message: string;
}

export interface Report {
  source_count: number;
  rows_read: number;
  rows_written: number;
  rows_skipped: number;
  rows_errored: number;
  target_count_after: number | null;
  errors: RowError[];
  ok: boolean;
  aborted: boolean;
}

export type RunEvent =
  | { event: "start"; source_count: number; dry_run: boolean; output_mode: OutputMode }
  | { event: "progress"; rows_read: number; rows_written: number; rows_skipped: number; rows_errored: number }
  | { event: "row_error"; row_index: number; column: string; message: string }
  | { event: "fatal"; message: string }
  | { event: "done"; report: Report; export_id?: string; output_mode?: OutputMode };

export const CAST_TYPES = ["", "text", "int", "numeric", "bool", "date", "timestamp", "uuid"];
export const FLAVORS: Flavor[] = ["mysql", "postgresql", "supabase", "neon"];

// Deterministic data-masking presets for prod→dev migrations. Selecting one
// writes the expression into the column's transform field; the same input always
// maps to the same fake output, so foreign keys stay consistent across tables.
export const MASK_PRESETS: { label: string; expr: string }[] = [
  { label: "Fake name", expr: "fake_name(value)" },
  { label: "Fake first name", expr: "fake_first_name(value)" },
  { label: "Fake last name", expr: "fake_last_name(value)" },
  { label: "Fake email", expr: "fake_email(value)" },
  { label: "Fake phone", expr: "fake_phone(value)" },
  { label: "Fake company", expr: "fake_company(value)" },
  { label: "Fake city", expr: "fake_city(value)" },
  { label: "Mask (keep first 2)", expr: "mask(value, 2)" },
  { label: "Mask (keep last 4)", expr: "mask(value, -4)" },
  { label: "Mask email", expr: "mask_email(value)" },
  { label: "Hash (pseudonym)", expr: "hash_hex(value, 12)" },
  { label: "Redact", expr: "redact(value)" },
];

// ---- Database Explorer ----
export interface QueryResult {
  ok: boolean;
  columns?: string[];
  rows?: (string | number | boolean | null)[][];
  rowcount?: number;
  is_select?: boolean;
  executed?: number;
  truncated?: boolean;
  elapsed_ms?: number;
  error?: string;
  warning?: string;
  snapshot?: SnapshotMeta;
  sandbox?: SandboxStatus;
  /** Present when a run produced more than one SELECT result set. */
  result_sets?: ResultSet[];
}

export interface ResultSet {
  statement: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  rowcount: number;
  truncated: boolean;
}

export interface SandboxStatus {
  active: boolean;
  sandbox_id?: string;
  statements?: number;
  writes?: number;
  age_s?: number;
}

export interface SnapshotMeta {
  id: string;
  conn_id: string;
  schema: string;
  tables: { table: string; rows: number }[];
  skipped?: { table: string; reason: string }[];
  sql_head?: string;
  created_at?: string;
}

export interface BloatTable {
  table: string;
  live_rows?: number;
  dead_rows?: number;
  dead_ratio?: number;
  last_vacuum?: string | null;
  last_analyze?: string | null;
  rows_est?: number;
  size_bytes?: number;
  reclaimable_bytes?: number;
}

export interface BloatReport {
  dialect: string;
  supported: boolean;
  message?: string;
  tables: BloatTable[];
  advice: { table: string; severity: string; message: string; action: string }[];
}

export interface TableData {
  columns: ColumnInfo[];
  colnames: string[];
  rows: (string | number | boolean | null)[][];
  total: number;
  pk_cols: string[];
}

export interface ExportResult {
  export_id: string;
  mode: string;
  rows: number;
}

export interface ImportResult {
  ok: boolean;
  inserted: number;
  total: number;
  errors: string[];
}

export interface FilterCond {
  column: string;
  op: string;
  value: string;
}

export interface GridResult {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  note?: boolean;
}

export interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
  default?: string;
  collation?: string;
  auto_increment?: boolean;
}

export interface SchemaGraphTable {
  name: string;
  columns: { name: string; type: string; pk: boolean; fk: string }[];
}

export interface SchemaGraph {
  tables: SchemaGraphTable[];
  relationships: { from_table: string; from_column: string; to_table: string; to_column: string }[];
}

export const FILTER_OPS: { value: string; label: string; noValue?: boolean }[] = [
  { value: "=", label: "=" },
  { value: "!=", label: "≠" },
  { value: ">", label: ">" },
  { value: ">=", label: "≥" },
  { value: "<", label: "<" },
  { value: "<=", label: "≤" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "like", label: "LIKE" },
  { value: "in", label: "IN (a,b,c)" },
  { value: "is_null", label: "IS NULL", noValue: true },
  { value: "not_null", label: "IS NOT NULL", noValue: true },
];

export const PAGE_SIZES = [10, 25, 50, 100, 250, 500];

// SQL column types offered in the (searchable) type dropdown. Grouped roughly
// by family; anything not listed can still be typed in as custom.
export const COLUMN_TYPES = [
  // integers
  "TINYINT",
  "SMALLINT",
  "MEDIUMINT",
  "INT",
  "INTEGER",
  "BIGINT",
  "INT UNSIGNED",
  "BIGINT UNSIGNED",
  "SERIAL",
  "BIGSERIAL",
  // exact / floating numerics
  "NUMERIC(10,2)",
  "DECIMAL(10,2)",
  "DECIMAL(18,4)",
  "FLOAT",
  "REAL",
  "DOUBLE",
  "DOUBLE PRECISION",
  // boolean / bit
  "BOOLEAN",
  "BIT(1)",
  // strings
  "CHAR(1)",
  "CHAR(36)",
  "VARCHAR(50)",
  "VARCHAR(100)",
  "VARCHAR(255)",
  "VARCHAR(500)",
  "TINYTEXT",
  "TEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  // enum / set (edit the values)
  "ENUM('a','b','c')",
  "SET('a','b','c')",
  // binary
  "BINARY(16)",
  "VARBINARY(255)",
  "TINYBLOB",
  "BLOB",
  "MEDIUMBLOB",
  "LONGBLOB",
  "BYTEA",
  // date & time
  "DATE",
  "TIME",
  "DATETIME",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "YEAR",
  "INTERVAL",
  // structured / special
  "UUID",
  "JSON",
  "JSONB",
  "XML",
  "INET",
  "CIDR",
  "MACADDR",
  "GEOMETRY",
  "POINT",
  "ARRAY",
  "TSVECTOR",
];

// Common collations for the collation picker (MySQL first, then Postgres).
export const COLLATIONS = [
  "utf8mb4_unicode_ci",
  "utf8mb4_general_ci",
  "utf8mb4_bin",
  "utf8mb4_0900_ai_ci",
  "utf8mb3_unicode_ci",
  "utf8mb3_general_ci",
  "latin1_swedish_ci",
  "latin1_general_ci",
  "ascii_general_ci",
  "binary",
  "C",
  "POSIX",
  "en_US.utf8",
];
