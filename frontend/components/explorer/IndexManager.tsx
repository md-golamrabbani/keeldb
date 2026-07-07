"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ColumnInfo, ConstraintList, IndexList } from "@/lib/types";
import ConfirmDialog, { type ConfirmState } from "./ConfirmDialog";
import { IconPlus, IconTrash } from "@/components/icons";

// Index CRUD (create/drop) + a read-only view of the table's constraints.
export default function IndexManager({ connId, schema, table, columns }: {
  connId: string; schema: string; table: string; columns: ColumnInfo[];
}) {
  const [indexes, setIndexes] = useState<IndexList | null>(null);
  const [cons, setCons] = useState<ConstraintList | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ name: string; columns: string[]; unique: boolean }>({ name: "", columns: [], unique: false });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(() => {
    setError("");
    api.listIndexes(connId, schema, table).then(setIndexes).catch((e) => setError(String(e)));
    api.listConstraints(connId, schema, table).then(setCons).catch(() => {});
  }, [connId, schema, table]);
  useEffect(load, [load]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(""), 2500); };

  const create = async () => {
    try {
      await api.createIndex(connId, schema, table, form.name.trim(), form.columns, form.unique);
      setAdding(false); setForm({ name: "", columns: [], unique: false }); flash("Index created"); load();
    } catch (e) { setError(String(e)); }
  };

  const drop = (name: string) => setConfirm({
    title: "Drop index", message: `Drop index "${name}"?`, confirmLabel: "Drop", danger: true,
    onConfirm: async () => { await api.dropIndex(connId, schema, table, name); flash("Index dropped"); load(); },
  });

  const toggleCol = (n: string) =>
    setForm((f) => ({ ...f, columns: f.columns.includes(n) ? f.columns.filter((c) => c !== n) : [...f.columns, n] }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Indexes</h3>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding((a) => !a)}><IconPlus width={13} height={13} /> Add index</button>
      </div>
      {notice && <p className="text-xs" style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <p className="alert-danger whitespace-pre-wrap">{error}</p>}

      {adding && (
        <div className="card card-pad space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="label">Index name</label><input className="input !w-52" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ix_table_col" /></div>
            <label className="flex items-center gap-2 pb-2.5 text-sm"><input type="checkbox" checked={form.unique} onChange={(e) => setForm({ ...form, unique: e.target.checked })} /> Unique</label>
          </div>
          <div>
            <label className="label">Columns</label>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {columns.map((c) => (
                <label key={c.name} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={form.columns.includes(c.name)} onChange={() => toggleCol(c.name)} />
                  <span className="font-mono">{c.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={create} disabled={!form.name.trim() || form.columns.length === 0}>Create index</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--surface-2)" }} className="text-left text-xs uppercase tracking-wide muted">
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">Columns</th><th className="px-3 py-2">Flags</th><th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {indexes?.indexes.map((ix) => (
              <tr key={ix.name} className="border-t">
                <td className="px-3 py-1.5 font-mono">{ix.name}</td>
                <td className="px-3 py-1.5 font-mono muted">{ix.columns.join(", ")}</td>
                <td className="px-3 py-1.5">
                  {ix.primary && <span className="badge badge-warning mr-1">PK</span>}
                  {ix.unique && !ix.primary && <span className="badge badge-accent">unique</span>}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {!ix.primary && <button className="btn btn-ghost btn-sm" onClick={() => drop(ix.name)} aria-label="Drop index"><IconTrash width={13} height={13} /></button>}
                </td>
              </tr>
            ))}
            {indexes && indexes.indexes.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-center muted">No indexes.</td></tr>}
          </tbody>
        </table>
      </div>

      {cons && (cons.foreign_keys.length > 0 || cons.unique.length > 0 || cons.checks.length > 0) && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold">Constraints</h3>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {cons.foreign_keys.map((fk, i) => (
                  <tr key={`fk${i}`} className="border-t first:border-t-0">
                    <td className="px-3 py-1.5"><span className="badge badge-accent">FK</span></td>
                    <td className="px-3 py-1.5 font-mono">{fk.columns.join(", ")} → {fk.ref_table}({fk.ref_columns.join(", ")}){fk.on_delete ? ` ON DELETE ${fk.on_delete}` : ""}</td>
                  </tr>
                ))}
                {cons.unique.map((u, i) => (
                  <tr key={`u${i}`} className="border-t"><td className="px-3 py-1.5"><span className="badge">UNIQUE</span></td><td className="px-3 py-1.5 font-mono">{u.columns.join(", ")}</td></tr>
                ))}
                {cons.checks.map((ck, i) => (
                  <tr key={`ck${i}`} className="border-t"><td className="px-3 py-1.5"><span className="badge">CHECK</span></td><td className="px-3 py-1.5 font-mono">{ck.sqltext ?? ck.name}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs faint">Adding or dropping constraints is available on MySQL and PostgreSQL.</p>
        </div>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
