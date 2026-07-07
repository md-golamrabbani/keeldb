"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Environment, Flavor, QueryPlan, QueryResult } from "@/lib/types";
import { analyzeSql, type StmtInfo } from "@/lib/sqlguard";
import SqlCodeEditor from "./SqlCodeEditor";
import GuardDialog from "./GuardDialog";
import QueryLibrary from "./QueryLibrary";
import { IconDownload, IconPlay } from "@/components/icons";

interface LintError {
  line?: number;
  message: string;
}

// Fast, synchronous check for the two most common structural mistakes.
function bracketLint(sql: string): string {
  let depth = 0,
    quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) i++;
        else quote = null;
      }
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return "Unbalanced parenthesis: an extra ')'.";
  }
  if (quote) return "Unclosed string quote.";
  if (depth > 0) return `Unbalanced parenthesis: ${depth} '(' not closed.`;
  return "";
}

const DB_FOR: Record<Flavor, string> = {
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  supabase: "PostgreSQL",
  neon: "PostgreSQL",
  sqlfile: "MySQL",
};

// Common clause keywords surfaced first, since the parser lists expectations
// alphabetically and the useful one would otherwise be buried.
const PRIORITY = [
  "LIMIT",
  "WHERE",
  "ORDER",
  "GROUP",
  "HAVING",
  "JOIN",
  "ON",
  "SET",
  "VALUES",
  "FROM",
  "SELECT",
  "UNION",
  "OFFSET",
  "AND",
  "OR",
  "AS",
];

// Turn the parser's verbose PEG message into a short, readable hint.
function friendly(raw: string, sql: string, offset?: number): string {
  const near =
    offset != null
      ? (sql.slice(offset).match(/^\S+/)?.[0] ?? "end of statement")
      : "";
  const m = raw.match(/Expected (.*?) but (.*?) found/s);
  if (m) {
    const expected = Array.from(
      new Set(
        [...m[1].matchAll(/"([^"]+)"/g)]
          .map((x) => x[1])
          .filter((t) => /^[A-Za-z]/.test(t) && t === t.toUpperCase()),
      ),
    );
    const ranked = expected
      .sort((a, b) => {
        const ia = PRIORITY.indexOf(a),
          ib = PRIORITY.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .slice(0, 4);
    let s = near ? `Unexpected "${near}"` : "Unexpected end of statement";
    if (ranked.length) s += ` — expected ${ranked.join(", ")} here`;
    return s + ". Check this line for a typo.";
  }
  return raw.split("\n")[0];
}

function toCsv(
  columns: string[],
  rows: (string | number | boolean | null)[][],
): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.map(esc).join(","),
    ...rows.map((r) => r.map(esc).join(",")),
  ].join("\n");
}

const LIMIT_OPTIONS = [100, 500, 1000, 5000, 10000];

export default function SqlEditor({
  connId,
  schema,
  table,
  flavor,
  tableNames = [],
  environment = "dev",
  readOnly = false,
}: {
  connId: string;
  schema: string;
  table?: string;
  flavor?: Flavor;
  tableNames?: string[];
  environment?: Environment;
  readOnly?: boolean;
}) {
  const [sql, setSql] = useState(
    table ? `SELECT *\nFROM ${table}\nLIMIT 100;` : "SELECT 1;",
  );
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [lintError, setLintError] = useState<LintError | null>(null);
  const [rowLimit, setRowLimit] = useState(1000); // 0 = no cap ("All"), like Workbench's row-limit selector
  const [usedLimit, setUsedLimit] = useState(1000);
  const [colCache, setColCache] = useState<Record<string, string[]>>({});
  const [guard, setGuard] = useState<StmtInfo[] | null>(null); // pending write awaiting confirmation
  const [plan, setPlan] = useState<QueryPlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [historyNonce, setHistoryNonce] = useState(0);

  // Fetch columns for tables referenced in the query so autocomplete can suggest them.
  useEffect(() => {
    const present = tableNames.filter((n) =>
      new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
        sql,
      ),
    );
    const missing = present.filter((n) => !(n in colCache));
    if (!missing.length) return;
    let cancel = false;
    Promise.all(
      missing.map((n) =>
        api
          .listColumns(connId, schema, n)
          .then((cols) => [n, cols.map((c) => c.name)] as [string, string[]])
          .catch(() => [n, []] as [string, string[]]),
      ),
    ).then((res) => {
      if (cancel) return;
      setColCache((prev) => {
        const nx = { ...prev };
        res.forEach(([n, c]) => (nx[n] = c));
        return nx;
      });
    });
    return () => {
      cancel = true;
    };
  }, [sql, tableNames, connId, schema]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time syntax check: instant bracket/quote lint, then a debounced parse
  // with node-sql-parser that catches things like `LIMITS` and points at the line.
  useEffect(() => {
    const bracket = bracketLint(sql);
    if (bracket) {
      setLintError({ message: bracket });
      return;
    }
    const cleaned = sql.replace(/;\s*$/, "");
    if (!cleaned.trim() || cleaned.includes(";")) {
      setLintError(null);
      return;
    } // skip multi-statement
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { Parser } = await import("node-sql-parser");
        new Parser().astify(cleaned, { database: DB_FOR[flavor ?? "mysql"] });
        if (!cancelled) setLintError(null);
      } catch (e) {
        if (cancelled) return;
        const loc = (
          e as { location?: { start?: { line?: number; offset?: number } } }
        )?.location?.start;
        setLintError({
          line: loc?.line,
          message: friendly(
            String((e as Error)?.message ?? "syntax error"),
            cleaned,
            loc?.offset,
          ),
        });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sql, flavor]);

  const execute = async () => {
    setGuard(null);
    setRunning(true);
    setUsedLimit(rowLimit);
    try {
      setResult(await api.runSql(connId, sql, schema, rowLimit));
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setRunning(false);
      setHistoryNonce((n) => n + 1); // refresh the history panel
    }
  };

  // Safe Query Assistant: reads run immediately; writes go through the guard.
  const run = async () => {
    const stmts = analyzeSql(sql);
    const writes = stmts.filter((s) => s.isWrite);
    if (writes.length === 0) { await execute(); return; }
    if (readOnly) {
      setResult({ ok: false, error: "This connection is read-only. Turn off read-only mode on the connection to run writes." });
      return;
    }
    setGuard(stmts); // open the guard dialog; it confirms, then calls execute()
  };

  const analyze = async () => {
    setAnalyzing(true); setPlanError(""); setPlan(null);
    try {
      setPlan(await api.explainQuery(connId, sql, schema));
    } catch (e) {
      setPlanError(String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const downloadCsv = () => {
    if (!result?.columns || !result.rows) return;
    const blob = new Blob([toCsv(result.columns, result.rows)], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "query-result.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        <SqlCodeEditor
          value={sql}
          onChange={setSql}
          onRun={run}
          minHeight={320}
          errorLine={lintError?.line ?? null}
          tableNames={tableNames}
          columns={colCache}
        />
        <div
          className="flex items-center justify-between gap-3 border-t px-3 py-2"
          style={{ background: "var(--surface-2)" }}
        >
          <span
            className="flex min-w-0 items-center gap-1.5 truncate text-xs"
            style={{ color: lintError ? "var(--danger)" : "var(--text-faint)" }}
          >
            {lintError ? (
              <>
                <span aria-hidden>⚠</span>
                {lintError.line ? <b>Line {lintError.line}:</b> : null}{" "}
                {lintError.message}
              </>
            ) : (
              "No syntax issues · runs in a transaction · Ctrl/⌘+Enter to run"
            )}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs muted">
              Limit
              <select
                className="select !h-8 !w-auto !py-0"
                value={rowLimit}
                onChange={(e) => setRowLimit(Number(e.target.value))}
                title="Max rows to fetch (like Workbench)"
              >
                {LIMIT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()}
                  </option>
                ))}
                <option value={0}>All</option>
              </select>
            </label>
            <button
              className="btn btn-secondary btn-sm py-2"
              onClick={analyze}
              disabled={analyzing || running}
              title="Run EXPLAIN and get performance hints (read-only)"
            >
              {analyzing ? "Analyzing…" : "Analyze"}
            </button>
            <button
              className="btn btn-primary btn-sm py-2"
              onClick={run}
              disabled={running}
            >
              <IconPlay width={12} height={12} /> {running ? "Running…" : "Run"}
            </button>
          </div>
        </div>
      </div>

      <QueryLibrary connId={connId} sql={sql} onLoad={setSql} historyNonce={historyNonce} />

      {planError && <p className="alert-danger whitespace-pre-wrap">{planError}</p>}
      {plan && (
        <div className="card card-pad space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Query plan</h3>
            <span className="badge">{plan.dialect}</span>
            {plan.total_cost != null && <span className="text-xs muted">cost ≈ {plan.total_cost.toLocaleString()}</span>}
            <button className="btn btn-ghost btn-sm !h-7 ml-auto" onClick={() => setPlan(null)}>Dismiss</button>
          </div>
          <div className="space-y-1.5">
            {plan.hints.map((h, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span aria-hidden style={{ color: h.level === "warn" ? "var(--warning)" : "var(--success)" }}>
                  {h.level === "warn" ? "⚠" : "✓"}
                </span>
                <span style={h.level === "warn" ? { color: "var(--text)" } : { color: "var(--text-muted)" }}>{h.message}</span>
              </div>
            ))}
          </div>
          <pre className="overflow-x-auto rounded-lg p-3 text-xs" style={{ background: "var(--surface-2)" }}>{plan.plan_text}</pre>
        </div>
      )}

      {result && !result.ok && (
        <p className="alert-danger whitespace-pre-wrap">{result.error}</p>
      )}

      {result && result.ok && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs muted">
              {result.is_select ? (
                <>
                  {result.rowcount?.toLocaleString()} row
                  {result.rowcount === 1 ? "" : "s"}
                  {result.truncated
                    ? ` (limited to ${usedLimit.toLocaleString()} — raise “Limit” for more)`
                    : ""}
                </>
              ) : (
                <>
                  {result.rowcount?.toLocaleString()} row
                  {result.rowcount === 1 ? "" : "s"} affected
                </>
              )}
              {" · "}
              {result.executed} statement{result.executed === 1 ? "" : "s"} ·{" "}
              {result.elapsed_ms} ms
            </p>
            {result.is_select && !!result.rows?.length && (
              <button
                className="btn btn-secondary btn-sm !h-8"
                onClick={downloadCsv}
              >
                <IconDownload width={13} height={13} /> Download CSV
              </button>
            )}
          </div>
          {result.is_select && result.columns && (
            <div
              className="card overflow-auto"
              style={{ maxHeight: "calc(100vh - 26rem)", minHeight: 160 }}
            >
              <table
                className="w-full text-xs"
                style={{ borderCollapse: "separate", borderSpacing: 0 }}
              >
                <thead>
                  <tr className="text-left uppercase tracking-wide muted">
                    {result.columns.map((c, i) => (
                      <th
                        key={i}
                        className="border-b px-2.5 py-2 font-mono normal-case"
                        style={{
                          position: "sticky",
                          top: 0,
                          zIndex: 2,
                          background: "var(--surface-2)",
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows?.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td
                          key={c}
                          className="max-w-[24rem] truncate border-b px-2.5 py-1 font-mono"
                          title={String(cell ?? "")}
                        >
                          {cell == null ? (
                            <span className="faint">null</span>
                          ) : (
                            String(cell)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows?.length === 0 && (
                <p className="p-6 text-center muted">No rows returned.</p>
              )}
            </div>
          )}
        </>
      )}

      {guard && (
        <GuardDialog
          connId={connId}
          schema={schema}
          sql={sql}
          statements={guard}
          environment={environment}
          onConfirm={execute}
          onClose={() => setGuard(null)}
        />
      )}
    </div>
  );
}
