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
import {
  IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconDownload, IconFilter, IconLink, IconPlus, IconRefresh, IconSearch, IconTrash, IconUpload,
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
  const [exportMenu, setExportMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, string>>({});
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

  const commitEdit = async (r: number, c: number, raw: string) => {
    setEditing(null);
    const row = data!.rows[r];
    const col = colnames[c];
    const value: Cell = raw === "" ? null : raw;
    if (String(row[c] ?? "") === String(value ?? "")) return;
    try {
      await api.updateRow(connId, schema, table, pkFor(row), { [col]: value });
      setData({ ...data!, rows: data!.rows.map((rr, i) => (i === r ? rr.map((cc, j) => (j === c ? value : cc)) : rr)) });
      flash("Row updated");
    } catch (e) { setError(String(e)); }
  };

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
    try {
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(newRow)) if (v !== "") values[k] = v;
      await api.insertRow(connId, schema, table, values);
      setAdding(false); setNewRow({}); flash("Row inserted"); load();
    } catch (e) { setError(String(e)); }
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
    try { const r = await api.exportTable(connId, schema, table, fmt); window.open(api.exportUrl(r.export_id, r.mode), "_blank"); }
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
    <div className="space-y-3">
      {/* toolbar — all controls share h-9 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <IconSearch width={14} height={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
          <input className="input !h-9 !w-56 !py-0 !pl-8" placeholder="Search all columns…" defaultValue={search}
            onKeyDown={(e) => { if (e.key === "Enter") { setSearch((e.target as HTMLInputElement).value); setPage(0); } }} />
        </div>
        <button className="btn btn-secondary btn-sm !h-9" onClick={() => setShowFilter((s) => !s)}>
          <IconFilter width={14} height={14} /> Filter{filters.length ? ` · ${filters.length}` : ""}
        </button>
        <button className="btn btn-secondary btn-sm !h-9" onClick={load} disabled={loading}><IconRefresh width={14} height={14} /> Refresh</button>
        <button className="btn btn-secondary btn-sm !h-9" onClick={() => { setAdding((a) => !a); setNewRow({}); }} disabled={!editable}
          title={editable ? "" : "Table has no primary key — rows can't be added safely"}>
          <IconPlus width={14} height={14} /> Add row
        </button>
        {selected.size > 0 && (
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

      {adding && data && (
        <Modal title={`Add row to ${table}`} wide onClose={() => setAdding(false)}>
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
            <div className="flex items-center gap-2">
              <p className="text-xs faint"><span style={{ color: "var(--danger)" }}>*</span> required (NOT NULL, no default) · empty = NULL</p>
              <div className="ml-auto flex gap-2">
                <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={addRow}><IconPlus width={14} height={14} /> Insert row</button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* fills the remaining viewport height (like Structure/DDL); header stays sticky */}
      <div className="card overflow-auto" style={{ minHeight: 220, height: "calc(100dvh - 21.5rem)" }}>
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
                  className="cursor-pointer select-none whitespace-nowrap border-b px-2.5 py-1.5 font-mono normal-case"
                  onClick={() => sortBy(col.name)} title="Click to sort">
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
                        {editable && <button className="btn btn-ghost !p-1" onClick={() => removeRow(r)} aria-label="Delete row"><IconTrash width={13} height={13} /></button>}
                      </div>
                    </td>
                  )}
                  {row.map((cell, c) => {
                    const isEditing = editing?.r === r && editing?.c === c;
                    const colInfo = data!.columns.find((ci) => ci.name === colnames[c]);
                    const fk = colInfo?.is_fk && colInfo.fk_target ? parseFk(colInfo.fk_target) : null;
                    const base = "max-w-[20rem] truncate border-b px-2 py-1 font-mono";
                    return (
                      <td key={c} className={base} style={c === 0 ? stCell(firstLeft, rowBg) : undefined}
                        onDoubleClick={() => { if (editable && !fk) { setEditValue(cell == null ? "" : String(cell)); setEditing({ r, c }); } }}
                        title={fk ? `View ${fk.table} where ${fk.column} = ${cell}` : editable ? "Double-click to edit" : String(cell ?? "")}>
                        {isEditing && colInfo ? (
                          <CellEditor
                            col={colInfo}
                            autoFocus
                            className="!h-7 !py-0 !text-xs min-w-[8rem]"
                            value={editValue}
                            onChange={setEditValue}
                            onCommit={(v) => commitEdit(r, c, v)}
                            onBlurCommit={() => commitEdit(r, c, editValue)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(r, c, editValue);
                              if (e.key === "Escape") setEditing(null);
                            }}
                          />
                        ) : cell == null ? <span className="faint">null</span>
                          : fk ? (
                            <button className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2" style={{ color: "var(--accent)" }}
                              onClick={() => setPeek({ table: fk.table, column: fk.column, value: String(cell) })}>
                              {String(cell)} <IconLink width={11} height={11} />
                            </button>
                          ) : String(cell)}
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
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs muted">
          <div className="flex items-center gap-2">
            <span>{data.total.toLocaleString()} rows{search || filters.length ? " (filtered)" : ""}</span>
            <span className="faint">·</span>
            <label className="flex items-center gap-1.5">
              Show
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(0); }}
                options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))} />
              rows
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm !h-8" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><IconChevronLeft width={14} height={14} /></button>
            <span>Page {page + 1} / {totalPages}</span>
            <button className="btn btn-secondary btn-sm !h-8" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}><IconChevronRight width={14} height={14} /></button>
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
