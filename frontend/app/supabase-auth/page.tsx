"use client";
import { useEffect, useMemo, useState } from "react";
import { api, createSupabaseAuthUsers } from "@/lib/api";
import type { ColumnInfo, ConnectionProfile, SupabaseAuthEvent, TableInfo } from "@/lib/types";
import Select from "@/components/ui/Select";
import Checkbox from "@/components/ui/Checkbox";

interface Progress { processed: number; total: number; created: number; skipped: number; failed: number }
const EMPTY: Progress = { processed: 0, total: 0, created: 0, skipped: 0, failed: 0 };

export default function SupabaseAuthPage() {
  const [conns, setConns] = useState<ConnectionProfile[]>([]);
  const [connId, setConnId] = useState("");
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [table, setTable] = useState("");
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [emailColumn, setEmailColumn] = useState("email");

  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [passwordMode, setPasswordMode] = useState<"email_prefix" | "common">("email_prefix");
  const [commonPassword, setCommonPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState(true);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress>(EMPTY);
  const [preview, setPreview] = useState<{ email: string; password: string }[]>([]);
  const [errors, setErrors] = useState<{ email: string; message: string }[]>([]);
  const [dryRun, setDryRun] = useState(true);
  const [error, setError] = useState("");
  const [done, setDone] = useState<SupabaseAuthEvent | null>(null);

  useEffect(() => { api.listConnections().then(setConns).catch(() => {}); }, []);
  useEffect(() => {
    if (!connId) return;
    setSchema(""); setTables([]); setTable(""); setColumns([]);
    api.listSchemas(connId).then(setSchemas).catch(() => setSchemas([]));
  }, [connId]);
  useEffect(() => {
    if (!connId || !schema) return;
    setTable(""); setColumns([]);
    api.listTables(connId, schema).then(setTables).catch(() => setTables([]));
  }, [connId, schema]);
  useEffect(() => {
    if (!connId || !table) return;
    api.listColumns(connId, schema, table).then((cols) => {
      setColumns(cols);
      const emailish = cols.find((c) => c.name.toLowerCase() === "email")
        ?? cols.find((c) => c.name.toLowerCase().includes("mail"));
      if (emailish) setEmailColumn(emailish.name);
    }).catch(() => setColumns([]));
  }, [connId, schema, table]);

  const canRun = connId && table && emailColumn;
  const canCreate = canRun && supabaseUrl.trim() && serviceKey.trim()
    && (passwordMode !== "common" || commonPassword.length >= 6);

  async function run(isDryRun: boolean) {
    setError(""); setDone(null); setProgress(EMPTY); setPreview([]); setErrors([]);
    setDryRun(isDryRun); setRunning(true);
    try {
      await createSupabaseAuthUsers(
        {
          source_conn_id: connId, source_schema: schema, source_table: table,
          email_column: emailColumn, supabase_url: supabaseUrl, service_role_key: serviceKey,
          password_mode: passwordMode, common_password: commonPassword,
          confirm_email: confirmEmail, dry_run: isDryRun,
        },
        (e) => {
          if (e.event === "progress") setProgress(e);
          else if (e.event === "preview") setPreview((p) => (p.length < 200 ? [...p, e] : p));
          else if (e.event === "user_error") setErrors((p) => [...p, { email: e.email, message: e.message }]);
          else if (e.event === "done") setDone(e);
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="w-full space-y-6 py-6">
      <div>
        <h1 className="text-xl font-semibold">Create Supabase Auth users</h1>
        <p className="muted mt-1 text-sm">
          Bulk-create login accounts in Supabase Authentication from any source table, via
          Supabase&rsquo;s Admin API — it generates the id, hashes the password, and confirms the
          email correctly. Do <b>not</b> use the migration &ldquo;push&rdquo; for <code>auth.users</code>.
        </p>
      </div>

      {/* 1. Source */}
      <div className="card card-pad space-y-4">
        <h2 className="font-medium">1. Where are the users?</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Source connection</label>
            <Select className="w-full" value={connId} onValueChange={setConnId}
              placeholder="Choose a database…"
              options={conns.map((c) => ({ value: c.id, label: `${c.name} (${c.flavor})` }))} />
          </div>
          <div>
            <label className="label">Schema / database</label>
            <Select className="w-full" value={schema} onValueChange={setSchema}
              placeholder={connId ? "Choose…" : "—"}
              options={schemas.map((s) => ({ value: s, label: s }))} />
          </div>
          <div>
            <label className="label">Table</label>
            <Select className="w-full" value={table} onValueChange={setTable}
              placeholder={schema ? "Choose…" : "—"}
              options={tables.map((t) => ({ value: t.name, label: t.name }))} />
          </div>
          <div>
            <label className="label">Email column</label>
            <Select className="w-full" value={emailColumn} onValueChange={setEmailColumn}
              placeholder={table ? "Choose…" : "—"}
              options={columns.map((c) => ({ value: c.name, label: c.name }))} />
          </div>
        </div>
      </div>

      {/* 2. Supabase */}
      <div className="card card-pad space-y-4">
        <h2 className="font-medium">2. Your Supabase project</h2>
        <div>
          <label className="label">Project URL</label>
          <input className="input w-full font-mono text-sm" placeholder="https://YOURPROJECT.supabase.co"
            value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value)} />
        </div>
        <div>
          <label className="label">service_role key</label>
          <input className="input w-full font-mono text-sm" type="password"
            placeholder="Settings → API → service_role (secret)"
            value={serviceKey} onChange={(e) => setServiceKey(e.target.value)} />
          <p className="muted mt-1 text-xs">
            Used only for this request, never saved. It bypasses all security — keep it secret.
          </p>
        </div>
      </div>

      {/* 3. Passwords */}
      <div className="card card-pad space-y-4">
        <h2 className="font-medium">3. Passwords</h2>
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <label className="label">Password for each user</label>
            <Select className="w-56" value={passwordMode}
              onValueChange={(v) => setPasswordMode(v as "email_prefix" | "common")}
              options={[
                { value: "email_prefix", label: "From email (abc@x → abc)" },
                { value: "common", label: "One common password" },
              ]} />
          </div>
          {passwordMode === "common" && (
            <div>
              <label className="label">Common password (min 6 chars)</label>
              <input className="input !w-56" type="text" placeholder="e.g. Welcome@123"
                value={commonPassword} onChange={(e) => setCommonPassword(e.target.value)} />
            </div>
          )}
          <label className="flex items-center gap-2 pb-2.5 text-sm">
            <Checkbox checked={confirmEmail} onCheckedChange={setConfirmEmail} />
            Confirm email (allow immediate login)
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-secondary" disabled={!canRun || running} onClick={() => run(true)}>
          Preview (no changes)
        </button>
        <button className="btn btn-primary" disabled={!canCreate || running} onClick={() => run(false)}>
          {running && !dryRun ? "Creating…" : "Create users"}
        </button>
        {running && <span className="muted text-sm">Working… {progress.processed}/{progress.total}</span>}
      </div>

      {error && <p className="alert-danger">{error}</p>}

      {/* Results */}
      {(progress.total > 0 || done) && (
        <div className="card card-pad space-y-3">
          <div className="grid grid-cols-4 gap-3 text-center">
            <Stat label="total" value={progress.total} />
            <Stat label={dryRun ? "would create" : "created"} value={dryRun ? progress.total : progress.created} color="var(--success)" />
            <Stat label="skipped (exist)" value={progress.skipped} color="var(--warning)" />
            <Stat label="failed" value={progress.failed} color="var(--danger)" />
          </div>
          {done && (
            <p className="text-sm">
              {done.event === "done" && done.dry_run
                ? `Preview only — nothing created. ${done.total} users ready. Click “Create users” to proceed.`
                : `Done. Created ${(done as any).created}, skipped ${(done as any).skipped}, failed ${(done as any).failed}.`}
            </p>
          )}
          {dryRun && preview.length > 0 && (
            <div className="max-h-64 overflow-auto rounded border border-[var(--border)] text-xs">
              <table className="w-full">
                <thead><tr className="text-left muted"><th className="p-2">email</th><th className="p-2">password</th></tr></thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} className="border-t border-[var(--border)]"><td className="p-2 font-mono">{p.email}</td><td className="p-2 font-mono">{p.password}</td></tr>
                  ))}
                </tbody>
              </table>
              {progress.total > preview.length && <p className="muted p-2">…and {progress.total - preview.length} more</p>}
            </div>
          )}
          {errors.length > 0 && (
            <div className="max-h-64 overflow-auto rounded border border-[var(--danger)] text-xs">
              {errors.map((e, i) => (
                <p key={i} className="border-t border-[var(--border)] p-2"><b>{e.email}</b>: {e.message}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="muted text-xs">
        Note: for email/password login, Supabase also needs an <code>auth.identities</code> row — the
        Admin API creates it automatically. Re-running is safe: users that already exist are skipped.
      </p>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div className="text-2xl font-bold" style={color ? { color } : undefined}>{value}</div>
      <div className="muted text-xs">{label}</div>
    </div>
  );
}
