import type {
  ActivityReport,
  AiSettingsPublic,
  BloatReport,
  SnapshotMeta,
  AlertCondition,
  AlertResult,
  AlertRule,
  ColumnDef,
  ColumnInfo,
  ConnectionProfile,
  ConnectionProfileIn,
  ConstraintList,
  CreateAuthUsersParams,
  SupabaseAuthEvent,
  DependentsResult,
  DuplicateResult,
  ExportResult,
  HealthReport,
  HistoryEntry,
  IndexAdvice,
  IndexList,
  FilterCond,
  GridResult,
  ImportResult,
  MappingProfile,
  MigrationProject,
  OrphanResult,
  ProjectEvent,
  QueryPlan,
  RollbackSim,
  ServerMetrics,
  QueryResult,
  RunEvent,
  SchemaGraph,
  Snippet,
  TableData,
  TableInfo,
  TableProfile,
  TestResult,
  TransformedPreviewRow,
  WritePreview,
} from "./types";

import { apiBaseSync, resolveApiBase } from "./backend";

// ---- single shared-password auth (no-op unless the backend requires it) ----
const TOKEN_KEY = "keeldb_token";
let onUnauthorized: () => void = () => {};
export function setOnUnauthorized(fn: () => void) { onUnauthorized = fn; }
export function getToken(): string { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } }
export function setToken(t: string) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} }
export function clearToken() { setToken(""); }
/** Auth header for raw fetches (import, streaming). */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const t = getToken();
  return t ? { ...extra, Authorization: `Bearer ${t}` } : extra;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${await resolveApiBase()}${path}`, {
    ...init,
    headers: authHeaders({ "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) }),
  });
  if (res.status === 401) {
    clearToken();
    onUnauthorized();
    throw new Error("Please log in.");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  authStatus: () => req<{ enabled: boolean; configured: boolean; needs_setup: boolean; blocked: boolean; question: string }>("/auth/status"),
  authSetup: async (password: string, question: string, answer: string): Promise<{ token: string }> => {
    const res = await fetch(`${await resolveApiBase()}/auth/setup`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, question, answer }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Could not set the password");
    return res.json();
  },
  login: async (password: string): Promise<{ token: string }> => {
    const res = await fetch(`${await resolveApiBase()}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
    });
    if (res.status === 403) throw new Error("This app is permanently locked.");
    if (res.status === 401) throw new Error("Invalid password");
    if (!res.ok) throw new Error(res.statusText);
    return res.json();
  },
  authRecover: async (answer: string, newPassword: string): Promise<{ ok: boolean; token?: string; blocked?: boolean; attempts_left?: number }> => {
    const res = await fetch(`${await resolveApiBase()}/auth/recover`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer, new_password: newPassword }),
    });
    if (res.status === 403) return { ok: false, blocked: true, attempts_left: 0 };
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Recovery failed");
    return res.json();
  },
  authRefresh: async (): Promise<{ token: string }> => {
    const res = await fetch(`${await resolveApiBase()}/auth/refresh`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new Error("session expired");
    return res.json();
  },

  listConnections: () => req<ConnectionProfile[]>("/connections"),
  createConnection: (p: ConnectionProfileIn) =>
    req<ConnectionProfile>("/connections", { method: "POST", body: JSON.stringify(p) }),
  updateConnection: (id: string, p: ConnectionProfileIn) =>
    req<ConnectionProfile>(`/connections/${id}`, { method: "PUT", body: JSON.stringify(p) }),
  deleteConnection: (id: string) => req<{ ok: boolean }>(`/connections/${id}`, { method: "DELETE" }),
  testSaved: (id: string) => req<TestResult>(`/connections/${id}/test`, { method: "POST" }),
  testUnsaved: (p: ConnectionProfileIn) =>
    req<TestResult>("/connections/test", { method: "POST", body: JSON.stringify(p) }),

  listSchemas: (connId: string) => req<string[]>(`/introspect/${connId}/schemas`),
  listTables: (connId: string, schema: string) =>
    req<TableInfo[]>(`/introspect/${connId}/tables?schema=${encodeURIComponent(schema)}`),
  listColumns: (connId: string, schema: string, table: string) =>
    req<ColumnInfo[]>(
      `/introspect/${connId}/columns?schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`
    ),

  previewRows: (connId: string, schema: string, table: string, limit = 20) =>
    req<Record<string, unknown>[]>("/preview/rows", {
      method: "POST",
      body: JSON.stringify({ conn_id: connId, schema_name: schema, table, limit }),
    }),
  previewTransformed: (mapping: MappingProfile, limit = 20) =>
    req<TransformedPreviewRow[]>("/preview/transformed", {
      method: "POST",
      body: JSON.stringify({ mapping, limit }),
    }),

  orphanScan: (connId: string, schema: string, table = "") =>
    req<OrphanResult>(`/db/${connId}/orphans`, { method: "POST", body: JSON.stringify({ schema_name: schema, table }) }),
  findDuplicates: (connId: string, schema: string, table: string, columns: string[], limit = 100) =>
    req<DuplicateResult>(`/db/${connId}/duplicates`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, columns, limit }) }),
  dependents: (connId: string, schema: string, table: string, pk: Record<string, unknown>) =>
    req<DependentsResult>(`/db/${connId}/dependents`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, pk }) }),
  profile: (connId: string, schema: string, table: string) =>
    req<TableProfile>(`/db/${connId}/profile`, { method: "POST", body: JSON.stringify({ schema_name: schema, table }) }),
  explainQuery: (connId: string, sql: string, schema = "") =>
    req<QueryPlan>(`/db/${connId}/explain`, { method: "POST", body: JSON.stringify({ sql, schema_name: schema }) }),
  aiExplainError: (connId: string, schema: string, sql: string, error: string) =>
    req<{ available: boolean; explanation: string; suggested_sql?: string; message?: string }>(
      `/db/${connId}/ai/explain-error`,
      { method: "POST", body: JSON.stringify({ schema_name: schema, sql, error }) }),
  aiSql: (connId: string, schema: string, question: string) =>
    req<{ available: boolean; sql: string; message?: string; model?: string }>(`/db/${connId}/ai/sql`, { method: "POST", body: JSON.stringify({ schema_name: schema, question }) }),
  aiSettings: () => req<AiSettingsPublic>("/ai/settings"),
  revealAiKey: () => req<{ api_key: string }>("/ai/settings/key"),
  saveAiSettings: (p: { provider: string; model: string; api_key: string }) =>
    req<AiSettingsPublic>("/ai/settings", { method: "PUT", body: JSON.stringify(p) }),
  listIndexes: (connId: string, schema: string, table: string) =>
    req<IndexList>(`/db/${connId}/indexes`, { method: "POST", body: JSON.stringify({ schema_name: schema, table }) }),
  createIndex: (connId: string, schema: string, table: string, name: string, columns: string[], unique: boolean) =>
    req<{ ok: boolean }>(`/db/${connId}/index/create`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, name, columns, unique }) }),
  dropIndex: (connId: string, schema: string, table: string, name: string) =>
    req<{ ok: boolean }>(`/db/${connId}/index/drop`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, name }) }),
  listConstraints: (connId: string, schema: string, table: string) =>
    req<ConstraintList>(`/db/${connId}/constraints`, { method: "POST", body: JSON.stringify({ schema_name: schema, table }) }),
  addForeignKey: (connId: string, schema: string, table: string, p: { name: string; columns: string[]; ref_table: string; ref_columns: string[]; on_delete?: string }) =>
    req<{ ok: boolean; created: string }>(`/db/${connId}/constraint/add-fk`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, on_delete: "", ...p }) }),
  dropConstraint: (connId: string, schema: string, table: string, name: string, kind: string) =>
    req<{ ok: boolean }>(`/db/${connId}/constraint/drop`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, name, kind }) }),
  listViews: (connId: string, schema: string) =>
    req<{ name: string }[]>(`/db/${connId}/views`, { method: "POST", body: JSON.stringify({ schema_name: schema }) }),
  viewDefinition: (connId: string, schema: string, view: string) =>
    req<{ name: string; definition: string }>(`/db/${connId}/view-definition`, { method: "POST", body: JSON.stringify({ schema_name: schema, table: view }) }),
  listRoutines: (connId: string, schema: string) =>
    req<{ supported: boolean; routines: { name: string; kind: string; returns: string; definition: string }[] }>(
      `/db/${connId}/routines`, { method: "POST", body: JSON.stringify({ schema_name: schema }) }),
  listUsers: (connId: string) =>
    req<{ supported: boolean; users: { name: string; host: string; superuser: boolean | null; can_login?: boolean }[] }>(`/db/${connId}/users`),
  createUser: (connId: string, name: string, password: string, host = "%") =>
    req<{ ok: boolean }>(`/db/${connId}/users/create`, { method: "POST", body: JSON.stringify({ name, password, host }) }),
  dropUser: (connId: string, name: string, host = "%") =>
    req<{ ok: boolean }>(`/db/${connId}/users/drop`, { method: "POST", body: JSON.stringify({ name, host }) }),
  grantUser: (connId: string, name: string, schema: string, level: "read" | "write" | "all", host = "%") =>
    req<{ ok: boolean }>(`/db/${connId}/users/grant`, { method: "POST", body: JSON.stringify({ name, schema_name: schema, level, host }) }),
  health: (connId: string, schema: string) =>
    req<HealthReport>(`/db/${connId}/health`, { method: "POST", body: JSON.stringify({ schema_name: schema }) }),
  backupTable: (connId: string, schema: string, table: string) =>
    req<{ table: string; rows: number; sql: string }>(`/db/${connId}/backup`, { method: "POST", body: JSON.stringify({ schema_name: schema, table }) }),
  backupDatabase: (connId: string, schema: string) =>
    req<{ schema: string; tables: number; rows: number; sql: string }>(`/db/${connId}/backup-database`, { method: "POST", body: JSON.stringify({ schema_name: schema }) }),
  indexAdvice: (connId: string, schema: string) =>
    req<IndexAdvice>(`/db/${connId}/index-advice`, { method: "POST", body: JSON.stringify({ schema_name: schema }) }),
  activity: (connId: string) => req<ActivityReport>(`/db/${connId}/activity`),
  killSession: (connId: string, sessionId: string | number) =>
    req<{ ok: boolean; id: number }>(`/db/${connId}/kill`, { method: "POST", body: JSON.stringify({ session_id: String(sessionId) }) }),
  serverMetrics: (connId: string) => req<ServerMetrics>(`/db/${connId}/metrics`),
  checkAlerts: (connId: string, schema: string) =>
    req<AlertResult[]>(`/db/${connId}/alerts/check`, { method: "POST", body: JSON.stringify({ schema_name: schema }) }),
  exportPortable: () => req<Record<string, unknown>>("/portable/export"),
  importPortable: (bundle: unknown) =>
    req<{ imported: Record<string, number> }>("/portable/import", { method: "POST", body: JSON.stringify({ bundle }) }),

  listAlerts: () => req<AlertRule[]>("/alerts"),
  createAlert: (rule: { name: string; sql: string; condition: AlertCondition; threshold: number }) =>
    req<AlertRule>("/alerts", { method: "POST", body: JSON.stringify(rule) }),
  deleteAlert: (id: string) => req<{ deleted: string }>(`/alerts/${id}`, { method: "DELETE" }),

  // query history + saved snippets
  history: (connId: string, limit = 100) => req<HistoryEntry[]>(`/db/${connId}/history?limit=${limit}`),
  exportHistoryCsv: async (connId: string): Promise<Blob> => {
    const res = await fetch(`${await resolveApiBase()}/db/${connId}/history/export`, { headers: authHeaders() });
    if (!res.ok) throw new Error(res.statusText);
    return res.blob();
  },
  clearHistory: (connId: string) => req<{ cleared: number }>(`/db/${connId}/history`, { method: "DELETE" }),
  listSnippets: () => req<Snippet[]>("/snippets"),
  createSnippet: (name: string, sql: string) =>
    req<Snippet>("/snippets", { method: "POST", body: JSON.stringify({ name, sql }) }),
  updateSnippet: (id: string, name: string, sql: string) =>
    req<Snippet>(`/snippets/${id}`, { method: "PUT", body: JSON.stringify({ name, sql }) }),
  deleteSnippet: (id: string) => req<{ deleted: string }>(`/snippets/${id}`, { method: "DELETE" }),

  listProjects: () => req<MigrationProject[]>("/projects"),
  saveProject: (p: Partial<MigrationProject> & { name: string; mapping_ids: string[] }) =>
    req<MigrationProject>("/projects", { method: "POST", body: JSON.stringify({ auto_order: true, stop_on_error: true, ...p }) }),
  deleteProject: (id: string) => req<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),
  projectOrder: (id: string) => req<{ order: string[] }>(`/projects/${id}/order`),

  listMappings: () => req<MappingProfile[]>("/mappings"),
  saveMapping: (m: MappingProfile) =>
    req<MappingProfile>("/mappings", { method: "POST", body: JSON.stringify(m) }),
  deleteMapping: (id: string) => req<{ ok: boolean }>(`/mappings/${id}`, { method: "DELETE" }),

  uploadSql: async (file: File, name: string): Promise<ConnectionProfile> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name);
    const res = await fetch(`${await resolveApiBase()}/connections/upload-sql`, { method: "POST", body: fd, headers: authHeaders() });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        detail = (await res.json()).detail ?? detail;
      } catch {}
      throw new Error(detail);
    }
    return res.json();
  },

  exportUrl: (exportId: string, mode: string) => `${apiBaseSync()}/migrate/export/${exportId}?mode=${mode}`,

  generateTarget: (p: {
    source_conn_id: string; source_schema: string; source_table: string;
    target_conn_id: string; target_schema: string; target_table: string; execute: boolean;
  }) => req<{ ddl: string; created: boolean }>("/migrate/generate-target", { method: "POST", body: JSON.stringify(p) }),

  rollbackSimulate: (mapping: MappingProfile) =>
    req<RollbackSim>("/migrate/rollback-simulate", { method: "POST", body: JSON.stringify({ mapping }) }),

  // ---- Database Explorer ----
  runSql: (connId: string, sql: string, schema = "", maxRows = 1000, timeoutS = 0, autoSnapshot = false) =>
    req<QueryResult>(`/db/${connId}/query`, {
      method: "POST",
      body: JSON.stringify({ sql, max_rows: maxRows, schema_name: schema, timeout_s: timeoutS, auto_snapshot: autoSnapshot }),
    }),

  // ---- transaction sandbox ----
  sandboxBegin: (connId: string, schema = "") =>
    req<{ ok: boolean; sandbox_id: string }>(`/db/${connId}/sandbox/begin`, { method: "POST", body: JSON.stringify({ schema_name: schema }) }),
  sandboxRun: (connId: string, sandboxId: string, sql: string, maxRows = 1000) =>
    req<QueryResult>(`/db/${connId}/sandbox/${sandboxId}/run`, { method: "POST", body: JSON.stringify({ sql, max_rows: maxRows }) }),
  sandboxCommit: (connId: string, sandboxId: string) =>
    req<{ ok: boolean; committed: boolean; writes: number }>(`/db/${connId}/sandbox/${sandboxId}/commit`, { method: "POST" }),
  sandboxRollback: (connId: string, sandboxId: string) =>
    req<{ ok: boolean; committed: boolean; writes: number }>(`/db/${connId}/sandbox/${sandboxId}/rollback`, { method: "POST" }),

  // ---- snapshots (undo) ----
  listSnapshots: (connId: string) => req<SnapshotMeta[]>(`/db/${connId}/snapshots`),
  restoreSnapshot: (connId: string, snapId: string) =>
    req<{ ok: boolean; restored: string[] }>(`/db/${connId}/snapshots/${snapId}/restore`, { method: "POST" }),
  deleteSnapshot: (connId: string, snapId: string) =>
    req<{ ok: boolean }>(`/db/${connId}/snapshots/${snapId}`, { method: "DELETE" }),

  // ---- bloat / vacuum advisor ----
  bloatReport: (connId: string, schema = "") =>
    req<BloatReport>(`/db/${connId}/bloat`, { method: "POST", body: JSON.stringify({ schema_name: schema }) }),

  // ---- ER diagram designer ----
  listDiagrams: () => req<{ id: string; name: string; updated_at: string }[]>("/diagrams"),
  getDiagram: (id: string) =>
    req<{ id: string; name: string; dbml: string; positions: Record<string, { x: number; y: number }> }>(`/diagrams/${id}`),
  saveDiagram: (d: { id?: string; name: string; dbml: string; positions: Record<string, { x: number; y: number }> }) =>
    req<{ id: string; name: string }>("/diagrams", { method: "POST", body: JSON.stringify({ id: d.id ?? "", ...d }) }),
  deleteDiagram: (id: string) => req<{ ok: boolean }>(`/diagrams/${id}`, { method: "DELETE" }),
  aiDiagram: (dbml: string, instruction: string) =>
    req<{ available: boolean; dbml: string; message?: string; model?: string }>("/diagrams/ai", {
      method: "POST", body: JSON.stringify({ dbml, instruction }),
    }),

  // ---- migration checkpoint ----
  migrateCheckpoint: (mappingId: string) =>
    req<{ checkpoint: { rows_read: number } | null }>(`/migrate/checkpoint/${mappingId}`),
  previewWrite: (connId: string, sql: string, schema = "") =>
    req<WritePreview>(`/db/${connId}/preview-write`, { method: "POST", body: JSON.stringify({ sql, schema_name: schema }) }),
  tableData: (
    connId: string,
    p: { schema: string; table: string; limit: number; offset: number; order_by?: string; order_dir?: string; search?: string; filters?: FilterCond[] }
  ) =>
    req<TableData>(`/db/${connId}/table-data`, {
      method: "POST",
      body: JSON.stringify({
        schema_name: p.schema, table: p.table, limit: p.limit, offset: p.offset,
        order_by: p.order_by ?? "", order_dir: p.order_dir ?? "asc", search: p.search ?? "", filters: p.filters ?? [],
      }),
    }),
  insertRow: (connId: string, schema: string, table: string, values: Record<string, unknown>) =>
    req<{ ok: boolean }>(`/db/${connId}/row/insert`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, values }) }),
  updateRow: (connId: string, schema: string, table: string, pk: Record<string, unknown>, values: Record<string, unknown>) =>
    req<{ ok: boolean; updated: number }>(`/db/${connId}/row/update`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, pk, values }) }),
  deleteRow: (connId: string, schema: string, table: string, pk: Record<string, unknown>) =>
    req<{ ok: boolean; deleted: number }>(`/db/${connId}/row/delete`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, pk }) }),
  deleteRowsBulk: (connId: string, schema: string, table: string, pks: Record<string, unknown>[]) =>
    req<{ ok: boolean; deleted: number }>(`/db/${connId}/row/delete-bulk`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, pks }) }),
  exportTable: (connId: string, schema: string, table: string, format: string, where = "", includeDdl = true) =>
    req<ExportResult>(`/db/${connId}/export`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, format, where, include_ddl: includeDdl }) }),
  importCsv: async (connId: string, schema: string, table: string, file: File): Promise<ImportResult> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("schema_name", schema);
    fd.append("table", table);
    const res = await fetch(`${await resolveApiBase()}/db/${connId}/import-csv`, { method: "POST", body: fd, headers: authHeaders() });
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json()).detail ?? detail; } catch {}
      throw new Error(detail);
    }
    return res.json();
  },

  // ---- Admin / DDL ----
  tableDdl: (connId: string, schema: string, table: string) =>
    req<{ ddl: string }>(`/db/${connId}/ddl/table`, { method: "POST", body: JSON.stringify({ schema_name: schema, table }) }),
  schemaGraph: (connId: string, schema: string) =>
    req<SchemaGraph>(`/db/${connId}/ddl/schema-graph`, { method: "POST", body: JSON.stringify({ schema_name: schema }) }),
  createTable: (connId: string, schema: string, name: string, columns: ColumnDef[]) =>
    req<{ ok: boolean }>(`/db/${connId}/table/create`, { method: "POST", body: JSON.stringify({ schema_name: schema, name, columns }) }),
  dropTable: (connId: string, schema: string, table: string) =>
    req<{ ok: boolean }>(`/db/${connId}/table/drop`, { method: "POST", body: JSON.stringify({ schema_name: schema, table }) }),
  truncateTable: (connId: string, schema: string, table: string) =>
    req<{ ok: boolean }>(`/db/${connId}/table/truncate`, { method: "POST", body: JSON.stringify({ schema_name: schema, table }) }),
  renameTable: (connId: string, schema: string, table: string, newName: string) =>
    req<{ ok: boolean }>(`/db/${connId}/table/rename`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, new_name: newName }) }),
  addColumn: (connId: string, schema: string, table: string, c: { name: string; type: string; nullable: boolean; default?: string | null }) =>
    req<{ ok: boolean }>(`/db/${connId}/column/add`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, ...c }) }),
  renameColumn: (connId: string, schema: string, table: string, name: string, newName: string) =>
    req<{ ok: boolean }>(`/db/${connId}/column/rename`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, name, new_name: newName }) }),
  dropColumn: (connId: string, schema: string, table: string, name: string) =>
    req<{ ok: boolean }>(`/db/${connId}/column/drop`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, name }) }),
  modifyColumn: (connId: string, schema: string, table: string, name: string, newType: string, nullable: boolean | null, collation = "") =>
    req<{ ok: boolean }>(`/db/${connId}/column/modify`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, name, new_type: newType, nullable, collation }) }),
  createDatabase: (connId: string, name: string) =>
    req<{ ok: boolean }>(`/db/${connId}/database/create`, { method: "POST", body: JSON.stringify({ name }) }),
  dropDatabase: (connId: string, name: string) =>
    req<{ ok: boolean }>(`/db/${connId}/database/drop`, { method: "POST", body: JSON.stringify({ name }) }),
  renameDatabase: (connId: string, name: string, newName: string) =>
    req<{ ok: boolean }>(`/db/${connId}/database/rename`, { method: "POST", body: JSON.stringify({ name, new_name: newName }) }),
  listTriggers: (connId: string, schema: string) =>
    req<GridResult>(`/db/${connId}/triggers`, { method: "POST", body: JSON.stringify({ schema_name: schema }) }),
  listPrivileges: (connId: string, schema: string) =>
    req<GridResult>(`/db/${connId}/privileges`, { method: "POST", body: JSON.stringify({ schema_name: schema }) }),
};

/** Stream /migrate/run NDJSON events. */
export async function runMigration(
  mapping: MappingProfile,
  dryRun: boolean,
  onEvent: (e: RunEvent) => void,
  resumeOffset = 0
): Promise<void> {
  const res = await fetch(`${await resolveApiBase()}/migrate/run`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ mapping, dry_run: dryRun, resume_offset: resumeOffset }),
  });
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new Error(detail);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as RunEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as RunEvent);
}

/** Stream a whole project's run (many tables, FK-ordered). */
export async function runProject(
  projectId: string,
  dryRun: boolean,
  onEvent: (e: ProjectEvent) => void
): Promise<void> {
  const res = await fetch(`${await resolveApiBase()}/projects/${projectId}/run`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ dry_run: dryRun }),
  });
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch {}
    throw new Error(detail);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as ProjectEvent);
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as ProjectEvent);
}

/** Stream a Supabase Auth bulk user creation (Admin API, one call per user). */
export async function createSupabaseAuthUsers(
  params: CreateAuthUsersParams,
  onEvent: (e: SupabaseAuthEvent) => void
): Promise<void> {
  const res = await fetch(`${await resolveApiBase()}/supabase-auth/create-users`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(params),
  });
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch {}
    throw new Error(detail);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as SupabaseAuthEvent);
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as SupabaseAuthEvent);
}
