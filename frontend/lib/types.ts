export type Flavor = "mysql" | "postgresql" | "supabase" | "neon" | "sqlfile";
export type ConflictStrategy = "insert" | "upsert" | "skip";
export type OutputMode = "push" | "sql" | "csv" | "json";

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
