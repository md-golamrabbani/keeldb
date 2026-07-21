"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ColumnInfo, Environment, Flavor, QueryPlan, QueryResult, SnapshotMeta, Snippet } from "@/lib/types";
import { analyzeSql, type StmtInfo } from "@/lib/sqlguard";
import CellEditor, { FkValueSelect } from "./CellEditor";
import SqlCodeEditor from "./SqlCodeEditor";
import GuardDialog from "./GuardDialog";
import SqlSidebar, { type SaveState } from "./SqlSidebar";
import ResultChart from "./ResultChart";
import Select from "@/components/ui/Select";
import AiSettingsModal from "./AiSettingsModal";
import {
  IconCamera, IconCheck, IconDownload, IconEdit, IconFlask, IconPlay, IconSettings, IconSparkles, IconWarning,
} from "@/components/icons";
import { downloadFile } from "@/lib/toast";

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
  sqlite: "Sqlite",
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
const TIMEOUT_OPTIONS = [
  { value: "0", label: "No timeout" },
  { value: "5", label: "5 s" },
  { value: "30", label: "30 s" },
  { value: "60", label: "1 min" },
  { value: "300", label: "5 min" },
];

const ROW_HEIGHT = 25; // px — fixed row height for the virtualized result grid
const OVERSCAN = 12;

type Cell = string | number | boolean | null;

/** Optional inline-editing wiring for the result grid (present only when the
    query is a simple single-table SELECT with a PK). */
interface GridEdit {
  pending: Record<string, Cell>;
  editing: { r: number; c: number } | null;
  editVal: string;
  start: (r: number, c: number, cur: Cell) => void;
  change: (v: string) => void;
  commit: (r: number, c: number) => void;
  cancel: () => void;
  connId: string;
  schema: string;
  colNames: string[];
  colInfo: Record<string, ColumnInfo>;
}

/** Windowed result rows: only the visible slice (plus overscan) is in the DOM,
    so 100k-row results scroll smoothly. Spacer rows keep the scrollbar honest. */
function VirtualRows({
  rows,
  colCount,
  scrollTop,
  viewport,
  edit,
}: {
  rows: Cell[][];
  colCount: number;
  scrollTop: number;
  viewport: number;
  edit?: GridEdit | null;
}) {
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const count = Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(rows.length, start + count);
  const above = start * ROW_HEIGHT;
  const below = (rows.length - end) * ROW_HEIGHT;
  return (
    <tbody>
      {above > 0 && (
        <tr aria-hidden style={{ height: above }}>
          <td colSpan={colCount} style={{ padding: 0, border: 0 }} />
        </tr>
      )}
      {rows.slice(start, end).map((row, i) => {
        const abs = start + i;
        return (
          <tr key={abs} style={{ height: ROW_HEIGHT }}>
            {row.map((cell, c) => {
              const key = `${abs}::${c}`;
              const isPending = !!edit && Object.prototype.hasOwnProperty.call(edit.pending, key);
              const disp: Cell = isPending ? edit!.pending[key] : cell;
              const isEditing = !!edit && edit.editing?.r === abs && edit.editing?.c === c;
              return (
                <td
                  key={c}
                  className="max-w-[24rem] truncate border-b px-2.5 font-mono"
                  style={isPending ? { background: "color-mix(in srgb, var(--warning) 22%, transparent)" } : undefined}
                  title={edit ? "Double-click to edit" : String(disp ?? "")}
                  onDoubleClick={edit ? () => edit.start(abs, c, disp) : undefined}
                >
                  {isEditing && edit ? (
                    (() => {
                      const colInfo = edit.colInfo[edit.colNames[c]];
                      // Datatype-aware editors matching the Data tab: FK dropdown,
                      // else a typed CellEditor, else a plain input fallback.
                      if (colInfo?.is_fk && colInfo.fk_target) {
                        return (
                          <FkValueSelect
                            connId={edit.connId} schema={edit.schema} fkTarget={colInfo.fk_target}
                            nullable={colInfo.nullable} className="!h-7 !py-0 !text-xs min-w-[8rem]"
                            value={edit.editVal} onChange={(v) => { edit.change(v); edit.commit(abs, c); }}
                          />
                        );
                      }
                      if (colInfo) {
                        return (
                          <CellEditor
                            col={colInfo} autoFocus className="!h-7 !py-0 !text-xs min-w-[8rem]"
                            value={edit.editVal} onChange={edit.change}
                            onCommit={() => edit.commit(abs, c)} onBlurCommit={() => edit.commit(abs, c)}
                            onKeyDown={(e) => { if (e.key === "Enter") edit.commit(abs, c); if (e.key === "Escape") edit.cancel(); }}
                          />
                        );
                      }
                      return (
                        <input
                          autoFocus className="w-full bg-transparent font-mono text-xs outline-none"
                          style={{ caretColor: "var(--text)" }}
                          value={edit.editVal} onChange={(e) => edit.change(e.target.value)}
                          onBlur={() => edit.commit(abs, c)}
                          onKeyDown={(e) => { if (e.key === "Enter") edit.commit(abs, c); if (e.key === "Escape") edit.cancel(); }}
                        />
                      );
                    })()
                  ) : disp == null ? (
                    <span className="faint">null</span>
                  ) : (
                    String(disp)
                  )}
                </td>
              );
            })}
          </tr>
        );
      })}
      {below > 0 && (
        <tr aria-hidden style={{ height: below }}>
          <td colSpan={colCount} style={{ padding: 0, border: 0 }} />
        </tr>
      )}
    </tbody>
  );
}

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
  const [selection, setSelection] = useState(""); // highlighted SQL in the editor, if any
  const runTargetRef = useRef(""); // the SQL actually sent to run() (selection or full)
  const [plan, setPlan] = useState<QueryPlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [historyNonce, setHistoryNonce] = useState(0);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [showChart, setShowChart] = useState(false);

  // Guard extras: statement timeout, pre-write snapshots (undo), tx sandbox.
  const [timeoutS, setTimeoutS] = useState(0);
  const [autoSnapshot, setAutoSnapshot] = useState(environment === "prod");
  const [lastSnapshot, setLastSnapshot] = useState<SnapshotMeta | null>(null);
  const [undoMsg, setUndoMsg] = useState("");
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [sandboxWrites, setSandboxWrites] = useState(0);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [gridScroll, setGridScroll] = useState(0);
  const [gridHeight, setGridHeight] = useState(480);
  const [resultTab, setResultTab] = useState(0);
  const [explaining, setExplaining] = useState(false);
  const [errorHelp, setErrorHelp] = useState<{ explanation: string; suggested_sql?: string } | null>(null);
  // Inline result editing (single-table SELECT with PK).
  const [resultEdits, setResultEdits] = useState<Record<string, Cell>>({});
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [savingEdits, setSavingEdits] = useState(false);
  const [editErr, setEditErr] = useState("");

  const explainError = async () => {
    if (!result?.error) return;
    setExplaining(true); setErrorHelp(null);
    try {
      const r = await api.aiExplainError(connId, schema, sql, result.error);
      if (r.available && r.explanation) setErrorHelp({ explanation: r.explanation, suggested_sql: r.suggested_sql });
      else setErrorHelp({ explanation: r.message || "AI assist is not configured — add a provider & key in AI settings." });
    } catch (e) {
      setErrorHelp({ explanation: String(e) });
    } finally {
      setExplaining(false);
    }
  };
  const gridRef = useRef<HTMLDivElement | null>(null);

  // Multi-statement runs return one result set per SELECT; show them as tabs.
  const sets = result?.ok ? (result.result_sets ?? null) : null;
  const activeSet = sets ? sets[Math.min(resultTab, sets.length - 1)] : null;
  const shownColumns = activeSet?.columns ?? result?.columns;
  const shownRows = activeSet?.rows ?? result?.rows;

  // The result is editable only for a lone simple single-table SELECT with a PK
  // on a writable connection, and not while a sandbox transaction is open.
  const canEdit = !!result?.ok && !!result?.is_select && !sets && !!result?.editable && !readOnly && !sandboxId;
  const editCount = Object.keys(resultEdits).length;

  const startEdit = (r: number, c: number, cur: Cell) => { setEditVal(cur == null ? "" : String(cur)); setEditingCell({ r, c }); };
  const commitCellEdit = (r: number, c: number) => {
    setEditingCell(null);
    if (!shownRows) return;
    const orig = shownRows[r]?.[c];
    const val: Cell = editVal === "" ? null : editVal;
    setResultEdits((p) => {
      const next = { ...p };
      const k = `${r}::${c}`;
      if (String(orig ?? "") === String(val ?? "")) delete next[k];
      else next[k] = val;
      return next;
    });
  };
  const revertResultEdits = () => { setResultEdits({}); setEditingCell(null); setEditErr(""); };
  const applyResultEdits = async () => {
    if (!result?.edit_table || !shownColumns || !shownRows || !editCount) return;
    const byRow = new Map<number, Record<string, Cell>>();
    for (const [k, v] of Object.entries(resultEdits)) {
      const [rs, cs] = k.split("::").map(Number);
      const m = byRow.get(rs) ?? {};
      m[shownColumns[cs]] = v;
      byRow.set(rs, m);
    }
    setSavingEdits(true); setEditErr("");
    try {
      for (const [r, changes] of byRow) {
        const pk: Record<string, Cell> = {};
        for (const name of result.pk_cols ?? []) {
          const i = shownColumns.indexOf(name);
          if (i >= 0) pk[name] = shownRows[r][i];
        }
        await api.updateRow(connId, result.edit_schema || schema, result.edit_table, pk, changes);
      }
      // Reflect saved values locally.
      setResult((prev) => {
        if (!prev?.rows) return prev;
        const rows = prev.rows.map((rr, i) => {
          const ch = byRow.get(i);
          return ch ? rr.map((cc, j) => (shownColumns[j] in ch ? ch[shownColumns[j]] : cc)) : rr;
        });
        return { ...prev, rows };
      });
      setResultEdits({});
    } catch (e) {
      setEditErr(String(e)); // keep edits so the user can fix and retry
    } finally {
      setSavingEdits(false);
    }
  };
  const colInfoMap: Record<string, ColumnInfo> = {};
  for (const ci of result?.edit_columns ?? []) colInfoMap[ci.name] = ci;
  const gridEdit: GridEdit | null = canEdit
    ? {
        pending: resultEdits, editing: editingCell, editVal,
        start: startEdit, change: setEditVal, commit: commitCellEdit, cancel: () => setEditingCell(null),
        connId, schema: result?.edit_schema || schema, colNames: shownColumns ?? [], colInfo: colInfoMap,
      }
    : null;

  const beginSandbox = async () => {
    setSandboxBusy(true);
    try {
      const r = await api.sandboxBegin(connId, schema);
      setSandboxId(r.sandbox_id);
      setSandboxWrites(0);
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setSandboxBusy(false);
    }
  };

  const endSandbox = async (commit: boolean) => {
    if (!sandboxId) return;
    setSandboxBusy(true);
    try {
      const r = commit
        ? await api.sandboxCommit(connId, sandboxId)
        : await api.sandboxRollback(connId, sandboxId);
      setUndoMsg(
        commit
          ? `Sandbox committed — ${r.writes} write statement${r.writes === 1 ? "" : "s"} persisted.`
          : `Sandbox rolled back — ${r.writes} write statement${r.writes === 1 ? "" : "s"} discarded.`,
      );
    } catch (e) {
      setUndoMsg(String(e));
    } finally {
      setSandboxId(null);
      setSandboxWrites(0);
      setSandboxBusy(false);
    }
  };

  // Roll an abandoned sandbox back when the editor unmounts.
  const sandboxRef = useRef<{ id: string | null; connId: string }>({ id: null, connId });
  sandboxRef.current = { id: sandboxId, connId };
  useEffect(
    () => () => {
      const { id, connId: cid } = sandboxRef.current;
      if (id) api.sandboxRollback(cid, id).catch(() => {});
    },
    [],
  );

  const undoSnapshot = async () => {
    if (!lastSnapshot) return;
    try {
      const r = await api.restoreSnapshot(connId, lastSnapshot.id);
      setUndoMsg(`Restored ${r.restored.join(", ")} from the pre-change snapshot.`);
      setLastSnapshot(null);
    } catch (e) {
      setUndoMsg(String(e));
    }
  };

  // ---- saved queries: each auto-saves; New query mints a unique Untitled ----
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const activeIdRef = useRef<string | null>(null); activeIdRef.current = activeId;
  const snippetsRef = useRef<Snippet[]>([]); snippetsRef.current = snippets;
  const creatingRef = useRef(false);
  const firstRun = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { api.listSnippets().then(setSnippets).catch(() => {}); }, []);

  const nextUntitled = () => {
    const used = new Set(snippetsRef.current.map((s) => s.name));
    let n = 1;
    while (used.has(`Untitled query ${n}`)) n++;
    return `Untitled query ${n}`;
  };

  const persist = useCallback(async (text: string) => {
    const aid = activeIdRef.current;
    if (aid) {
      const snap = snippetsRef.current.find((s) => s.id === aid);
      if (snap && snap.sql === text) { setSaveState("saved"); return; }
      setSaveState("saving");
      try {
        const up = await api.updateSnippet(aid, snap?.name ?? "Untitled query", text);
        setSnippets((l) => l.map((s) => (s.id === aid ? up : s)));
        setSaveState("saved");
      } catch { setSaveState("idle"); }
    } else if (text.trim()) {
      if (creatingRef.current) return;
      creatingRef.current = true;
      setSaveState("saving");
      try {
        const created = await api.createSnippet(nextUntitled(), text);
        setSnippets((l) => [created, ...l]);
        setActiveId(created.id);
        setSaveState("saved");
      } catch { setSaveState("idle"); } finally { creatingRef.current = false; }
    }
  }, []);

  // Debounced auto-save on every edit (skips the initial template on mount).
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(sql), 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [sql, persist]);

  const newQuery = async () => {
    setResult(null); setPlan(null);
    try {
      const created = await api.createSnippet(nextUntitled(), "");
      setSnippets((l) => [created, ...l]);
      setActiveId(created.id);
      firstRun.current = true;   // the setSql("") below shouldn't re-trigger a save
      setSql("");
      setSaveState("saved");
    } catch { /* surfaced via query errors */ }
  };

  const selectSnippet = (s: Snippet) => {
    setResult(null); setPlan(null);
    setActiveId(s.id);
    setSql(s.sql);   // auto-save effect no-ops: stored sql === loaded sql
  };

  const deleteSnippet = async (id: string) => {
    await api.deleteSnippet(id);
    setSnippets((l) => l.filter((s) => s.id !== id));
    if (activeIdRef.current === id) { setActiveId(null); firstRun.current = true; setSql(""); setSaveState("idle"); }
  };

  const renameSnippet = async (id: string, name: string) => {
    const snap = snippetsRef.current.find((s) => s.id === id);
    const up = await api.updateSnippet(id, name, snap?.sql ?? "");
    setSnippets((l) => l.map((s) => (s.id === id ? up : s)));
  };

  const saveNow = () => { if (saveTimer.current) clearTimeout(saveTimer.current); persist(sql); };

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
    setUndoMsg("");
    setGridScroll(0);
    setResultTab(0);
    setErrorHelp(null);
    setResultEdits({});
    setEditingCell(null);
    setEditErr("");
    try {
      const target = runTargetRef.current || sql;
      const res = sandboxId
        ? await api.sandboxRun(connId, sandboxId, target, rowLimit)
        : await api.runSql(connId, target, schema, rowLimit, timeoutS, autoSnapshot);
      setResult(res);
      if (res.sandbox?.writes != null) setSandboxWrites(res.sandbox.writes);
      if (res.snapshot?.id) setLastSnapshot(res.snapshot);
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setRunning(false);
      setHistoryNonce((n) => n + 1); // refresh the history panel
    }
  };

  // Safe Query Assistant: reads run immediately; writes go through the guard.
  // In a sandbox, writes run directly — nothing persists until Commit.
  const run = async () => {
    // Run just the highlighted statement(s) when there's a selection, else the
    // whole editor — Workbench-style.
    const target = selection.trim() ? selection : sql;
    runTargetRef.current = target;
    const stmts = analyzeSql(target);
    const writes = stmts.filter((s) => s.isWrite);
    if (writes.length === 0 || sandboxId) { await execute(); return; }
    if (readOnly) {
      setResult({ ok: false, error: "This connection is read-only. Turn off read-only mode on the connection to run writes." });
      return;
    }
    setGuard(stmts); // open the guard dialog; it confirms, then calls execute()
  };

  const askAi = async () => {
    if (!aiQuestion.trim()) return;
    setAiBusy(true); setAiMsg("");
    try {
      const res = await api.aiSql(connId, schema, aiQuestion);
      if (res.available && res.sql) { setSql(res.sql); setAiMsg("Generated — review, then Run."); }
      else setAiMsg(res.message || "AI assist unavailable.");
    } catch (e) {
      setAiMsg(String(e));
    } finally {
      setAiBusy(false);
    }
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
    if (!shownColumns || !shownRows) return;
    downloadFile(toCsv(shownColumns, shownRows), "query-result.csv", "text/csv");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:h-full lg:flex-row">
      <SqlSidebar connId={connId} snippets={snippets} activeId={activeId} saveState={saveState}
        onNew={newQuery} onSelect={selectSnippet} onSave={saveNow} onDelete={deleteSnippet}
        onRename={renameSnippet} onLoadHistory={setSql} historyNonce={historyNonce} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <IconSparkles width={14} height={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--accent)" }} />
          <input className="input !h-9 !w-full !py-0 !pl-8" placeholder="Ask in plain English — e.g. “top 10 customers by total orders”"
            value={aiQuestion} onChange={(e) => setAiQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") askAi(); }} />
        </div>
        <button className="btn btn-secondary btn-sm !h-9" onClick={askAi} disabled={aiBusy || !aiQuestion.trim()}>
          {aiBusy ? "Thinking…" : "Ask AI"}
        </button>
        <button className="btn btn-sm !h-9 !w-9 !px-0 transition-opacity hover:opacity-75" onClick={() => setAiSettingsOpen(true)} title="AI settings (provider & API key)" aria-label="AI settings"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <IconSettings width={15} height={15} />
        </button>
      </div>
      {aiMsg && <p className="text-xs muted">{aiMsg}</p>}
      {aiSettingsOpen && <AiSettingsModal onClose={() => setAiSettingsOpen(false)} onSaved={() => setAiMsg("AI settings saved.")} />}

      <div className="card overflow-hidden">
        {/* Top action bar — stays fixed above the editor, so growing the editor
            never pushes Run/Analyze/options out of reach (real-world tools put
            these on top). */}
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1"
          style={{ background: "var(--surface-2)" }}
        >
          <div className="flex items-center gap-1.5">
            <button
              className="btn btn-primary btn-sm !h-7"
              onClick={run}
              disabled={running}
              title={selection.trim() ? "Run only the highlighted selection (Ctrl/⌘+Enter)" : "Run the query (Ctrl/⌘+Enter)"}
            >
              <IconPlay width={12} height={12} /> {running ? "Running…" : selection.trim() ? "Run selection" : "Run"}
            </button>
            <button
              className="btn btn-secondary btn-sm !h-7"
              onClick={analyze}
              disabled={analyzing || running}
              title="Run EXPLAIN and get performance hints (read-only)"
            >
              {analyzing ? "Analyzing…" : "Analyze"}
            </button>
            {!sandboxId && !readOnly && (
              <button
                className="btn btn-secondary btn-sm !h-7"
                onClick={beginSandbox}
                disabled={sandboxBusy || running}
                title="Open a transaction sandbox: writes stay invisible to everyone else until you Commit — or Rollback to discard them."
              >
                Sandbox
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label
              className="flex cursor-pointer items-center gap-1.5 text-xs muted"
              title="Before destructive SQL (UPDATE/DELETE/DROP/…) runs, affected tables are snapshotted so you can undo."
            >
              <input
                type="checkbox"
                checked={autoSnapshot}
                onChange={(e) => setAutoSnapshot(e.target.checked)}
                disabled={!!sandboxId}
              />
              Snapshot
            </label>
            <label className="flex items-center gap-1.5 text-xs muted">
              Timeout
              <Select
                ariaLabel="Statement timeout"
                value={String(timeoutS)}
                onValueChange={(v) => setTimeoutS(Number(v))}
                options={TIMEOUT_OPTIONS}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs muted">
              Limit
              <Select
                ariaLabel="Row limit"
                value={String(rowLimit)}
                onValueChange={(v) => setRowLimit(Number(v))}
                options={[...LIMIT_OPTIONS.map((n) => ({ value: String(n), label: n.toLocaleString() })), { value: "0", label: "All" }]}
              />
            </label>
          </div>
        </div>
        <SqlCodeEditor
          value={sql}
          onChange={setSql}
          onRun={run}
          onSelectionChange={setSelection}
          minHeight={168}
          errorLine={lintError?.line ?? null}
          tableNames={tableNames}
          columns={colCache}
        />
        {/* Status line only appears when there's an actual syntax issue — no
            space wasted on an all-clear message. */}
        {lintError && (
          <div
            className="flex items-center gap-3 border-t px-3 py-1"
            style={{ background: "var(--surface-2)" }}
          >
            <span
              className="flex min-w-0 items-center gap-1.5 truncate text-xs"
              style={{ color: "var(--danger)" }}
            >
              <IconWarning width={13} height={13} className="shrink-0" aria-hidden />
              {lintError.line ? <b>Line {lintError.line}:</b> : null}{" "}
              {lintError.message}
            </span>
          </div>
        )}
      </div>

      {sandboxId && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
          style={{ background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent)" }}
        >
          <span className="inline-flex items-center gap-1.5">
            <IconFlask width={14} height={14} className="shrink-0" />
            Transaction sandbox — {sandboxWrites} write statement{sandboxWrites === 1 ? "" : "s"} pending.
            Nothing is visible to other sessions until you commit.
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button className="btn btn-primary btn-sm !h-7" onClick={() => endSandbox(true)} disabled={sandboxBusy}>
              Commit
            </button>
            <button className="btn btn-secondary btn-sm !h-7" onClick={() => endSandbox(false)} disabled={sandboxBusy}>
              Rollback
            </button>
          </span>
        </div>
      )}

      {undoMsg && <p className="text-xs muted">{undoMsg}</p>}

      {result?.warning && (
        <p className="alert-danger flex items-start gap-1.5 whitespace-pre-wrap">
          <IconWarning width={14} height={14} className="mt-0.5 shrink-0" /> {result.warning}
        </p>
      )}

      {lastSnapshot && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs"
          style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
        >
          <span className="inline-flex items-center gap-1.5">
            <IconCamera width={13} height={13} className="shrink-0" />
            Snapshot saved before this change (
            {lastSnapshot.tables.map((t) => `${t.table}: ${t.rows.toLocaleString()} rows`).join(", ")}
            {lastSnapshot.skipped?.length
              ? ` — skipped ${lastSnapshot.skipped.map((s) => `${s.table} (${s.reason})`).join(", ")}`
              : ""}
            ).
          </span>
          <button className="btn btn-secondary btn-sm !h-7 ml-auto" onClick={undoSnapshot}>
            Undo change
          </button>
          <button className="btn btn-ghost btn-sm !h-7" onClick={() => setLastSnapshot(null)}>
            Dismiss
          </button>
        </div>
      )}

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
                <span aria-hidden className="mt-0.5" style={{ color: h.level === "warn" ? "var(--warning)" : "var(--success)" }}>
                  {h.level === "warn" ? <IconWarning width={14} height={14} /> : <IconCheck width={14} height={14} />}
                </span>
                <span style={h.level === "warn" ? { color: "var(--text)" } : { color: "var(--text-muted)" }}>{h.message}</span>
              </div>
            ))}
          </div>
          <pre className="overflow-x-auto rounded-lg p-3 text-xs" style={{ background: "var(--surface-2)" }}>{plan.plan_text}</pre>
        </div>
      )}

      {result && !result.ok && (
        <div className="space-y-2">
          <div className="alert-danger flex flex-wrap items-start gap-2 whitespace-pre-wrap">
            <span className="min-w-0 flex-1">{result.error}</span>
            <button className="btn btn-secondary btn-sm !h-7 shrink-0" onClick={explainError} disabled={explaining}
              title="Ask the AI to explain this error using your schema">
              <IconSparkles width={12} height={12} /> {explaining ? "Explaining…" : "Explain"}
            </button>
          </div>
          {errorHelp && (
            <div className="card card-pad space-y-2 text-sm">
              <p className="flex items-start gap-1.5">
                <IconSparkles width={14} height={14} className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />
                <span className="whitespace-pre-wrap">{errorHelp.explanation}</span>
              </p>
              {errorHelp.suggested_sql && (
                <div className="space-y-1.5">
                  <pre className="overflow-x-auto rounded-lg p-2.5 font-mono text-xs" style={{ background: "var(--surface-2)" }}>{errorHelp.suggested_sql}</pre>
                  <button className="btn btn-secondary btn-sm !h-7"
                    onClick={() => { setSql(errorHelp.suggested_sql!); setErrorHelp(null); }}>
                    Use suggested SQL
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {result && result.ok && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 truncate text-xs muted">
              <span className="truncate">
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
              </span>
              {canEdit && editCount === 0 && (
                <span className="inline-flex shrink-0 items-center gap-1" style={{ color: "var(--accent)" }}
                  title="Editable result — double-click a cell to change it, then Save">
                  <IconEdit width={12} height={12} /> Editable
                </span>
              )}
            </p>
            {result.is_select && !!result.rows?.length && (
              <div className="flex shrink-0 items-center gap-2">
                <button className="btn btn-secondary btn-sm !h-7" onClick={() => setShowChart((s) => !s)}>
                  {showChart ? "Hide chart" : "Chart"}
                </button>
                <button className="btn btn-secondary btn-sm !h-7" onClick={downloadCsv}>
                  <IconDownload width={13} height={13} /> CSV
                </button>
              </div>
            )}
          </div>

          {sets && sets.length > 1 && (
            <div className="flex items-center gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }}>
              {sets.map((s, i) => (
                <button key={i} onClick={() => { setResultTab(i); setGridScroll(0); }}
                  title={s.statement}
                  className="whitespace-nowrap border-b-2 px-3 py-1.5 text-xs font-medium transition-colors"
                  style={i === resultTab
                    ? { borderColor: "var(--accent)", color: "var(--accent)" }
                    : { borderColor: "transparent", color: "var(--text-muted)" }}>
                  Result {i + 1} <span className="faint">({s.rowcount.toLocaleString()})</span>
                </button>
              ))}
            </div>
          )}

          {showChart && result.is_select && shownColumns && shownRows && shownRows.length > 0 && (
            <ResultChart columns={shownColumns} rows={shownRows} />
          )}
          {editErr && <p className="alert-danger whitespace-pre-wrap text-sm">{editErr}</p>}
          {editCount > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm"
              style={{ background: "color-mix(in srgb, var(--warning) 12%, transparent)", borderColor: "var(--warning)" }}>
              <span className="font-medium" style={{ color: "var(--warning)" }}>
                {editCount} unsaved change{editCount === 1 ? "" : "s"}
              </span>
              <span className="text-xs faint">Writes to {result.edit_table} by primary key.</span>
              <div className="ml-auto flex items-center gap-2">
                <button className="btn btn-ghost btn-sm !h-8" onClick={revertResultEdits} disabled={savingEdits}>Revert</button>
                <button className="btn btn-primary btn-sm !h-8" onClick={applyResultEdits} disabled={savingEdits}>
                  {savingEdits ? "Saving…" : `Save ${editCount} change${editCount === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          )}
          {result.is_select && shownColumns && (
            <div
              ref={(el) => {
                gridRef.current = el;
                if (el && el.clientHeight !== gridHeight) setGridHeight(el.clientHeight);
              }}
              onScroll={(e) => setGridScroll((e.target as HTMLDivElement).scrollTop)}
              className="card min-h-0 flex-1 overflow-auto"
              style={{ minHeight: 160 }}
            >
              <table
                className="w-full text-xs"
                style={{ borderCollapse: "separate", borderSpacing: 0 }}
              >
                <thead>
                  <tr className="text-left uppercase tracking-wide muted">
                    {shownColumns.map((c, i) => (
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
                <VirtualRows
                  rows={shownRows ?? []}
                  colCount={shownColumns.length}
                  scrollTop={gridScroll}
                  viewport={gridHeight}
                  edit={gridEdit}
                />
              </table>
              {shownRows?.length === 0 && (
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
          sql={runTargetRef.current || sql}
          statements={guard}
          environment={environment}
          onConfirm={execute}
          onClose={() => setGuard(null)}
        />
      )}
      </div>
    </div>
  );
}
