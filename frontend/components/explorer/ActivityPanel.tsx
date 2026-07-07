"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ActivityReport } from "@/lib/types";
import ConfirmDialog, { type ConfirmState } from "./ConfirmDialog";
import { IconRefresh, IconTrash } from "@/components/icons";

// Live server sessions / running queries with a guarded kill switch.
export default function ActivityPanel({ connId }: { connId: string }) {
  const [rep, setRep] = useState<ActivityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.activity(connId).then(setRep).catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, [connId]);
  useEffect(load, [load]);

  const kill = (id: number) => setConfirm({
    title: "Kill session", message: `Terminate session ${id}? Its running statement will be aborted.`,
    confirmLabel: "Kill session", danger: true,
    onConfirm: async () => {
      await api.killSession(connId, id);
      setNotice(`Session ${id} terminated`); setTimeout(() => setNotice(""), 2500); load();
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Active sessions</h3>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          <IconRefresh width={13} height={13} /> {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {notice && <p className="text-xs" style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <p className="alert-danger">{error}</p>}

      {rep && !rep.supported && (
        <p className="text-xs faint">Live sessions are available on PostgreSQL and MySQL. SQLite is an embedded file with no server sessions.</p>
      )}

      {rep && rep.supported && (
        rep.sessions.length === 0 ? <p className="text-sm muted">No active sessions.</p> : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--surface-2)" }} className="text-left text-xs uppercase tracking-wide muted">
                  <th className="px-3 py-2">ID</th><th className="px-3 py-2">User</th><th className="px-3 py-2">State</th>
                  <th className="px-3 py-2 text-right">Duration</th><th className="px-3 py-2">Query</th><th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rep.sessions.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-1.5 font-mono">{s.id}{s.is_self && <span className="ml-1 badge">you</span>}</td>
                    <td className="px-3 py-1.5 font-mono muted">{s.user ?? "—"}</td>
                    <td className="px-3 py-1.5">{s.state ?? "—"}{s.wait ? <span className="ml-1 text-xs faint">/ {s.wait}</span> : ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{s.duration_s != null ? `${s.duration_s}s` : "—"}</td>
                    <td className="px-3 py-1.5 max-w-[24rem] truncate font-mono text-xs" title={s.query ?? ""}>{s.query ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right">
                      {!s.is_self && <button className="btn btn-ghost btn-sm" onClick={() => kill(s.id)} aria-label="Kill session"><IconTrash width={13} height={13} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
