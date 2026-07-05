import type {
  ColumnInfo,
  ConnectionProfile,
  ConnectionProfileIn,
  MappingProfile,
  RunEvent,
  TableInfo,
  TestResult,
  TransformedPreviewRow,
} from "./types";

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
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

  listMappings: () => req<MappingProfile[]>("/mappings"),
  saveMapping: (m: MappingProfile) =>
    req<MappingProfile>("/mappings", { method: "POST", body: JSON.stringify(m) }),
  deleteMapping: (id: string) => req<{ ok: boolean }>(`/mappings/${id}`, { method: "DELETE" }),

  uploadSql: async (file: File, name: string): Promise<ConnectionProfile> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name);
    const res = await fetch(`${BASE}/connections/upload-sql`, { method: "POST", body: fd });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        detail = (await res.json()).detail ?? detail;
      } catch {}
      throw new Error(detail);
    }
    return res.json();
  },

  exportUrl: (exportId: string, mode: string) => `${BASE}/migrate/export/${exportId}?mode=${mode}`,
};

/** Stream /migrate/run NDJSON events. */
export async function runMigration(
  mapping: MappingProfile,
  dryRun: boolean,
  onEvent: (e: RunEvent) => void
): Promise<void> {
  const res = await fetch(`${BASE}/migrate/run`, {
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
