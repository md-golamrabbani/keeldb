"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ColumnInfo, ConstraintList, IndexList, TableInfo } from "@/lib/types";
import ConfirmDialog, { type ConfirmState } from "./ConfirmDialog";
import Checkbox from "@/components/ui/Checkbox";
import Combobox from "@/components/ui/Combobox";
import Select from "@/components/ui/Select";
import { IconPlus, IconTrash } from "@/components/icons";

const FK_ACTIONS = ["", "CASCADE", "SET NULL", "RESTRICT", "NO ACTION"];
const NOOP = "__none__";

// Index CRUD (create/drop) + foreign-key CRUD + the table's other constraints.
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

  // foreign-key form
  const [addingFk, setAddingFk] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [refCols, setRefCols] = useState<string[]>([]);
  const [fk, setFk] = useState({ name: "", column: "", ref_table: "", ref_column: "", on_delete: "" });

  const load = useCallback(() => {
    setError("");
    api.listIndexes(connId, schema, table).then(setIndexes).catch((e) => setError(String(e)));
    api.listConstraints(connId, schema, table).then(setCons).catch(() => {});
  }, [connId, schema, table]);
  useEffect(load, [load]);

  useEffect(() => {
    if (addingFk && tables.length === 0)
      api.listTables(connId, schema).then(setTables).catch(() => {});
  }, [addingFk, connId, schema]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!fk.ref_table) { setRefCols([]); return; }
    api.listColumns(connId, schema, fk.ref_table)
      .then((cs) => setRefCols(cs.map((c) => c.name)))
      .catch(() => setRefCols([]));
  }, [fk.ref_table, connId, schema]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(""), 2500); };

  const create = async () => {
    try {
      await api.createIndex(connId, schema, table, form.name.trim(), form.columns, form.unique);
      setAdding(false); setForm({ name: "", columns: [], unique: false }); flash("Index created"); load();
    } catch (e) { setError(String(e)); }
  };

  const createFk = async () => {
    try {
      const name = fk.name.trim() || `fk_${table}_${fk.column}`;
      await api.addForeignKey(connId, schema, table, {
        name, columns: [fk.column], ref_table: fk.ref_table, ref_columns: [fk.ref_column], on_delete: fk.on_delete,
      });
      setAddingFk(false); setFk({ name: "", column: "", ref_table: "", ref_column: "", on_delete: "" });
      flash("Foreign key added"); load();
    } catch (e) { setError(String(e)); }
  };

  const dropCons = (name: string | null, kind: string, label: string) => {
    if (!name) { setError(`This ${label} has no name — drop it via SQL.`); return; }
    setConfirm({
      title: `Drop ${label}`, message: `Drop ${label} "${name}"?`, confirmLabel: "Drop", danger: true,
      onConfirm: async () => { await api.dropConstraint(connId, schema, table, name, kind); flash(`${label} dropped`); load(); },
    });
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
            <label className="flex items-center gap-2 pb-2.5 text-sm"><Checkbox checked={form.unique} onCheckedChange={(v) => setForm({ ...form, unique: v })} /> Unique</label>
          </div>
          <div>
            <label className="label">Columns</label>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {columns.map((c) => (
                <label key={c.name} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={form.columns.includes(c.name)} onCheckedChange={() => toggleCol(c.name)} />
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

      <div className="space-y-1.5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Foreign keys &amp; constraints</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => setAddingFk((a) => !a)}>
            <IconPlus width={13} height={13} /> Add foreign key
          </button>
        </div>

        {addingFk && (
          <div className="card card-pad flex flex-wrap items-end gap-3">
            <div><label className="label">Name</label>
              <input className="input !w-44" value={fk.name} placeholder={`fk_${table}_…`} onChange={(e) => setFk({ ...fk, name: e.target.value })} /></div>
            <div><label className="label">Column</label>
              <Combobox className="!w-40" value={fk.column} placeholder="column"
                onValueChange={(v) => setFk({ ...fk, column: v })}
                options={columns.map((c) => ({ value: c.name }))} /></div>
            <div><label className="label">References table</label>
              <Combobox className="!w-44" value={fk.ref_table} placeholder="table"
                onValueChange={(v) => setFk({ ...fk, ref_table: v, ref_column: "" })}
                options={tables.filter((t) => t.name !== table).map((t) => ({ value: t.name }))} /></div>
            <div><label className="label">Ref column</label>
              <Combobox className="!w-36" value={fk.ref_column} placeholder="column"
                onValueChange={(v) => setFk({ ...fk, ref_column: v })}
                options={refCols.map((c) => ({ value: c }))} /></div>
            <div><label className="label">On delete</label>
              <Select className="!w-36" value={fk.on_delete || NOOP}
                onValueChange={(v) => setFk({ ...fk, on_delete: v === NOOP ? "" : v })}
                options={FK_ACTIONS.map((a) => ({ value: a || NOOP, label: a || "—" }))} /></div>
            <button className="btn btn-primary btn-sm" onClick={createFk}
              disabled={!fk.column || !fk.ref_table || !fk.ref_column}>Add</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAddingFk(false)}>Cancel</button>
          </div>
        )}

        {cons && (cons.foreign_keys.length > 0 || cons.unique.length > 0 || cons.checks.length > 0) ? (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {cons.foreign_keys.map((f, i) => (
                  <tr key={`fk${i}`} className="border-t first:border-t-0">
                    <td className="px-3 py-1.5"><span className="badge badge-accent">FK</span></td>
                    <td className="px-3 py-1.5 font-mono">{f.columns.join(", ")} → {f.ref_table}({f.ref_columns.join(", ")}){f.on_delete ? ` ON DELETE ${f.on_delete}` : ""}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button className="btn btn-ghost btn-sm" onClick={() => dropCons(f.name, "foreign_key", "foreign key")} aria-label="Drop foreign key">
                        <IconTrash width={13} height={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                {cons.unique.map((u, i) => (
                  <tr key={`u${i}`} className="border-t">
                    <td className="px-3 py-1.5"><span className="badge">UNIQUE</span></td>
                    <td className="px-3 py-1.5 font-mono">{u.columns.join(", ")}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button className="btn btn-ghost btn-sm" onClick={() => dropCons(u.name, "unique", "unique constraint")} aria-label="Drop unique constraint">
                        <IconTrash width={13} height={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                {cons.checks.map((ck, i) => (
                  <tr key={`ck${i}`} className="border-t">
                    <td className="px-3 py-1.5"><span className="badge">CHECK</span></td>
                    <td className="px-3 py-1.5 font-mono">{ck.sqltext ?? ck.name}</td>
                    <td className="px-3 py-1.5"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs muted">No foreign keys or extra constraints on this table.</p>
        )}
        <p className="text-xs faint">Adding or dropping constraints is available on MySQL and PostgreSQL.</p>
      </div>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
