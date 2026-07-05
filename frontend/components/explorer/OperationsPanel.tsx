"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ConfirmDialog, { type ConfirmState } from "./ConfirmDialog";

export default function OperationsPanel({
  connId, schema, table, onChanged,
}: {
  connId: string;
  schema: string;
  table: string;
  onChanged: (newTable?: string) => void;
}) {
  const [rename, setRename] = useState(table);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  useEffect(() => setRename(table), [table]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(""), 2500); };

  const doRename = async () => {
    setError("");
    try { await api.renameTable(connId, schema, table, rename); flash("Renamed"); onChanged(rename); }
    catch (e) { setError(String(e)); }
  };

  return (
    <div className="max-w-2xl space-y-4">
      {notice && <p className="text-xs" style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <p className="alert-danger whitespace-pre-wrap">{error}</p>}

      <div className="card card-pad space-y-2">
        <h3 className="font-semibold">Rename table</h3>
        <div className="flex items-end gap-2">
          <div className="flex-1"><label className="label">New name</label><input className="input" value={rename} onChange={(e) => setRename(e.target.value)} /></div>
          <button className="btn btn-primary" disabled={!rename || rename === table} onClick={doRename}>Rename</button>
        </div>
      </div>

      <div className="card card-pad space-y-2">
        <h3 className="font-semibold">Truncate table</h3>
        <p className="text-sm muted">Delete <b>all rows</b> but keep the table structure. This cannot be undone.</p>
        <button className="btn btn-danger" onClick={() => setConfirm({
          title: "Truncate table", message: `Delete every row in "${table}"? The table structure is kept. This cannot be undone.`,
          confirmLabel: "Truncate", danger: true,
          onConfirm: async () => { await api.truncateTable(connId, schema, table); flash("Truncated"); onChanged(table); },
        })}>Truncate {table}</button>
      </div>

      <div className="card card-pad space-y-2" style={{ borderColor: "var(--danger)" }}>
        <h3 className="font-semibold" style={{ color: "var(--danger)" }}>Drop table</h3>
        <p className="text-sm muted">Permanently delete the table and all its data.</p>
        <button className="btn btn-danger" onClick={() => setConfirm({
          title: "Drop table", message: `Drop table "${table}"? This permanently deletes the table and all its data.`,
          confirmLabel: "Drop table", danger: true,
          onConfirm: async () => { await api.dropTable(connId, schema, table); flash("Dropped"); onChanged(undefined); },
        })}>Drop {table}</button>
      </div>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
