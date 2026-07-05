"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { ColumnDef } from "@/lib/types";
import GridTable from "./GridTable";
import Modal from "./Modal";
import TypeSelect from "./TypeSelect";
import { IconPlus, IconTrash } from "@/components/icons";

type Dialog = null | "createTable" | "createDb" | "renameDb" | "dropDb" | "privileges";

export default function DatabaseMenu({
  connId, schema, database, onTableCreated,
}: {
  connId: string;
  schema: string;
  database: string;
  onTableCreated: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");

  const item = (label: string, d: Dialog, danger?: boolean) => (
    <button className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-2)]"
      style={danger ? { color: "var(--danger)" } : undefined}
      onClick={() => { setOpen(false); setError(""); setDialog(d); }}>{label}</button>
  );

  return (
    <div className="relative">
      <button className="btn btn-secondary btn-sm !h-9" onClick={() => setOpen((o) => !o)}>Database ▾</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border py-1 shadow-lg" style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}>
            {item("Create table", "createTable")}
            {item("Create database", "createDb")}
            {item("Rename database", "renameDb")}
            {item("Privileges", "privileges")}
            <div className="my-1 border-t" />
            {item("Drop database…", "dropDb", true)}
          </div>
        </>
      )}

      {dialog === "createTable" && (
        <CreateTableModal connId={connId} schema={schema}
          onClose={() => setDialog(null)}
          onCreated={(n) => { setDialog(null); onTableCreated(n); }} />
      )}
      {dialog === "createDb" && (
        <NameModal title="Create database" label="Database name" action="Create"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => { await api.createDatabase(connId, name); setDialog(null); }} />
      )}
      {dialog === "renameDb" && (
        <NameModal title="Rename database" label={`New name for "${database}"`} action="Rename" initial={database}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => { await api.renameDatabase(connId, database, name); setDialog(null); }} />
      )}
      {dialog === "dropDb" && (
        <NameModal title="Drop database" label={`Type the database name "${database}" to confirm`} action="Drop" danger
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (name !== database) throw new Error("name does not match");
            await api.dropDatabase(connId, database); setDialog(null);
          }} />
      )}
      {dialog === "privileges" && (
        <Modal title="Privileges" wide onClose={() => setDialog(null)}>
          <GridTable load={() => api.listPrivileges(connId, schema)} empty="No privilege rows." />
        </Modal>
      )}
    </div>
  );
}

function NameModal({ title, label, action, initial = "", danger, onClose, onSubmit }: {
  title: string; label: string; action: string; initial?: string; danger?: boolean;
  onClose: () => void; onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setError("");
    try { await onSubmit(name.trim()); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">{label}</label><input autoFocus className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }} /></div>
        {error && <p className="alert-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className={danger ? "btn btn-danger" : "btn btn-primary"} onClick={go} disabled={busy || !name.trim()}>{busy ? "…" : action}</button>
        </div>
      </div>
    </Modal>
  );
}

function CreateTableModal({ connId, schema, onClose, onCreated }: {
  connId: string; schema: string; onClose: () => void; onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [cols, setCols] = useState<ColumnDef[]>([{ name: "id", type: "INTEGER", nullable: false, pk: true }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (i: number, p: Partial<ColumnDef>) => setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const add = () => setCols((cs) => [...cs, { name: "", type: "TEXT", nullable: true, pk: false }]);
  const remove = (i: number) => setCols((cs) => cs.filter((_, j) => j !== i));

  const create = async () => {
    setBusy(true); setError("");
    try {
      await api.createTable(connId, schema, name.trim(), cols.filter((c) => c.name.trim()));
      onCreated(name.trim());
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title="Create table" wide onClose={onClose}>
      <div className="space-y-4">
        <div><label className="label">Table name</label><input autoFocus className="input !w-64" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-center gap-2 text-xs uppercase muted">
            <span>Name</span><span>Type</span><span>Null</span><span>PK</span><span></span>
          </div>
          {cols.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-center gap-2">
              <input className="input !h-9 !py-0" value={c.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="column" />
              <TypeSelect className="!h-9 !py-0" value={c.type} onChange={(v) => patch(i, { type: v })} />
              <input type="checkbox" checked={c.nullable} onChange={(e) => patch(i, { nullable: e.target.checked })} />
              <input type="checkbox" checked={c.pk} onChange={(e) => patch(i, { pk: e.target.checked })} />
              <button className="btn btn-ghost btn-sm" onClick={() => remove(i)} aria-label="Remove"><IconTrash width={13} height={13} /></button>
            </div>
          ))}
          <button className="btn btn-secondary btn-sm" onClick={add}><IconPlus width={13} height={13} /> Add column</button>
        </div>
        {error && <p className="alert-danger whitespace-pre-wrap">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={create} disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create table"}</button>
        </div>
      </div>
    </Modal>
  );
}
