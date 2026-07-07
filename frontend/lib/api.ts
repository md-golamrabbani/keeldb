import type {
  ColumnDef,
  ColumnInfo,
  ConnectionProfile,
  ConnectionProfileIn,
  DuplicateResult,
  ExportResult,
  FilterCond,
  GridResult,
  ImportResult,
  MappingProfile,
  MigrationProject,
  OrphanResult,
  ProjectEvent,
  RollbackSim,
  QueryResult,
  RunEvent,
  SchemaGraph,
  TableData,
  TableInfo,
  TestResult,
  TransformedPreviewRow,
  WritePreview,
} from "./types";

import { apiBaseSync, resolveApiBase } from "./backend";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${await resolveApiBase()}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
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
    const res = await fetch(`${await resolveApiBase()}/connections/upload-sql`, { method: "POST", body: fd });
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
  runSql: (connId: string, sql: string, schema = "", maxRows = 1000) =>
    req<QueryResult>(`/db/${connId}/query`, { method: "POST", body: JSON.stringify({ sql, max_rows: maxRows, schema_name: schema }) }),
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
    const res = await fetch(`${await resolveApiBase()}/db/${connId}/import-csv`, { method: "POST", body: fd });
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
  modifyColumn: (connId: string, schema: string, table: string, name: string, newType: string, nullable: boolean | null) =>
    req<{ ok: boolean }>(`/db/${connId}/column/modify`, { method: "POST", body: JSON.stringify({ schema_name: schema, table, name, new_type: newType, nullable }) }),
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
  onEvent: (e: RunEvent) => void
): Promise<void> {
  const res = await fetch(`${await resolveApiBase()}/migrate/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapping, dry_run: dryRun }),
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
    headers: { "Content-Type": "application/json" },
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
