"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AlertCondition, AlertResult, AlertRule } from "@/lib/types";
import ConfirmDialog, { type ConfirmState } from "./ConfirmDialog";
import { IconPlus, IconTrash } from "@/components/icons";

const CONDITIONS: { value: AlertCondition; label: string }[] = [
  { value: "rows_gt_zero", label: "returns any rows" },
  { value: "value_gt", label: "first value >" },
  { value: "value_lt", label: "first value <" },
];

// Saved SQL alert rules + on-demand evaluation against the current connection.
export default function AlertsPanel({ connId, schema }: { connId: string; schema: string }) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [results, setResults] = useState<Record<string, AlertResult>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ name: string; sql: string; condition: AlertCondition; threshold: number }>(
    { name: "", sql: "", condition: "rows_gt_zero", threshold: 0 });
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(() => { api.listAlerts().then(setRules).catch((e) => setError(String(e))); }, []);
  useEffect(load, [load]);

  const create = async () => {
    setError("");
    try {
      await api.createAlert(form);
      setAdding(false); setForm({ name: "", sql: "", condition: "rows_gt_zero", threshold: 0 }); load();
    } catch (e) { setError(String(e)); }
  };

  const del = (id: string) => setConfirm({
    title: "Delete alert", message: "Delete this alert rule?", confirmLabel: "Delete", danger: true,
    onConfirm: async () => { await api.deleteAlert(id); load(); },
  });

  const check = async () => {
    setError("");
    try {
      const res = await api.checkAlerts(connId, schema);
      setResults(Object.fromEntries(res.map((r) => [r.rule_id, r])));
    } catch (e) { setError(String(e)); }
  };

  const condLabel = (c: AlertCondition) => CONDITIONS.find((x) => x.value === c)?.label ?? c;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Alerts</h3>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={check} disabled={rules.length === 0}>Check now</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setAdding((a) => !a)}><IconPlus width={13} height={13} /> New alert</button>
        </div>
      </div>
      {error && <p className="alert-danger">{error}</p>}

      {adding && (
        <div className="card card-pad space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="label">Name</label><input className="input !w-52" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Failed orders" /></div>
            <div>
              <label className="label">Fires when the query</label>
              <select className="select !w-48" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value as AlertCondition })}>
                {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            {form.condition !== "rows_gt_zero" && (
              <div><label className="label">Threshold</label><input type="number" className="input !w-28" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} /></div>
            )}
          </div>
          <div>
            <label className="label">SQL (SELECT only)</label>
            <textarea className="input font-mono text-xs" rows={2} value={form.sql} onChange={(e) => setForm({ ...form, sql: e.target.value })}
              placeholder="SELECT * FROM orders WHERE status = 'failed'" />
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={create} disabled={!form.name.trim() || !form.sql.trim()}>Save alert</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {rules.length === 0 ? (
        <p className="text-sm muted">No alerts yet. Create one to watch for failing rows or threshold breaches.</p>
      ) : (
        <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
          {rules.map((r) => {
            const res = results[r.id];
            return (
              <div key={r.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                {res && (
                  <span aria-hidden style={{ color: res.error ? "var(--warning)" : res.triggered ? "var(--danger)" : "var(--success)" }}>
                    {res.error ? "⚠" : res.triggered ? "🔴" : "✓"}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <span className="badge">{condLabel(r.condition)}{r.condition !== "rows_gt_zero" ? ` ${r.threshold}` : ""}</span>
                    {res && !res.error && <span className="text-xs" style={{ color: res.triggered ? "var(--danger)" : "var(--text-muted)" }}>{res.triggered ? "TRIGGERED" : "ok"} · {res.detail}</span>}
                    {res?.error && <span className="text-xs" style={{ color: "var(--warning)" }}>{res.error}</span>}
                  </div>
                  <div className="truncate font-mono text-xs faint">{r.sql}</div>
                </div>
                <button className="btn btn-ghost btn-sm !p-1" onClick={() => del(r.id)} aria-label="Delete alert"><IconTrash width={12} height={12} /></button>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs faint">“Check now” evaluates alerts against this connection. Scheduled delivery (cron + email/Slack) is configured at deploy time.</p>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
