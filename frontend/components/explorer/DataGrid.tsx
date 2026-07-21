"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import type { FilterCond, TableData } from "@/lib/types";
import { PAGE_SIZES } from "@/lib/types";
import AdvancedFilter from "./AdvancedFilter";
import CellEditor, { FkValueSelect } from "./CellEditor";
import ConfirmDialog, { type ConfirmState } from "./ConfirmDialog";
import DependentsDialog from "./DependentsDialog";
import ErrorBanner from "./ErrorBanner";
import FkPeekDialog, { parseFk } from "./FkPeekDialog";
import ImportCsvModal from "./ImportCsvModal";
import Modal from "./Modal";
import Checkbox from "@/components/ui/Checkbox";
import Select from "@/components/ui/Select";
import { toast } from "@/lib/toast";
import {
  IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconCopy, IconDownload, IconFilter, IconLink, IconPlus, IconRefresh, IconSearch, IconTrash, IconUpload,
} from "@/components/icons";

type Cell = string | number | boolean | null;

export default function DataGrid({
  connId, schema, table, initialFilter, onOpenReference, readOnly = false,
}: {
  connId: string;
  schema: string;
  table: string;
  initialFilter?: { column: string; value: string | null } | null;
  onOpenReference?: (table: string, column: string, value: string) => void;
  readOnly?: boolean;
}) {
  const [data, setData] = useState<TableData | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterCond[]>(
    initialFilter
      ? [initialFilter.value === null
          ? { column: initialFilter.column, op: "is_null", value: "" }
          : { column: initialFilter.column, op: "=", value: initialFilter.value }]
      : []
  );
  const [showFilter, setShowFilter] = useState(!!initialFilter);
  const [peek, setPeek] = useState<{ table: string; column: string; value: string } | null>(null);
  const [refRow, setRefRow] = useState<Record<string, Cell> | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFormat, setImportFormat] = useState<"csv" | "json" | "sql">("csv");
  const [importMenu, setImportMenu] = useState(false);
  const [orderBy, setOrderBy] = useState("");
  const [orderDir, setOrderDir] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pending, setPending] = useState<Record<string, Cell>>({}); // staged cell edits, key `${r}::${c}`
  const [saving, setSaving] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState(""); // error shown inside the Add-row dialog
  const [addBusy, setAddBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setSelected(new Set());
    try {
      const d = await api.tableData(connId, {
        schema, table, limit: pageSize, offset: page * pageSize, order_by: orderBy, order_dir: orderDir, search, filters,
      });
      setData(d);
    } catch (e) {
      setError(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [connId, schema, table, page, pageSize, orderBy, orderDir, search, filters]);

  // NOTE: this component is remounted (via React key) when connId/schema/table
  // change, so per-table state resets naturally — no reset effect needed here
  // (which also lets initialFilter survive the first mount).
  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(""), 2500); };
  const hasPk = (data?.pk_cols.length ?? 0) > 0;
  const editable = hasPk && !readOnly;
  const colnames = useMemo(() => data?.colnames ?? [], [data]);

  const pkFor = (row: Cell[]): Record<string, Cell> => {
    const pk: Record<string, Cell> = {};
    for (const name of data!.pk_cols) {
      const idx = colnames.indexOf(name);
      if (idx >= 0) pk[name] = row[idx];
    }
    return pk;
  };

  // Workbench-style editing: cell edits are STAGED (not written immediately),
  // then applied together via "Save changes" — or thrown away via "Revert".
  const cellKey = (r: number, c: number) => `${r}::${c}`;
  const pendingCount = Object.keys(pending).length;
  const dirty = pendingCount > 0;

  const stageEdit = (r: number, c: number, raw: string) => {
    setEditing(null);
    const row = data!.rows[r];
    const value: Cell = raw === "" ? null : raw;
    const key = cellKey(r, c);
    setPending((p) => {
      const next = { ...p };
      // Editing a cell back to its original value clears the pending change.
      if (String(row[c] ?? "") === String(value ?? "")) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const applyEdits = async () => {
    if (!data || !dirty) return;
    // Group staged cell changes by row so each row is written in one UPDATE.
    const byRow = new Map<number, Record<string, Cell>>();
    for (const [key, value] of Object.entries(pending)) {
      const [rs, cs] = key.split("::").map(Number);
      const m = byRow.get(rs) ?? {};
      m[colnames[cs]] = value;
      byRow.set(rs, m);
    }
    setSaving(true); setError("");
    try {
      for (const [r, changes] of byRow) {
        await api.updateRow(connId, schema, table, pkFor(data.rows[r]), changes);
      }
      // Reflect the saved values locally without a full reload.
      setData((d) => d && ({
        ...d,
        rows: d.rows.map((rr, i) => {
          const changes = byRow.get(i);
          return changes ? rr.map((cc, j) => (colnames[j] in changes ? changes[colnames[j]] : cc)) : rr;
        }),
      }));
      setPending({});
      flash(`Saved ${pendingCount} change${pendingCount === 1 ? "" : "s"}`);
    } catch (e) {
      setError(String(e)); // keep pending edits so the user can fix and retry
    } finally {
      setSaving(false);
    }
  };

  const revertEdits = () => { setPending({}); setEditing(null); flash("Changes reverted"); };

  const removeRow = (r: number) => {
    setConfirm({
      title: "Delete row", message: "Delete this row? This cannot be undone.", confirmLabel: "Delete", danger: true,
      onConfirm: async () => { await api.deleteRow(connId, schema, table, pkFor(data!.rows[r])); flash("Row deleted"); load(); },
    });
  };

  const bulkDelete = () => {
    const n = selected.size;
    setConfirm({
      title: "Delete rows", message: `Delete ${n} selected row(s)? This cannot be undone.`, confirmLabel: `Delete ${n}`, danger: true,
      onConfirm: async () => {
        const pks = [...selected].map((i) => pkFor(data!.rows[i]));
        const res = await api.deleteRowsBulk(connId, schema, table, pks);
        flash(`Deleted ${res.deleted} row(s)`); load();
      },
    });
  };

  const addRow = async () => {
    // Keep the dialog open and show the error *inside* it on failure (e.g. a
    // duplicate key), so the user never loses what they typed.
    setAddError(""); setAddBusy(true);
    try {
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(newRow)) if (v !== "") values[k] = v;
      await api.insertRow(connId, schema, table, values);
      setAdding(false); setNewRow({}); flash("Row inserted"); load();
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAddBusy(false);
    }
  };

  const openAddRow = () => { setNewRow({}); setAddError(""); setAdding(true); };
  const closeAddRow = () => { setAdding(false); setAddError(""); };

  // Copy selected rows (or all shown rows if none selected) to the clipboard as
  // TSV — pastes cleanly into spreadsheets and back into this grid.
  const copyRows = async () => {
    if (!data) return;
    const idxs = selected.size ? [...selected].sort((a, b) => a - b) : data.rows.map((_, i) => i);
    const cell = (v: Cell) => (v == null ? "" : String(v).replace(/\t/g, " ").replace(/\r?\n/g, " "));
    const tsv = [data.colnames.join("\t"), ...idxs.map((i) => data.rows[i].map(cell).join("\t"))].join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      flash(`Copied ${idxs.length} row(s)`);
    } catch (e) {
      setError(`Could not copy: ${e}`);
    }
  };

  // Paste rows from the clipboard (TSV, e.g. copied from a spreadsheet or this
  // grid). Columns map by position to this table; a header row matching the
  // column names is skipped. Confirms before inserting.
  const pasteRows = async () => {
    setError("");
    let text = "";
    try { text = await navigator.clipboard.readText(); }
    catch (e) { setError(`Could not read clipboard: ${e}`); return; }
    const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);
    if (!lines.length) { setError("Clipboard is empty."); return; }
    let parsed = lines.map((l) => l.split("\t"));
    // Skip a header row if it matches this table's columns.
    if (parsed[0].join("\t").toLowerCase() === colnames.join("\t").toLowerCase()) parsed = parsed.slice(1);
    if (!parsed.length) { setError("Nothing to paste after the header row."); return; }
    const rows = parsed.map((cells) => {
      const values: Record<string, unknown> = {};
      cells.forEach((v, i) => { if (i < colnames.length && v !== "") values[colnames[i]] = v; });
      return values;
    });
    setConfirm({
      title: "Paste rows",
      message: `Insert ${rows.length} row(s) into ${table}? Empty cells become NULL/defaults. Columns map left-to-right.`,
      confirmLabel: `Insert ${rows.length}`,
      onConfirm: async () => {
        let ok = 0;
        for (const values of rows) {
          try { await api.insertRow(connId, schema, table, values); ok++; }
          catch (e) { setError(`Inserted ${ok} of ${rows.length}; stopped at row ${ok + 1}: ${e}`); break; }
        }
        if (ok === rows.length) flash(`Pasted ${ok} row(s)`);
        load();
      },
    });
  };

  const runSqlFile = async (f: File) => {
    setError("");
    try {
      const text = await f.text();
      const r = await api.runSql(connId, text, schema, 0);
      if (!r.ok) setError(r.error || "SQL import failed");
      else { flash(`Ran ${r.executed ?? ""} statement(s) from ${f.name}`); load(); }
    } catch (e) { setError(String(e)); }
  };

  const doExport = async (fmt: string) => {
    try {
      const r = await api.exportTable(connId, schema, table, fmt);
      window.open(api.exportUrl(r.export_id, r.mode), "_blank");
      toast(`Exported ${r.rows.toLocaleString()} row(s) as ${fmt.toUpperCase()} — download started`);
    }
    catch (e) { setError(String(e)); }
  };

  const sortBy = (name: string) => {
    if (orderBy === name) setOrderDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setOrderBy(name); setOrderDir("asc"); }
    setPage(0);
  };

  const toggleRow = (i: number) => setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const toggleAll = () => setSelected((s) => (s.size === data!.rows.length ? new Set() : new Set(data!.rows.map((_, i) => i))));

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  // sticky column geometry (checkbox + row-actions + first data column stay left).
  // The action column shows whenever the table has a PK (reverse-FK works read-only);
  // it also holds Delete when the table is editable.
  const CHECK_W = 30;
  const ACT_W = editable ? 56 : 30;
  const actLeft = editable ? CHECK_W : 0;
  const firstLeft = (editable ? CHECK_W : 0) + (hasPk ? ACT_W : 0);
  const headBg = "var(--surface-2)";
  const stHead = (left?: number): CSSProperties =>
    ({ position: "sticky", top: 0, zIndex: left != null ? 3 : 2, background: headBg, ...(left != null ? { left } : {}) });
  const stCell = (left: number, bg: string): CSSProperties =>
    ({ position: "sticky", left, zIndex: 1, background: bg });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* toolbar — all controls share h-9 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <IconSearch width={14} height={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
          <input className="input !h-9 !w-56 !py-0 !pl-8" placeholder="Search all columns…" defaultValue={search} disabled={dirty}
            title={dirty ? "Save or revert your changes first" : ""}
            onKeyDown={(e) => { if (e.key === "Enter") { setSearch((e.target as HTMLInputElement).value); setPage(0); } }} />
        </div>
        <button className="btn btn-secondary btn-sm !h-9" onClick={() => setShowFilter((s) => !s)} disabled={dirty}
          title={dirty ? "Save or revert your changes first" : ""}>
          <IconFilter width={14} height={14} /> Filter{filters.length ? ` · ${filters.length}` : ""}
        </button>
        <button className="btn btn-secondary btn-sm !h-9" onClick={load} disabled={loading || dirty}
          title={dirty ? "Save or revert your changes first" : ""}><IconRefresh width={14} height={14} /> Refresh</button>
        <button className="btn btn-secondary btn-sm !h-9" onClick={() => (adding ? closeAddRow() : openAddRow())} disabled={!editable || dirty}
          title={!editable ? "Table has no primary key — rows can't be added safely" : dirty ? "Save or revert your changes first" : ""}>
          <IconPlus width={14} height={14} /> Add row
        </button>
        {editable && (
          <button className="btn btn-secondary btn-sm !h-9" onClick={pasteRows} disabled={dirty}
            title={dirty ? "Save or revert your changes first" : "Insert rows from the clipboard (TSV / spreadsheet)"}>
            <IconUpload width={14} height={14} /> Paste rows
          </button>
        )}
        {data && data.rows.length > 0 && (
          <button className="btn btn-secondary btn-sm !h-9" onClick={copyRows}
            title={selected.size ? `Copy ${selected.size} selected row(s) as TSV` : "Copy all shown rows as TSV"}>
            <IconCopy width={14} height={14} /> Copy{selected.size ? ` ${selected.size}` : ""}
          </button>
        )}
        {selected.size > 0 && !dirty && (
          <button className="btn btn-danger btn-sm !h-9" onClick={bulkDelete}><IconTrash width={14} height={14} /> Delete {selected.size} selected</button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileInput} type="file" className="hidden"
            accept={importFormat === "json" ? ".json,application/json" : importFormat === "sql" ? ".sql,text/plain" : ".csv,text/csv"}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (importFormat === "sql") runSqlFile(f); else setImportFile(f); } e.currentTarget.value = ""; }} />
          <div className="relative">
            <button className="btn btn-secondary btn-sm !h-9" onClick={() => setImportMenu((o) => !o)} disabled={readOnly}
              title={readOnly ? "Connection is read-only" : ""}>
              <IconUpload width={14} height={14} /> Import <IconChevronDown width={13} height={13} style={{ color: "var(--text-faint)" }} />
            </button>
            {importMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setImportMenu(false)} />
                <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border py-1 shadow-lg" style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}>
                  {(["csv", "json", "sql"] as const).map((f) => (
                    <button key={f} className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-2)]"
                      onClick={() => { setImportFormat(f); setImportMenu(false); setTimeout(() => fileInput.current?.click(), 0); }}>
                      {f === "sql" ? "Run .sql script" : `${f.toUpperCase()} file`}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <button className="btn btn-secondary btn-sm !h-9" onClick={() => setExportMenu((o) => !o)}>
              <IconDownload width={14} height={14} /> Export <IconChevronDown width={13} height={13} style={{ color: "var(--text-faint)" }} />
            </button>
            {exportMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportMenu(false)} />
                <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border py-1 shadow-lg" style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}>
                  {(["csv", "json", "sql"] as const).map((f) => (
                    <button key={f} className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-2)]"
                      onClick={() => { setExportMenu(false); doExport(f); }}>
                      {f.toUpperCase()} file
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showFilter && data && (
        <AdvancedFilter
          key={filters.map((f) => `${f.column}:${f.op}:${f.value}`).join("|")}
          columns={data.columns}
          initial={filters}
          onApply={(f) => { setFilters(f); setPage(0); }}
          onClear={() => { setFilters([]); setPage(0); }}
        />
      )}

      {!editable && data && (
        <p className="text-xs muted">
          {readOnly
            ? "This connection is read-only — enable writes on the connection to edit."
            : "This table has no primary key — cells are read-only and rows can't be edited or deleted."}
        </p>
      )}
      {notice && <p className="text-xs" style={{ color: "var(--success)" }}>{notice}</p>}
      <ErrorBanner message={error} onClose={() => setError("")} />

      {/* Unsaved-edits bar — Workbench-style: edits are staged until applied. */}
      {dirty && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm"
          style={{ background: "var(--warning-soft, color-mix(in srgb, var(--warning) 12%, transparent))", borderColor: "var(--warning)" }}>
          <span className="font-medium" style={{ color: "var(--warning)" }}>
            {pendingCount} unsaved change{pendingCount === 1 ? "" : "s"}
          </span>
          <span className="text-xs faint">Navigation is locked until you save or revert.</span>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn btn-ghost btn-sm !h-8" onClick={revertEdits} disabled={saving}>Revert</button>
            <button className="btn btn-primary btn-sm !h-8" onClick={applyEdits} disabled={saving}>
              {saving ? "Saving…" : `Save ${pendingCount} change${pendingCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {adding && data && (
        <Modal title={`Add row to ${table}`} wide onClose={closeAddRow}>
          <div className="space-y-4">
            <div className="card max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--surface-2)" }} className="text-left text-xs uppercase tracking-wide muted">
                    <th className="px-3 py-2">Column</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="w-1/2 px-3 py-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.columns.map((col) => (
                    <tr key={col.name} className="border-t align-middle">
                      <td className="whitespace-nowrap px-3 py-2 font-mono font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {col.name}
                          {col.is_pk && <span className="badge badge-warning">PK</span>}
                          {col.is_fk && <span className="badge badge-accent" title={`→ ${col.fk_target}`}>FK</span>}
                          {!col.nullable && col.default == null && <span style={{ color: "var(--danger)" }}>*</span>}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs muted">{col.data_type}</td>
                      <td className="px-3 py-2">
                        {col.is_fk && col.fk_target ? (
                          <FkValueSelect
                            connId={connId}
                            schema={schema}
                            fkTarget={col.fk_target}
                            nullable={col.nullable}
                            className="!h-9 w-full"
                            value={newRow[col.name] ?? ""}
                            onChange={(v) => setNewRow((n) => ({ ...n, [col.name]: v }))}
                          />
                        ) : (
                          <CellEditor
                            col={col}
                            className="!h-9 w-full"
                            value={newRow[col.name] ?? ""}
                            onChange={(v) => setNewRow((n) => ({ ...n, [col.name]: v }))}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {addError && (
              <div className="alert-danger whitespace-pre-wrap text-sm">{addError}</div>
            )}
            <div className="flex items-center gap-2">
              <p className="text-xs faint"><span style={{ color: "var(--danger)" }}>*</span> required (NOT NULL, no default) · empty = NULL</p>
              <div className="ml-auto flex gap-2">
                <button className="btn btn-ghost" onClick={closeAddRow} disabled={addBusy}>Cancel</button>
                <button className="btn btn-primary" onClick={addRow} disabled={addBusy}><IconPlus width={14} height={14} /> {addBusy ? "Inserting…" : "Insert row"}</button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* fills the remaining space in the flex column; only this area scrolls
          (no second page-level scrollbar); header stays sticky */}
      <div className="card min-h-0 flex-1 overflow-auto" style={{ minHeight: 220 }}>
        <table className="w-full text-xs" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr className="text-left uppercase tracking-wide muted">
              {editable && (
                <th style={{ ...stHead(0), width: CHECK_W, minWidth: CHECK_W }} className="px-0 py-1.5 text-center">
                  <Checkbox checked={!!data && selected.size === data.rows.length && data.rows.length > 0} onCheckedChange={toggleAll} ariaLabel="Select all rows" />
                </th>
              )}
              {hasPk && <th style={{ ...stHead(actLeft), width: ACT_W, minWidth: ACT_W }} className="px-0 py-1.5"></th>}
              {(data?.columns ?? []).map((col, ci) => (
                <th key={col.name} style={ci === 0 ? stHead(firstLeft) : stHead()}
                  className={`select-none whitespace-nowrap border-b px-2.5 py-1.5 font-mono normal-case ${dirty ? "cursor-not-allowed" : "cursor-pointer"}`}
                  onClick={() => { if (!dirty) sortBy(col.name); }} title={dirty ? "Save or revert your changes first" : "Click to sort"}>
                  <span className="inline-flex items-center gap-1 align-middle">
                    {col.name}
                    {col.is_pk && <span className="badge badge-warning">PK</span>}
                    {col.is_fk && <span className="badge badge-accent" title={`→ ${col.fk_target}`}>FK</span>}
                    {orderBy === col.name && (orderDir === "asc"
                      ? <IconChevronUp width={12} height={12} />
                      : <IconChevronDown width={12} height={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row, r) => {
              const rowBg = selected.has(r) ? "var(--accent-soft)" : "var(--surface)";
              return (
                <tr key={r}>
                  {editable && (
                    <td style={{ ...stCell(0, rowBg), width: CHECK_W, minWidth: CHECK_W }} className="border-b px-0 py-1 text-center">
                      <Checkbox checked={selected.has(r)} onCheckedChange={() => toggleRow(r)} ariaLabel="Select row" />
                    </td>
                  )}
                  {hasPk && (
                    <td style={{ ...stCell(actLeft, rowBg), width: ACT_W, minWidth: ACT_W }} className="border-b px-0 py-1">
                      <div className="flex items-center justify-center gap-0.5">
                        <button className="btn btn-ghost !p-1" onClick={() => setRefRow(pkFor(row))} title="Rows that reference this row"><IconLink width={13} height={13} /></button>
                        {editable && <button className="btn btn-ghost !p-1" onClick={() => removeRow(r)} disabled={dirty} aria-label="Delete row" title={dirty ? "Save or revert your changes first" : "Delete row"}><IconTrash width={13} height={13} /></button>}
                      </div>
                    </td>
                  )}
                  {row.map((cell, c) => {
                    const isEditing = editing?.r === r && editing?.c === c;
                    const colInfo = data!.columns.find((ci) => ci.name === colnames[c]);
                    const fk = colInfo?.is_fk && colInfo.fk_target ? parseFk(colInfo.fk_target) : null;
                    // Show the staged value (if any) instead of the stored one.
                    const key = cellKey(r, c);
                    const isPending = Object.prototype.hasOwnProperty.call(pending, key);
                    const disp: Cell = isPending ? pending[key] : cell;
                    const base = "max-w-[20rem] truncate border-b px-2 py-1 font-mono";
                    const cellBg = isPending
                      ? "color-mix(in srgb, var(--warning) 22%, transparent)"
                      : (c === 0 ? rowBg : undefined);
                    return (
                      <td key={c} className={base}
                        style={c === 0 ? { ...stCell(firstLeft, rowBg), ...(isPending ? { background: cellBg } : {}) } : (isPending ? { background: cellBg } : undefined)}
                        onDoubleClick={() => { if (editable) { setEditValue(disp == null ? "" : String(disp)); setEditing({ r, c }); } }}
                        title={isPending ? "Unsaved change — Save to write it" : fk ? `Click value to peek at ${fk.table} · double-click to change` : editable ? "Double-click to edit" : String(disp ?? "")}>
                        {isEditing && colInfo ? (
                          fk && colInfo.fk_target ? (
                            // FK cells edit via a searchable dropdown of real parent keys
                            <FkValueSelect
                              connId={connId}
                              schema={schema}
                              fkTarget={colInfo.fk_target}
                              nullable={colInfo.nullable}
                              className="!h-7 !py-0 !text-xs min-w-[10rem]"
                              value={editValue}
                              onChange={(v) => stageEdit(r, c, v)}
                            />
                          ) : (
                          <CellEditor
                            col={colInfo}
                            autoFocus
                            className="!h-7 !py-0 !text-xs min-w-[8rem]"
                            value={editValue}
                            onChange={setEditValue}
                            onCommit={(v) => stageEdit(r, c, v)}
                            onBlurCommit={() => stageEdit(r, c, editValue)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") stageEdit(r, c, editValue);
                              if (e.key === "Escape") setEditing(null);
                            }}
                          />
                          )
                        ) : disp == null ? <span className="faint">null</span>
                          : fk ? (
                            <button className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2" style={{ color: "var(--accent)" }}
                              onClick={() => setPeek({ table: fk.table, column: fk.column, value: String(disp) })}>
                              {String(disp)} <IconLink width={11} height={11} />
                            </button>
                          ) : String(disp)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && data.rows.length === 0 && !loading && <p className="p-8 text-center muted">No rows.</p>}
        {loading && <p className="p-8 text-center muted">Loading…</p>}
      </div>

      {/* pagination + rows-per-page */}
      {data && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 text-xs muted">
          <div className="flex items-center gap-2">
            <span title={data.total_estimated ? "Estimated from table statistics — fast, may be slightly off" : undefined}>{data.total_estimated ? "~" : ""}{data.total.toLocaleString()} rows{search || filters.length ? " (filtered)" : ""}</span>
            <span className="faint">·</span>
            <label className="flex items-center gap-1.5" title={dirty ? "Save or revert your changes first" : ""}>
              Show
              <Select value={String(pageSize)} disabled={dirty} onValueChange={(v) => { setPageSize(Number(v)); setPage(0); }}
                options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))} />
              rows
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm !h-8" disabled={page === 0 || dirty} title={dirty ? "Save or revert your changes first" : ""} onClick={() => setPage((p) => Math.max(0, p - 1))}><IconChevronLeft width={14} height={14} /></button>
            <span>Page {page + 1} / {totalPages}</span>
            <button className="btn btn-secondary btn-sm !h-8" disabled={page + 1 >= totalPages || dirty} title={dirty ? "Save or revert your changes first" : ""} onClick={() => setPage((p) => p + 1)}><IconChevronRight width={14} height={14} /></button>
          </div>
        </div>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      {peek && (
        <FkPeekDialog connId={connId} schema={schema} targetTable={peek.table} targetColumn={peek.column} value={peek.value}
          onClose={() => setPeek(null)}
          onOpen={() => { onOpenReference?.(peek.table, peek.column, peek.value); setPeek(null); }} />
      )}
      {refRow && (
        <DependentsDialog connId={connId} schema={schema} table={table} pk={refRow}
          onClose={() => setRefRow(null)}
          onOpenReference={(t, col, val) => { onOpenReference?.(t, col, val); setRefRow(null); }} />
      )}
      {importFile && data && (
        <ImportCsvModal connId={connId} schema={schema} table={table} file={importFile}
          columns={data.columns.map((c) => c.name)} format={importFormat === "json" ? "json" : "csv"}
          onClose={() => setImportFile(null)}
          onDone={(msg) => { setImportFile(null); flash(msg); load(); }} />
      )}
    </div>
  );
}
