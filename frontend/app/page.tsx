"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ConnectionProfile } from "@/lib/types";
import ConnectionForm from "@/components/ConnectionForm";
import StatusPill, { type PillState } from "@/components/StatusPill";
import { IconDatabase, IconEdit, IconFile, IconPlus, IconTable, IconTrash } from "@/components/icons";

const FLAVOR_BADGE: Record<string, string> = {
  mysql: "badge-warning",
  postgresql: "badge-accent",
  supabase: "badge-success",
  neon: "badge-success",
  sqlfile: "badge",
};

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [editing, setEditing] = useState<ConnectionProfile | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pills, setPills] = useState<Record<string, PillState>>({});
  const [error, setError] = useState("");

  const refresh = () => api.listConnections().then(setConnections).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
  }, []);

  const test = async (id: string) => {
    setPills((p) => ({ ...p, [id]: { status: "testing" } }));
    try {
      const r = await api.testSaved(id);
      setPills((p) => ({ ...p, [id]: { status: "done", ...r } }));
    } catch (e) {
      setPills((p) => ({ ...p, [id]: { status: "done", ok: false, server_version: "", latency_ms: 0, error: String(e) } }));
    }
  };

  const remove = async (c: ConnectionProfile) => {
    if (!confirm(`Delete connection "${c.name}"?`)) return;
    await api.deleteConnection(c.id);
    refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
          <p className="mt-1 text-sm muted">Reusable source &amp; target profiles — live databases or imported .sql dumps.</p>
        </div>
        {!showForm && (
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            <IconPlus /> New connection
          </button>
        )}
      </div>

      {error && (
        <p className="alert-danger">
          {error} — is the backend running? Start it with <code>uvicorn app.main:app --port 8000</code>.
        </p>
      )}

      {showForm && (
        <ConnectionForm initial={editing ?? undefined}
          onSaved={() => { setShowForm(false); refresh(); }}
          onCancel={() => setShowForm(false)} />
      )}

      {!showForm && (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {connections.map((c) => (
          <div key={c.id} className="card card-pad flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                  {c.flavor === "sqlfile" ? <IconFile width={17} height={17} /> : <IconDatabase width={17} height={17} />}
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  <div className="w-full font-medium leading-tight">{c.name}</div>
                  <span className={`badge ${FLAVOR_BADGE[c.flavor]} mt-0.5`}>{c.flavor}</span>
                  {c.flavor !== "sqlfile" && (
                    <span className={`badge mt-0.5 ${c.environment === "prod" ? "badge-danger" : c.environment === "staging" ? "badge-warning" : ""}`}>
                      {c.environment}
                    </span>
                  )}
                  {c.read_only && <span className="badge badge-accent mt-0.5">read-only</span>}
                </div>
              </div>
              {c.ssh_enabled && <span className="badge">ssh</span>}
            </div>

            <p className="truncate font-mono text-xs muted">
              {c.flavor === "sqlfile"
                ? `${c.source_filename || "imported.sql"} · ${c.table_count} tables`
                : c.has_connection_string
                  ? "connection string (encrypted)"
                  : `${c.user}@${c.host}:${c.port ?? ""}/${c.database}`}
            </p>

            <div className="mt-auto flex items-center justify-between pt-1">
              <div className="flex gap-1.5">
                <Link className="btn btn-primary btn-sm" href={`/explorer?conn=${c.id}`}><IconTable width={13} height={13} /> Explore</Link>
                <button className="btn btn-secondary btn-sm" onClick={() => test(c.id)}>Test</button>
                {c.flavor !== "sqlfile" && (
                  <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(c); setShowForm(true); }} aria-label="Edit"><IconEdit width={14} height={14} /></button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => remove(c)} aria-label="Delete"><IconTrash width={14} height={14} /></button>
              </div>
              <StatusPill state={pills[c.id] ?? { status: "idle" }} />
            </div>

            {(() => {
              const st = pills[c.id];
              return st && st.status === "done" && !st.ok && st.error ? (
                <p className="break-words rounded-md px-2.5 py-2 text-xs" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                  {st.error}
                </p>
              ) : null;
            })()}
          </div>
        ))}
      </div>
      )}

      {connections.length === 0 && !showForm && !error && (
        <div className="card card-pad flex flex-col items-center gap-2 py-16 text-center">
          <IconDatabase width={28} height={28} />
          <p className="font-medium">No connections yet</p>
          <p className="text-sm muted">Add a live database or import a .sql dump to get started.</p>
        </div>
      )}
    </div>
  );
}
