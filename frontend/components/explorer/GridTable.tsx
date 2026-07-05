"use client";
import { useEffect, useState } from "react";
import type { GridResult } from "@/lib/types";

export default function GridTable({ load, empty }: { load: () => Promise<GridResult>; empty?: string }) {
  const [data, setData] = useState<GridResult | null>(null);
  const [error, setError] = useState("");

  // Run once on mount — `load` closes over stable connId/schema; the component
  // is remounted (via React key) when those change.
  useEffect(() => {
    setError("");
    load().then(setData).catch((e) => setError(String(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="alert-danger">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ background: "var(--surface-2)" }} className="text-left uppercase tracking-wide muted">
            {data.columns.map((c, i) => <th key={i} className="px-3 py-2.5 font-mono normal-case">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, r) => (
            <tr key={r} className="border-t">
              {row.map((cell, c) => (
                <td key={c} className="max-w-[28rem] truncate px-3 py-1.5 font-mono" title={String(cell ?? "")}>
                  {cell == null ? <span className="faint">null</span> : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.rows.length === 0 && <p className="p-8 text-center muted">{empty ?? "Nothing to show."}</p>}
    </div>
  );
}
