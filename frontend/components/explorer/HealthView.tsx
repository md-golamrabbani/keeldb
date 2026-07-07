"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { HealthReport, IndexAdvice } from "@/lib/types";
import { IconRefresh } from "@/components/icons";

function fmtBytes(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

// Database health: storage & size overview, top tables by size (or rows).
export default function HealthView({ connId, schema }: { connId: string; schema: string }) {
  const [rep, setRep] = useState<HealthReport | null>(null);
  const [advice, setAdvice] = useState<IndexAdvice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.health(connId, schema).then(setRep).catch((e) => setError(String(e))).finally(() => setLoading(false));
    api.indexAdvice(connId, schema).then(setAdvice).catch(() => setAdvice(null));
  }, [connId, schema]);
  useEffect(load, [load]);

  const bySize = !!rep && rep.tables.some((t) => t.size_bytes !== null);
  const maxMetric = rep ? Math.max(1, ...rep.tables.map((t) => (bySize ? t.size_bytes ?? 0 : t.rows))) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Database health</h3>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          <IconRefresh width={13} height={13} /> {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <p className="alert-danger">{error}</p>}

      {rep && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Tables" value={rep.overview.table_count.toLocaleString()} />
            <Stat label="Total rows" value={rep.overview.total_rows.toLocaleString()} />
            <Stat label="Total size" value={fmtBytes(rep.overview.total_size_bytes)} />
          </div>

          {!bySize && (
            <p className="text-xs muted">
              {rep.dialect === "sqlite" ? "SQLite reports no per-table byte size — showing live row counts." : ""}
            </p>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--surface-2)" }} className="text-left text-xs uppercase tracking-wide muted">
                  <th className="px-3 py-2">Table</th>
                  <th className="px-3 py-2 w-1/2">{bySize ? "Size" : "Rows"}</th>
                  <th className="px-3 py-2 text-right">Rows</th>
                  {bySize && <th className="px-3 py-2 text-right">Size</th>}
                  {bySize && <th className="px-3 py-2 text-right">Indexes</th>}
                </tr>
              </thead>
              <tbody>
                {rep.tables.map((t) => {
                  const metric = bySize ? t.size_bytes ?? 0 : t.rows;
                  return (
                    <tr key={t.name} className="border-t">
                      <td className="px-3 py-1.5 font-mono font-medium">{t.name}</td>
                      <td className="px-3 py-1.5">
                        <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                          <div className="h-full" style={{ width: `${(metric / maxMetric) * 100}%`, background: "var(--accent)" }} />
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{t.rows.toLocaleString()}</td>
                      {bySize && <td className="px-3 py-1.5 text-right font-mono">{fmtBytes(t.size_bytes)}</td>}
                      {bySize && <td className="px-3 py-1.5 text-right font-mono faint">{fmtBytes(t.index_bytes)}</td>}
                    </tr>
                  );
                })}
                {rep.tables.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center muted">No tables.</td></tr>}
              </tbody>
            </table>
          </div>

          {advice && (
            <div className="space-y-2">
              <h3 className="font-semibold">Index advisor</h3>
              {advice.findings.length === 0 ? (
                <div className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
                  ✅ No index or primary-key issues found.
                </div>
              ) : (
                <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
                  {advice.findings.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
                      <span aria-hidden style={{ color: f.level === "warn" ? "var(--warning)" : "var(--text-muted)" }}>
                        {f.level === "warn" ? "⚠" : "•"}
                      </span>
                      <span className="badge">{f.kind.replace(/_/g, " ")}</span>
                      <span className="font-mono text-xs muted">{f.table}</span>
                      <span className="flex-1">{f.message}</span>
                    </div>
                  ))}
                </div>
              )}
              {!advice.usage_available && (
                <p className="text-xs faint">Unused-index detection needs query statistics — available on PostgreSQL and MySQL.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card card-pad">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs muted">{label}</div>
    </div>
  );
}
