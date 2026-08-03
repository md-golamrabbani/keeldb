"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { downloadFile } from "@/lib/toast";
import Modal from "./Modal";
import { IconSettings } from "@/components/icons";

// Per-database actions in the "Select a database" list — so a database can be
// renamed / exported / dropped directly from its row, without first making it
// the active schema. Mirrors the top-right Database menu but targeted at THIS
// database.
type Dlg = null | "rename" | "drop";

export default function SchemaRowMenu({ connId, database, onOpen, onChanged }: {
  connId: string; database: string; onOpen: () => void; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [err, setErr] = useState("");

  const exportDb = async () => {
    setOpen(false); setErr("");
    try {
      const res = await api.backupDatabase(connId, database);
      downloadFile(res.sql, `${database}.sql`, "application/sql");
    } catch (e) { setErr(String(e)); }
  };

  return (
    <div className="relative shrink-0">
      <button aria-label={`Actions for ${database}`} title="Database actions"
        className="rounded p-1 opacity-0 transition-opacity hover:bg-[var(--surface-2)] group-hover:opacity-100 data-[open=true]:opacity-100"
        data-open={open}
        onClick={(e) => { e.stopPropagation(); setErr(""); setOpen((o) => !o); }}>
        <IconSettings width={14} height={14} style={{ color: "var(--text-faint)" }} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border py-1"
            style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-lg)" }}
            onClick={(e) => e.stopPropagation()}>
            <MenuBtn label="Open" onClick={() => { setOpen(false); onOpen(); }} />
            <MenuBtn label="Rename database…" onClick={() => { setOpen(false); setDlg("rename"); }} />
            <MenuBtn label="Export database (.sql)" onClick={exportDb} />
            <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
            <MenuBtn label="Drop database…" danger onClick={() => { setOpen(false); setDlg("drop"); }} />
          </div>
        </>
      )}
      {err && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg px-3 py-2 text-xs"
          style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
          onClick={(e) => { e.stopPropagation(); setErr(""); }}>{err}</div>
      )}

      {dlg === "rename" && (
        <NameConfirm title="Rename database" label={`New name for "${database}"`} action="Rename" initial={database}
          onClose={() => setDlg(null)}
          onSubmit={async (name) => { await api.renameDatabase(connId, database, name); setDlg(null); onChanged(); }} />
      )}
      {dlg === "drop" && (
        <NameConfirm title="Drop database" label={`Type "${database}" to confirm`} action="Drop" danger
          onClose={() => setDlg(null)}
          onSubmit={async (name) => {
            if (name !== database) throw new Error("name does not match");
            await api.dropDatabase(connId, database); setDlg(null); onChanged();
          }} />
      )}
    </div>
  );
}

function MenuBtn({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-2)]"
      style={danger ? { color: "var(--danger)" } : undefined} onClick={onClick}>{label}</button>
  );
}

function NameConfirm({ title, label, action, initial = "", danger, onClose, onSubmit }: {
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
        <div>
          <label className="label">{label}</label>
          <input autoFocus className="input" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
        </div>
        {error && <p className="alert-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className={danger ? "btn btn-danger" : "btn btn-primary"} onClick={go}
            disabled={busy || !name.trim()}>{busy ? "…" : action}</button>
        </div>
      </div>
    </Modal>
  );
}
