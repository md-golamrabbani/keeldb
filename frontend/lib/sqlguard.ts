// Client-side classification of SQL for the Safe Query Assistant.
// Best-effort AST parse (node-sql-parser); falls back to keyword heuristics.

export type StmtKind = "select" | "insert" | "update" | "delete" | "truncate" | "drop" | "alter" | "create" | "other";

export interface StmtInfo {
  sql: string;
  kind: StmtKind;
  isWrite: boolean;
  hasWhere: boolean;
  dangerous: boolean;      // write that hits the whole table (UPDATE/DELETE w/o WHERE, TRUNCATE, DROP)
  reason?: string;
}

const WRITE = new Set<StmtKind>(["insert", "update", "delete", "truncate", "drop", "alter", "create"]);

function splitStatements(sql: string): string[] {
  // Simple splitter respecting single/double quotes; good enough for the editor.
  const out: string[] = [];
  let buf = "", quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      buf += ch;
      if (ch === quote) { if (sql[i + 1] === quote) { buf += sql[++i]; } else quote = null; }
    } else if (ch === "'" || ch === '"' || ch === "`") { quote = ch; buf += ch; }
    else if (ch === ";") { if (buf.trim()) out.push(buf.trim()); buf = ""; }
    else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function keyword(stmt: string): StmtKind {
  const m = stmt.match(/^\s*([a-zA-Z]+)/);
  const k = (m ? m[1] : "").toLowerCase();
  if (["select", "with", "show", "explain", "describe", "desc", "pragma"].includes(k)) return "select";
  if (["insert", "replace", "update", "delete", "truncate", "drop", "alter", "create"].includes(k))
    return (k === "replace" ? "insert" : k) as StmtKind;
  return "other";
}

function hasWhereHeuristic(stmt: string): boolean {
  // WHERE outside of quotes.
  return /\bwhere\b/i.test(stmt.replace(/'[^']*'|"[^"]*"/g, ""));
}

export function classify(stmt: string): StmtInfo {
  const kind = keyword(stmt);
  const isWrite = WRITE.has(kind);
  const hasWhere = hasWhereHeuristic(stmt);
  let dangerous = false;
  let reason: string | undefined;
  if ((kind === "update" || kind === "delete") && !hasWhere) {
    dangerous = true;
    reason = `${kind.toUpperCase()} without a WHERE clause — affects every row.`;
  } else if (kind === "truncate") {
    dangerous = true; reason = "TRUNCATE empties the entire table.";
  } else if (kind === "drop") {
    dangerous = true; reason = "DROP permanently removes a table/database.";
  }
  return { sql: stmt, kind, isWrite, hasWhere, dangerous, reason };
}

export function analyzeSql(sql: string): StmtInfo[] {
  return splitStatements(sql).map(classify);
}
