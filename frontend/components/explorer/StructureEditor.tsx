"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ColumnInfo } from "@/lib/types";
import ConfirmDialog, { type ConfirmState } from "./ConfirmDialog";
import IndexManager from "./IndexManager";
import TypeSelect from "./TypeSelect";
import { IconEdit, IconPlus, IconTrash } from "@/components/icons";

export default function StructureEditor({ connId, schema, table }: { connId: string; schema: string; table: string }) {
  const [cols, setCols] = useState<ColumnInfo[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editCol, setEditCol] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "", nullable: true });
  const [adding, setAdding] = useState(false);
  const [newCol, setNewCol] = useState({ name: "", type: "TEXT", nullable: true, default: "" });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(() => {
    setError("");
    api.listColumns(connId, schema, table).then(setCols).catch((e) => setError(String(e)));
  }, [connId, schema, table]);
  useEffect(() => { load(); setEditCol(null); setAdding(false); }, [load]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(""), 2500); };
  const startEdit = (c: ColumnInfo) => { setEditCol(c.name); setForm({ name: c.name, type: c.data_type, nullable: c.nullable }); };

  const saveEdit = async (c: ColumnInfo) => {
    try {
      if (form.type !== c.data_type || form.nullable !== c.nullable) {
        await api.modifyColumn(connId, schema, table, c.name, form.type, form.nullable);
      }
      if (form.name !== c.name) {
        await api.renameColumn(connId, schema, table, c.name, form.name);
      }
      setEditCol(null); flash("Column updated"); load();
    } catch (e) { setError(String(e)); }
  };

  const drop = (name: string) => {
    setConfirm({
      title: "Drop column", message: `Drop column "${name}"? This permanently deletes its data.`,
      confirmLabel: "Drop column", danger: true,
      onConfirm: async () => { await api.dropColumn(connId, schema, table, name); flash("Column dropped"); load(); },
    });
  };

  const addColumn = async () => {
    try {
      await api.addColumn(connId, schema, table, { name: newCol.name, type: newCol.type, nullable: newCol.nullable, default: newCol.default || null });
      setAdding(false); setNewCol({ name: "", type: "TEXT", nullable: true, default: "" }); flash("Column added"); load();
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm muted">{cols.length} columns</p>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding((a) => !a)}><IconPlus width={13} height={13} /> Add column</button>
      </div>
      {notice && <p className="text-xs" style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <p className="alert-danger whitespace-pre-wrap">{error}</p>}

      {adding && (
        <div className="card card-pad flex flex-wrap items-end gap-3">
          <div><label className="label">Name</label><input className="input !w-40" value={newCol.name} onChange={(e) => setNewCol({ ...newCol, name: e.target.value })} /></div>
          <div><label className="label">Type</label><TypeSelect className="!w-40" value={newCol.type} onChange={(v) => setNewCol({ ...newCol, type: v })} /></div>
          <div><label className="label">Default</label><input className="input !w-32" value={newCol.default} onChange={(e) => setNewCol({ ...newCol, default: e.target.value })} /></div>
          <label className="flex items-center gap-2 pb-2.5 text-sm"><input type="checkbox" checked={newCol.nullable} onChange={(e) => setNewCol({ ...newCol, nullable: e.target.checked })} /> Nullable</label>
          <button className="btn btn-primary btn-sm" onClick={addColumn} disabled={!newCol.name}>Add</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--surface-2)" }} className="text-left text-xs uppercase tracking-wide muted">
              <th className="px-3 py-2.5">Column</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Nullable</th>
              <th className="px-3 py-2.5">Key</th><th className="px-3 py-2.5">Default</th><th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => editCol === c.name ? (
              <tr key={c.name} className="border-t" style={{ background: "var(--surface-2)" }}>
                <td className="px-3 py-2"><input className="input !h-8 !py-0 !w-36" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></td>
                <td className="px-3 py-2"><TypeSelect className="!h-8 !py-0 !w-36" value={form.type} onChange={(v) => setForm({ ...form, type: v })} /></td>
                <td className="px-3 py-2"><input type="checkbox" checked={form.nullable} onChange={(e) => setForm({ ...form, nullable: e.target.checked })} /></td>
                <td className="px-3 py-2"></td><td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right">
                  <button className="btn btn-primary btn-sm mr-1" onClick={() => saveEdit(c)}>Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditCol(null)}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={c.name} className="border-t">
                <td className="px-3 py-2 font-mono font-medium">{c.name}</td>
                <td className="px-3 py-2 font-mono muted">{c.data_type}</td>
                <td className="px-3 py-2">{c.nullable ? <span className="muted">yes</span> : <span style={{ color: "var(--danger)" }}>NOT NULL</span>}</td>
                <td className="px-3 py-2">{c.is_pk && <span className="badge badge-warning mr-1">PK</span>}{c.is_fk && <span className="badge badge-accent" title={c.fk_target}>FK</span>}</td>
                <td className="px-3 py-2 font-mono faint">{c.default ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(c)} aria-label="Edit"><IconEdit width={13} height={13} /></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => drop(c.name)} aria-label="Drop"><IconTrash width={13} height={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs faint">Note: changing a column's type is supported on MySQL and PostgreSQL. SQLite (imported .sql) supports add / rename / drop only.</p>

      {cols.length > 0 && (
        <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <IndexManager connId={connId} schema={schema} table={table} columns={cols} />
        </div>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
