"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ColumnInfo, DuplicateResult } from "@/lib/types";
import { IconSearch } from "@/components/icons";
import Checkbox from "@/components/ui/Checkbox";

// Find rows sharing the same value(s) in a chosen set of columns. "View rows"
// drills into the Data grid filtered on the group's first column.
export default function DuplicatesView({ connId, schema, table, onViewRows }: {
  connId: string; schema: string; table: string;
  onViewRows: (column: string, value: string | null) => void;
}) {
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [res, setRes] = useState<DuplicateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listColumns(connId, schema, table).then((cs) => {
      setColumns(cs);
      // Sensible default: a likely identity column (email / phone / *_id / name).
      const guess = cs.find((c) => /email|phone|mobile|ssn|sku|code|name/i.test(c.name));
      setPicked(guess ? [guess.name] : cs[0] ? [cs[0].name] : []);
    }).catch((e) => setError(String(e)));
    setRes(null);
  }, [connId, schema, table]);

  const toggle = (name: string) =>
    setPicked((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]));

  const run = () => {
    if (!picked.length) return;
    setBusy(true); setError(""); setRes(null);
    api.findDuplicates(connId, schema, table, picked)
      .then(setRes).catch((e) => setError(String(e))).finally(() => setBusy(false));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm muted">Match on one or more columns to find rows that repeat the same value(s).</p>

      <div className="card card-pad space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {columns.map((c) => (
            <label key={c.name} className="flex items-center gap-2 text-sm">
              <Checkbox checked={picked.includes(c.name)} onCheckedChange={() => toggle(c.name)} />
              <span className="font-mono">{c.name}</span>
              <span className="text-xs faint">{c.data_type}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary btn-sm" onClick={run} disabled={busy || !picked.length}>
            <IconSearch width={14} height={14} /> {busy ? "Scanning…" : "Find duplicates"}
          </button>
          {picked.length > 0 && <span className="text-xs muted">matching on <b>{picked.join(" + ")}</b></span>}
        </div>
      </div>

      {error && <p className="alert-danger">{error}</p>}

      {res && (
        <>
          <div className="rounded-lg px-3 py-2 text-sm font-semibold"
            style={res.group_count === 0
              ? { background: "var(--success-soft)", color: "var(--success)" }
              : { background: "var(--warning-soft)", color: "var(--warning)" }}>
            {res.group_count === 0
              ? "✅ No duplicates for these columns."
              : `${res.group_count.toLocaleString()} duplicate group(s) · ${res.redundant_rows.toLocaleString()} redundant row(s)`}
          </div>

          {res.groups.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--surface-2)" }} className="text-left text-xs uppercase tracking-wide muted">
                    {res.columns.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}
                    <th className="px-3 py-2 text-right">Count</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {res.groups.map((g, i) => (
                    <tr key={i} className="border-t">
                      {res.columns.map((c) => (
                        <td key={c} className="px-3 py-1.5 font-mono">
                          {g.values[c] === null ? <span className="faint">NULL</span> : String(g.values[c])}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-semibold" style={{ color: "var(--warning)" }}>{g.count}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => {
                            const v = g.values[res.columns[0]];
                            onViewRows(res.columns[0], v === null ? null : String(v));
                          }}>
                          View rows
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {res.truncated && <p className="text-xs muted">Showing the top {res.groups.length} groups by count.</p>}
        </>
      )}
    </div>
  );
}
