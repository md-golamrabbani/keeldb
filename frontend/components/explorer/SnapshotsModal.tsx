"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SnapshotMeta } from "@/lib/types";
import Modal from "./Modal";
import ConfirmDialog, { type ConfirmState } from "./ConfirmDialog";
import { IconCamera, IconRefresh, IconTrash } from "@/components/icons";

/** Time machine: every auto-snapshot taken before destructive SQL, newest
 * first — restore any of them (drop + replay) or clean them up. */
export default function SnapshotsModal({ connId, onClose }: {
  connId: string; onClose: () => void;
}) {
  const [snaps, setSnaps] = useState<SnapshotMeta[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(() => {
    api.listSnapshots(connId).then(setSnaps).catch((e) => setError(String(e)));
  }, [connId]);
  useEffect(load, [load]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(""), 3000); };

  const restore = (s: SnapshotMeta) => setConfirm({
    title: "Restore snapshot",
    message: `Restore ${s.tables.map((t) => t.table).join(", ")} to how ${s.tables.length === 1 ? "it" : "they"} looked at ${new Date(s.created_at ?? "").toLocaleString()}? Current contents of ${s.tables.length === 1 ? "this table" : "these tables"} will be replaced.`,
    confirmLabel: "Restore", danger: true,
    onConfirm: async () => {
      setBusyId(s.id); setError("");
      try {
        const r = await api.restoreSnapshot(connId, s.id);
        flash(`Restored ${r.restored.join(", ")}`);
      } catch (e) { setError(String(e)); } finally { setBusyId(""); }
    },
  });

  const remove = async (s: SnapshotMeta) => {
    await api.deleteSnapshot(connId, s.id).catch(() => {});
    load();
  };

  return (
    <Modal title="Snapshots (undo history)" wide onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm muted">
            Taken automatically before destructive SQL when “Snapshot” is on in the editor.
          </p>
          <button className="btn btn-secondary btn-sm" onClick={load}><IconRefresh width={13} height={13} /> Refresh</button>
        </div>
        {notice && <p className="text-xs" style={{ color: "var(--success)" }}>{notice}</p>}
        {error && <p className="alert-danger whitespace-pre-wrap">{error}</p>}

        {!snaps ? (
          <p className="muted">Loading…</p>
        ) : snaps.length === 0 ? (
          <p className="py-6 text-center text-sm muted">
            No snapshots for this connection yet — run an UPDATE/DELETE/DROP with Snapshot enabled and it will appear here.
          </p>
        ) : (
          <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
            {snaps.map((s) => (
              <li key={s.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex flex-wrap items-center gap-2">
                  <IconCamera width={14} height={14} style={{ color: "var(--text-muted)" }} />
                  <span className="text-sm font-medium">
                    {s.tables.map((t) => `${t.table} (${t.rows.toLocaleString()} rows)`).join(", ")}
                  </span>
                  <span className="text-xs faint">{s.created_at ? new Date(s.created_at).toLocaleString() : ""}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <button className="btn btn-secondary btn-sm !h-7" onClick={() => restore(s)} disabled={busyId === s.id}>
                      {busyId === s.id ? "Restoring…" : "Restore"}
                    </button>
                    <button className="btn btn-ghost btn-sm !h-7" onClick={() => remove(s)} aria-label="Delete snapshot">
                      <IconTrash width={13} height={13} />
                    </button>
                  </span>
                </div>
                {s.sql_head && (
                  <p className="mt-1.5 truncate font-mono text-xs faint" title={s.sql_head}>
                    before: {s.sql_head}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      </div>
    </Modal>
  );
}
