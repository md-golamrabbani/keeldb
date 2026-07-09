"use client";
// Thin wrapper around @dbml/core (dbdiagram.io's own language library):
// parse DBML → a simple graph for the canvas, import SQL → DBML, export
// DBML → dialect DDL. Loaded lazily — the parser is heavy and only the
// /diagrams page needs it.

export interface DbmlColumn {
  name: string;
  type: string;
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  note: string;
}

export interface DbmlTable {
  name: string;
  note: string;
  columns: DbmlColumn[];
}

export interface DbmlRef {
  fromTable: string;
  fromCol: string;
  toTable: string;
  toCol: string;
  relation: string; // "<", ">", "-"
}

export interface DbmlEnum {
  name: string;
  values: string[];
}

export interface DbmlGraph {
  tables: DbmlTable[];
  refs: DbmlRef[];
  enums: DbmlEnum[];
}

export interface DbmlError {
  message: string;
  line?: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let corePromise: Promise<any> | null = null;
function core(): Promise<any> {
  if (!corePromise) corePromise = import("@dbml/core");
  return corePromise;
}

function firstDiag(e: any): DbmlError {
  const d = e?.diags?.[0];
  if (d) return { message: d.message, line: d.location?.start?.line };
  return { message: String(e?.message ?? e) };
}

export async function parseDbml(src: string): Promise<{ graph: DbmlGraph | null; error: DbmlError | null }> {
  const trimmed = src.trim();
  if (!trimmed) return { graph: { tables: [], refs: [], enums: [] }, error: null };
  const { Parser } = await core();
  try {
    const norm = new Parser().parse(trimmed, "dbmlv2").normalize();
    const tables: DbmlTable[] = [];
    const refs: DbmlRef[] = [];
    const enums: DbmlEnum[] = [];
    for (const sid of Object.keys(norm.schemas)) {
      const s = norm.schemas[sid];
      for (const eid of s.enumIds ?? []) {
        const e = norm.enums[eid];
        enums.push({
          name: e.name,
          values: (e.valueIds ?? []).map((vid: number) => norm.enumValues[vid].name),
        });
      }
      for (const tid of s.tableIds ?? []) {
        const t = norm.tables[tid];
        tables.push({
          name: t.name,
          note: typeof t.note === "string" ? t.note : (t.note?.value ?? ""),
          columns: (t.fieldIds ?? []).map((fid: number) => {
            const f = norm.fields[fid];
            return {
              name: f.name,
              type: f.type?.type_name ?? "",
              pk: !!f.pk,
              notNull: !!f.not_null,
              unique: !!f.unique,
              note: typeof f.note === "string" ? f.note : (f.note?.value ?? ""),
            };
          }),
        });
      }
      for (const rid of s.refIds ?? []) {
        const r = norm.refs[rid];
        const eps = (r.endpointIds ?? []).map((eid: number) => norm.endpoints[eid]);
        if (eps.length !== 2) continue;
        // endpoint with relation "*" is the many side (FK holder)
        const [a, b] = eps;
        const from = a.relation === "*" ? a : b;
        const to = a.relation === "*" ? b : a;
        refs.push({
          fromTable: from.tableName,
          fromCol: (from.fieldNames ?? [])[0] ?? "",
          toTable: to.tableName,
          toCol: (to.fieldNames ?? [])[0] ?? "",
          relation: a.relation === "*" && b.relation === "*" ? "<>" : ">",
        });
      }
    }
    return { graph: { tables, refs, enums }, error: null };
  } catch (e) {
    return { graph: null, error: firstDiag(e) };
  }
}

/** Human-readable summary of what changed between two schemas (for the AI
 * diff preview): added/removed tables and per-table column changes. */
export function diffGraphs(before: DbmlGraph, after: DbmlGraph): string[] {
  const out: string[] = [];
  const b = new Map(before.tables.map((t) => [t.name, t]));
  const a = new Map(after.tables.map((t) => [t.name, t]));
  for (const [name] of a) if (!b.has(name)) out.push(`+ table ${name}`);
  for (const [name] of b) if (!a.has(name)) out.push(`− table ${name}`);
  for (const [name, at] of a) {
    const bt = b.get(name);
    if (!bt) continue;
    const bc = new Set(bt.columns.map((c) => c.name));
    const ac = new Set(at.columns.map((c) => c.name));
    for (const c of ac) if (!bc.has(c)) out.push(`+ ${name}.${c}`);
    for (const c of bc) if (!ac.has(c)) out.push(`− ${name}.${c}`);
    for (const c of at.columns) {
      const old = bt.columns.find((x) => x.name === c.name);
      if (old && old.type !== c.type) out.push(`~ ${name}.${c.name}: ${old.type} → ${c.type}`);
    }
  }
  const br = before.refs.length, ar = after.refs.length;
  if (ar !== br) out.push(`${ar > br ? "+" : "−"} ${Math.abs(ar - br)} relationship(s)`);
  const be = new Set(before.enums.map((e) => e.name)), ae = new Set(after.enums.map((e) => e.name));
  for (const e of ae) if (!be.has(e)) out.push(`+ enum ${e}`);
  for (const e of be) if (!ae.has(e)) out.push(`− enum ${e}`);
  return out.length ? out : ["(no structural changes detected)"];
}

export async function exportSql(src: string, dialect: "mysql" | "postgres"): Promise<string> {
  const { Parser, ModelExporter } = await core();
  const db = new Parser().parse(src.trim(), "dbmlv2");
  return ModelExporter.export(db.normalize(), dialect, false);
}

export async function importSql(sql: string, dialect: "mysql" | "postgres"): Promise<string> {
  const { importer } = await core();
  return importer.import(sql, dialect);
}

/** Build DBML from the live schema graph the introspection API returns. */
export function graphToDbml(graph: {
  tables: { name: string; columns: { name: string; type: string; pk: boolean; fk: string }[] }[];
  relationships: { from_table: string; from_column: string; to_table: string; to_column: string }[];
}): string {
  const q = (n: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `"${n}"`);
  const lines: string[] = [];
  for (const t of graph.tables) {
    lines.push(`Table ${q(t.name)} {`);
    for (const c of t.columns) {
      const attrs: string[] = [];
      if (c.pk) attrs.push("pk");
      const type = /^[A-Za-z0-9_(),' ]+$/.test(c.type) ? c.type.replace(/\s+/g, " ") : "text";
      lines.push(`  ${q(c.name)} ${type.toLowerCase()}${attrs.length ? ` [${attrs.join(", ")}]` : ""}`);
    }
    lines.push("}", "");
  }
  for (const r of graph.relationships) {
    lines.push(`Ref: ${q(r.from_table)}.${q(r.from_column)} > ${q(r.to_table)}.${q(r.to_column)}`);
  }
  return lines.join("\n") + "\n";
}

// ---- schema sync: diagram vs live database → ALTER script -------------------
export interface LiveColumn { name: string; data_type: string; nullable: boolean }

function normType(t: string): string {
  return t.toLowerCase().replace(/\s+/g, "").replace(/^integer/, "int").replace(/^bool(ean)?/, "bool");
}

/** Build a reviewable migration script that makes the live schema match the
 * diagram. Additions are real statements; destructive ops (drop table/column,
 * type changes) are emitted COMMENTED OUT so nothing dangerous runs unseen. */
export function buildSyncScript(
  graph: DbmlGraph,
  live: Record<string, LiveColumn[]>, // live table -> columns
  dialect: "mysql" | "postgres",
): string {
  const q = (n: string) => (dialect === "mysql" ? `\`${n}\`` : `"${n}"`);
  const lines: string[] = [`-- Sync script: make the live schema match the diagram (${dialect})`,
    "-- Review carefully. Destructive changes are commented out — uncomment to apply.", ""];

  const liveNames = new Set(Object.keys(live));
  const diagNames = new Set(graph.tables.map((t) => t.name));

  // 1) tables missing from the live DB → CREATE TABLE
  for (const t of graph.tables) {
    if (liveNames.has(t.name)) continue;
    const cols = t.columns.map((c) => {
      let piece = `  ${q(c.name)} ${c.type || "text"}`;
      if (c.notNull || c.pk) piece += " NOT NULL";
      if (c.unique && !c.pk) piece += " UNIQUE";
      return piece;
    });
    const pks = t.columns.filter((c) => c.pk).map((c) => q(c.name));
    if (pks.length) cols.push(`  PRIMARY KEY (${pks.join(", ")})`);
    lines.push(`CREATE TABLE ${q(t.name)} (`, cols.join(",\n"), ");", "");
  }

  // 2) FKs for newly created tables
  for (const r of graph.refs) {
    if (liveNames.has(r.fromTable)) continue; // only for new tables
    if (!diagNames.has(r.toTable)) continue;
    lines.push(
      `ALTER TABLE ${q(r.fromTable)} ADD FOREIGN KEY (${q(r.fromCol)}) REFERENCES ${q(r.toTable)} (${q(r.toCol)});`,
    );
  }
  if (lines[lines.length - 1] !== "") lines.push("");

  // 3) existing tables: column-level diff
  for (const t of graph.tables) {
    const liveCols = live[t.name];
    if (!liveCols) continue;
    const liveBy = new Map(liveCols.map((c) => [c.name, c]));
    const diagBy = new Map(t.columns.map((c) => [c.name, c]));
    for (const c of t.columns) {
      if (!liveBy.has(c.name)) {
        let piece = `ALTER TABLE ${q(t.name)} ADD COLUMN ${q(c.name)} ${c.type || "text"}`;
        if (c.notNull) piece += " NOT NULL";
        lines.push(piece + ";");
      }
    }
    for (const lc of liveCols) {
      if (!diagBy.has(lc.name)) {
        lines.push(`-- ${q(lc.name)} exists in the database but not in the diagram:`);
        lines.push(`-- ALTER TABLE ${q(t.name)} DROP COLUMN ${q(lc.name)};`);
      }
    }
    for (const c of t.columns) {
      const lc = liveBy.get(c.name);
      if (lc && normType(lc.data_type) !== normType(c.type) && c.type) {
        lines.push(`-- type differs for ${t.name}.${c.name}: DB has ${lc.data_type}, diagram says ${c.type}:`);
        lines.push(dialect === "mysql"
          ? `-- ALTER TABLE ${q(t.name)} MODIFY COLUMN ${q(c.name)} ${c.type};`
          : `-- ALTER TABLE ${q(t.name)} ALTER COLUMN ${q(c.name)} TYPE ${c.type};`);
      }
    }
  }
  if (lines[lines.length - 1] !== "") lines.push("");

  // 4) live tables not in the diagram → commented DROP
  for (const name of liveNames) {
    if (!diagNames.has(name)) {
      lines.push(`-- ${name} exists in the database but not in the diagram:`);
      lines.push(`-- DROP TABLE ${q(name)};`);
    }
  }

  const body = lines.slice(3).some((l) => l.trim());
  if (!body) lines.push("-- Nothing to do: the live schema already matches the diagram.");
  return lines.join("\n") + "\n";
}

export const STARTER_DBML = `// Welcome to the diagram designer — DBML, like dbdiagram.io.
// Edit here (or ask the AI) and the canvas updates live.

Table users {
  id int [pk, increment]
  name varchar(100) [not null]
  email varchar(255) [unique, not null]
  created_at timestamp
}

Table posts {
  id int [pk, increment]
  user_id int [not null]
  title varchar(255) [not null]
  body text
  status varchar(20) [note: 'draft / published']
  created_at timestamp
}

Ref: posts.user_id > users.id
`;
