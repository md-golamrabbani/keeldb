"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import Modal from "./Modal";
import ConfirmDialog, { type ConfirmState } from "./ConfirmDialog";
import Select from "@/components/ui/Select";
import { IconPlus, IconTrash } from "@/components/icons";

interface DbUser { name: string; host: string; superuser: boolean | null; can_login?: boolean }

/** Users & privileges: list DB users/roles, create one, grant read/write/all
 * on the current schema, or drop a user. MySQL & PostgreSQL only. */
export default function UsersModal({ connId, schema, onClose }: {
  connId: string; schema: string; onClose: () => void;
}) {
  const [users, setUsers] = useState<DbUser[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", password: "", host: "%" });
  const [grantFor, setGrantFor] = useState<DbUser | null>(null);
  const [grantLevel, setGrantLevel] = useState<"read" | "write" | "all">("read");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(() => {
    setError("");
    api.listUsers(connId)
      .then((r) => { setSupported(r.supported); setUsers(r.users); })
      .catch((e) => setError(String(e)));
  }, [connId]);
  useEffect(load, [load]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(""), 3000); };

  const create = async () => {
    setError("");
    try {
      await api.createUser(connId, form.name.trim(), form.password, form.host || "%");
      setCreating(false); setForm({ name: "", password: "", host: "%" });
      flash("User created"); load();
    } catch (e) { setError(String(e)); }
  };

  const grant = async () => {
    if (!grantFor) return;
    setError("");
    try {
      await api.grantUser(connId, grantFor.name, schema, grantLevel, grantFor.host || "%");
      flash(`Granted ${grantLevel} on ${schema} to ${grantFor.name}`);
      setGrantFor(null);
    } catch (e) { setError(String(e)); }
  };

  const drop = (u: DbUser) => setConfirm({
    title: "Drop user",
    message: `Drop user "${u.name}${u.host ? `@${u.host}` : ""}"? This cannot be undone.`,
    confirmLabel: "Drop user", danger: true,
    onConfirm: async () => { await api.dropUser(connId, u.name, u.host || "%"); flash("User dropped"); load(); },
  });

  return (
    <Modal title="Users & privileges" wide onClose={onClose}>
      <div className="space-y-4">
        {!supported ? (
          <p className="text-sm muted">User management is available on MySQL and PostgreSQL connections.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm muted">{users?.length ?? "…"} users · grants apply to <span className="font-mono">{schema}</span></p>
              <button className="btn btn-secondary btn-sm" onClick={() => setCreating((c) => !c)}>
                <IconPlus width={13} height={13} /> New user
              </button>
            </div>

            {creating && (
              <div className="card card-pad flex flex-wrap items-end gap-3">
                <div><label className="label">Username</label>
                  <input className="input !w-40" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><label className="label">Password</label>
                  <input className="input !w-40" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
                <div><label className="label">Host (MySQL)</label>
                  <input className="input !w-28" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></div>
                <button className="btn btn-primary btn-sm" onClick={create} disabled={!form.name.trim() || !form.password}>Create</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            )}

            {notice && <p className="text-xs" style={{ color: "var(--success)" }}>{notice}</p>}
            {error && <p className="alert-danger whitespace-pre-wrap">{error}</p>}

            <div className="card max-h-[45vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--surface-2)" }} className="text-left text-xs uppercase tracking-wide muted">
                    <th className="px-3 py-2">User</th><th className="px-3 py-2">Host</th>
                    <th className="px-3 py-2">Flags</th><th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users?.map((u) => (
                    <tr key={`${u.name}@${u.host}`} className="border-t">
                      <td className="px-3 py-1.5 font-mono font-medium">{u.name}</td>
                      <td className="px-3 py-1.5 font-mono muted">{u.host || "—"}</td>
                      <td className="px-3 py-1.5">
                        {u.superuser && <span className="badge badge-warning mr-1">superuser</span>}
                        {u.can_login === false && <span className="badge">no login</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button className="btn btn-ghost btn-sm" onClick={() => setGrantFor(u)}>Grant…</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => drop(u)} aria-label="Drop user">
                          <IconTrash width={13} height={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {users && users.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-4 text-center muted">No users visible (missing privileges?).</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {grantFor && (
              <div className="card card-pad flex flex-wrap items-center gap-3">
                <span className="text-sm">
                  Grant on <span className="font-mono">{schema}</span> to <b className="font-mono">{grantFor.name}</b>:
                </span>
                <Select className="!w-56" value={grantLevel}
                  onValueChange={(v) => setGrantLevel(v as typeof grantLevel)}
                  options={[
                    { value: "read", label: "Read (SELECT)" },
                    { value: "write", label: "Write (SELECT/INSERT/UPDATE/DELETE)" },
                    { value: "all", label: "All privileges" },
                  ]} />
                <button className="btn btn-primary btn-sm" onClick={grant}>Grant</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setGrantFor(null)}>Cancel</button>
              </div>
            )}
          </>
        )}
        <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      </div>
    </Modal>
  );
}
