"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ColumnProfile, TableProfile } from "@/lib/types";
import { IconRefresh } from "@/components/icons";

const KIND_TONE: Record<ColumnProfile["kind"], string> = {
  numeric: "var(--accent)", datetime: "var(--warning)", text: "var(--text-muted)",
  bool: "var(--success)", other: "var(--text-faint)",
};

function trunc(v: string | number | boolean | null): string {
  if (v === null) return "—";
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

// One-click column-level summary: nulls, distinct, min/max, detected patterns.
export default function ProfileView({ connId, schema, table }: { connId: string; schema: string; table: string }) {
  const [res, setRes] = useState<TableProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = () => {
    setLoading(true); setError("");
    api.profile(connId, schema, table).then(setRes).catch((e) => setError(String(e))).finally(() => setLoading(false));
  };
  useEffect(run, [connId, schema, table]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm muted">
          {res ? <>Profiled <b>{res.total_rows.toLocaleString()}</b> rows across {res.columns.length} columns.</> : "Column-level statistics for this table."}
        </p>
        <button className="btn btn-secondary btn-sm" onClick={run} disabled={loading}>
          <IconRefresh width={13} height={13} /> {loading ? "Profiling…" : "Re-profile"}
        </button>
      </div>

      {error && <p className="alert-danger">{error}</p>}

      {res && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--surface-2)" }} className="text-left text-xs uppercase tracking-wide muted">
                <th className="px-3 py-2">Column</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Nulls</th>
                <th className="px-3 py-2">Distinct</th>
                <th className="px-3 py-2">Min</th>
                <th className="px-3 py-2">Max</th>
                <th className="px-3 py-2">Avg</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {res.columns.map((c) => (
                <tr key={c.name} className="border-t align-top">
                  <td className="px-3 py-1.5 font-mono font-medium">{c.name}</td>
                  <td className="px-3 py-1.5 font-mono text-xs" style={{ color: KIND_TONE[c.kind] }}>{c.type}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-14 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                        <div className="h-full" style={{ width: `${c.null_pct}%`, background: c.null_pct > 50 ? "var(--danger)" : c.null_pct > 0 ? "var(--warning)" : "var(--success)" }} />
                      </div>
                      <span className="text-xs muted">{c.null_count.toLocaleString()} · {c.null_pct}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-xs">{c.distinct.toLocaleString()} <span className="faint">({c.distinct_pct}%)</span></td>
                  <td className="px-3 py-1.5 font-mono text-xs">{trunc(c.min)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{trunc(c.max)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{c.avg === null ? "—" : c.avg.toLocaleString()}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {c.unique && <span className="badge badge-warning">unique</span>}
                      {c.null_count === 0 && res.total_rows > 0 && <span className="badge">no nulls</span>}
                      {c.pattern && <span className="badge badge-accent">{c.pattern} {Math.round(c.pattern_pct * 100)}%</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
