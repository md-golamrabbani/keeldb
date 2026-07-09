"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ConnectionProfile, ConnectionProfileIn, Flavor } from "@/lib/types";
import StatusPill, { type PillState } from "./StatusPill";
import { IconChevronLeft, IconDatabase, IconFile, IconLock, IconUpload } from "./icons";
import Select from "@/components/ui/Select";
import Checkbox from "@/components/ui/Checkbox";

const DB_FLAVORS: { id: Flavor; label: string; hint: string }[] = [
  { id: "mysql", label: "MySQL", hint: "MySQL / MariaDB server" },
  { id: "postgresql", label: "PostgreSQL", hint: "Self-hosted or managed PG" },
  { id: "sqlite", label: "SQLite", hint: "Local .db / .sqlite file" },
  { id: "supabase", label: "Supabase", hint: "Connection string + SSL" },
  { id: "neon", label: "Neon", hint: "Serverless Postgres" },
];
const DEFAULT_PORT: Record<string, number> = { mysql: 3306, postgresql: 5432, supabase: 5432, neon: 5432 };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        {hint && <p className="text-xs faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const empty = (flavor: Flavor = "mysql"): ConnectionProfileIn => ({
  name: "",
  flavor,
  host: "",
  port: DEFAULT_PORT[flavor] ?? null,
  database: "",
  user: "",
  password: "",
  ssl: flavor === "supabase" || flavor === "neon",
  connection_string: "",
  service_role_key: "",
  extra_params: {},
  sqlite_path: "",
  ssh_enabled: false,
  ssh_host: "",
  ssh_port: 22,
  ssh_user: "",
  ssh_password: "",
  ssh_private_key: "",
  environment: "dev",
  read_only: false,
});

export default function ConnectionForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: ConnectionProfile;
  onSaved: () => void;
  onCancel: () => void;
}) {
  // "sqlfile" is a creation mode (upload), not an editable live connection.
  const [mode, setMode] = useState<"db" | "sqlfile">("db");
  const [form, setForm] = useState<ConnectionProfileIn>(
    initial
      ? { ...empty(initial.flavor), name: initial.name, flavor: initial.flavor, host: initial.host,
          port: initial.port, database: initial.database, user: initial.user, ssl: initial.ssl,
          ssh_enabled: initial.ssh_enabled, ssh_host: initial.ssh_host, ssh_port: initial.ssh_port,
          ssh_user: initial.ssh_user, environment: initial.environment, read_only: initial.read_only }
      : empty()
  );
  const [pill, setPill] = useState<PillState>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const isPreset = form.flavor === "supabase" || form.flavor === "neon";
  const set = (patch: Partial<ConnectionProfileIn>) => setForm((f) => ({ ...f, ...patch }));

  const test = async () => {
    setPill({ status: "testing" });
    setError("");
    try {
      const r = await api.testUnsaved(form);
      setPill({ status: "done", ...r });
      if (!r.ok) setError(r.error || "Connection failed, but the server returned no detail.");
    } catch (e) {
      setPill({ status: "done", ok: false, server_version: "", latency_ms: 0, error: String(e) });
      setError(String(e));
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      if (mode === "sqlfile") {
        if (!file) throw new Error("choose a .sql file to import");
        await api.uploadSql(file, form.name);
      } else if (initial) {
        await api.updateConnection(initial.id, form);
      } else {
        await api.createConnection(form);
      }
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm !px-1.5" onClick={onCancel} aria-label="Back to connections" title="Back to connections">
            <IconChevronLeft width={16} height={16} />
          </button>
          <h3 className="text-base font-semibold">{initial ? `Edit connection` : "New connection"}</h3>
        </div>
        <StatusPill state={pill} />
      </div>

      {/* mode switch: live DB vs import .sql (only when creating) */}
      {!initial && (
        <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--surface-2)" }}>
          {(["db", "sqlfile"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors"
              style={mode === m ? { background: "var(--surface)", color: "var(--text)", boxShadow: "var(--shadow-sm)" } : { color: "var(--text-muted)" }}
            >
              {m === "db" ? "Live database" : (<><IconFile width={14} height={14} /> Import .sql file</>)}
            </button>
          ))}
        </div>
      )}

      {mode === "sqlfile" ? (
        <div className="space-y-5">
          <div>
            <label className="label">Connection name</label>
            <input className="input" value={form.name} placeholder="e.g. Legacy HRIS (MySQL)"
              onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label className="label">SQL dump file</label>
            <input ref={fileInput} type="file" accept=".sql,text/plain" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button
              className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed py-8 text-sm transition-colors"
              style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}
              onClick={() => fileInput.current?.click()}
            >
              <IconUpload width={22} height={22} />
              {file ? <span className="font-medium" style={{ color: "var(--text)" }}>{file.name}</span> : "Click to choose a .sql dump"}
              <span className="text-xs faint">mysqldump / pg_dump — parsed into a local read-only source</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Database type — cards with a one-line description */}
          <div>
            <label className="label">Database type</label>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {DB_FLAVORS.map((f) => (
                <button key={f.id}
                  onClick={() => set({ flavor: f.id, port: DEFAULT_PORT[f.id], ssl: f.id === "supabase" || f.id === "neon" })}
                  className="rounded-xl border p-3 text-left transition-colors"
                  style={form.flavor === f.id
                    ? { borderColor: "var(--accent)", background: "var(--accent-soft)" }
                    : { borderColor: "var(--border-strong)" }}>
                  <div className="flex items-center gap-2 text-sm font-semibold"
                    style={form.flavor === f.id ? { color: "var(--accent)" } : undefined}>
                    <IconDatabase width={15} height={15} /> {f.label}
                  </div>
                  <div className="mt-0.5 text-xs faint">{f.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
          {/* Column 1 — identity & safety */}
          <div className="space-y-5">
            <Section title="General" hint="How this connection appears in the app.">
              <div>
                <label className="label">Connection name</label>
                <input className="input" value={form.name} placeholder="e.g. Legacy HRIS (MySQL)"
                  onChange={(e) => set({ name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Environment</label>
                  <Select className="w-full" value={form.environment}
                    onValueChange={(v) => set({ environment: v as ConnectionProfileIn["environment"] })}
                    options={[{ value: "dev", label: "Development" }, { value: "staging", label: "Staging" }, { value: "prod", label: "Production" }]} />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.read_only} onCheckedChange={(v) => set({ read_only: v })} />
                    Read-only
                  </label>
                </div>
              </div>
              {form.environment === "prod" && (
                <p className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium"
                  style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                  <IconLock width={13} height={13} /> Production — writes require confirmation, guards stay on.
                </p>
              )}
            </Section>
          </div>

          {/* Column 2 — connection details + SSH tunnel */}
          <div className="space-y-5">
            <Section title="Connection details" hint="Where and how to reach the server.">
            {form.flavor === "sqlite" ? (
              <div>
                <label className="label">Database file path</label>
                <input className="input font-mono text-xs" value={form.sqlite_path ?? ""}
                  placeholder="/home/you/data/app.db"
                  onChange={(e) => set({ sqlite_path: e.target.value })} />
                <p className="mt-1.5 text-xs faint">
                  Full path to a local .db / .sqlite / .sqlite3 file. Reads AND writes —
                  tick Read-only above if you only want to browse it.
                </p>
              </div>
            ) : isPreset ? (
              <>
                <div>
                  <label className="label">Connection string</label>
                  <input className="input font-mono text-xs" value={form.connection_string}
                    placeholder={initial?.has_connection_string ? "•••••• (unchanged — paste to replace)" : "postgresql://user:pass@host:5432/postgres"}
                    onChange={(e) => set({ connection_string: e.target.value })} />
                  <p className="mt-1.5 text-xs faint">
                    {form.flavor === "supabase"
                      ? "Supabase → Project Settings → Database. sslmode=require is added automatically."
                      : "Neon → Dashboard → Connection Details. sslmode=require is added automatically."}
                  </p>
                </div>
                {form.flavor === "supabase" && (
                  <div>
                    <label className="label">Service-role key (optional)</label>
                    <input className="input font-mono text-xs" type="password" value={form.service_role_key}
                      onChange={(e) => set({ service_role_key: e.target.value })} />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="label">Host</label>
                    <input className="input" value={form.host} placeholder="localhost"
                      onChange={(e) => set({ host: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Port</label>
                    <input className="input" type="number" value={form.port ?? ""}
                      onChange={(e) => set({ port: e.target.value ? Number(e.target.value) : null })} />
                  </div>
                </div>
                <div>
                  <label className="label">Database</label>
                  <input className="input" value={form.database} onChange={(e) => set({ database: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">User</label>
                    <input className="input" value={form.user} onChange={(e) => set({ user: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Password</label>
                    <input className="input" type="password" value={form.password}
                      placeholder={initial?.has_password ? "•••••• (unchanged)" : ""}
                      onChange={(e) => set({ password: e.target.value })} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.ssl} onCheckedChange={(v) => set({ ssl: v })} />
                  Use SSL
                </label>
              </>
            )}
            </Section>

            {/* SSH tunnel (not applicable to local SQLite files) */}
            {form.flavor !== "sqlite" && (
            <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={form.ssh_enabled} onCheckedChange={(v) => set({ ssh_enabled: v })} />
                <IconLock width={14} height={14} /> SSH tunnel (bastion host)
              </label>
              {form.ssh_enabled && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="label">SSH host</label>
                      <input className="input" value={form.ssh_host} placeholder="bastion.example.com"
                        onChange={(e) => set({ ssh_host: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">SSH port</label>
                      <input className="input" type="number" value={form.ssh_port}
                        onChange={(e) => set({ ssh_port: Number(e.target.value) || 22 })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">SSH user</label>
                      <input className="input" value={form.ssh_user} onChange={(e) => set({ ssh_user: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">SSH password / passphrase</label>
                      <input className="input" type="password" value={form.ssh_password}
                        placeholder={initial?.ssh_enabled ? "•••••• (unchanged)" : ""}
                        onChange={(e) => set({ ssh_password: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="label">Private key (optional — paste PEM)</label>
                    <textarea className="input font-mono text-xs" rows={3}
                      placeholder={initial?.has_ssh_key ? "•••••• (unchanged)" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                      value={form.ssh_private_key} onChange={(e) => set({ ssh_private_key: e.target.value })} />
                  </div>
                  <p className="text-xs faint">The DB host/port above are reached <em>through</em> the tunnel.</p>
                </div>
              )}
            </div>
            )}
          </div>
          </div>
        </div>
      )}

      {error && <p className="alert-danger">{error}</p>}

      <div className="flex gap-2 pt-1">
        {mode === "db" && (
          <button className="btn btn-secondary" onClick={test}>Test connection</button>
        )}
        <button className="btn btn-primary" onClick={save} disabled={saving || !form.name || (mode === "sqlfile" && !file)}>
          {saving ? "Saving…" : mode === "sqlfile" ? "Import" : "Save"}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
