"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { buildMapping } from "@/lib/mapping";
import { useWizard } from "@/lib/store";
import type { TransformedPreviewRow } from "@/lib/types";
import { IconRefresh } from "./icons";

export default function PreviewPanel() {
  const wizard = useWizard();
  const [rows, setRows] = useState<TransformedPreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    api.previewTransformed(buildMapping(wizard), 20)
      .then(setRows)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = rows.length > 0
    ? Object.keys(rows[0].data)
    : wizard.columnMaps.filter((m) => m.enabled && m.target_col).map((m) => m.target_col);
  const errorCount = rows.filter((r) => r.errors.length).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm muted">
          First {rows.length || 20} rows exactly as they will be written (after cast / transform / default).
          {errorCount > 0 && <span style={{ color: "var(--danger)" }}> · {errorCount} with errors</span>}
        </p>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          <IconRefresh width={14} height={14} /> {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error && <p className="alert-danger">{error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "var(--surface-2)" }} className="text-left uppercase tracking-wide muted">
              <th className="px-3 py-2.5">#</th>
              {cols.map((c) => <th key={c} className="px-3 py-2.5 font-mono normal-case">{c}</th>)}
              <th className="px-3 py-2.5">Errors</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row_index} className="border-t" style={r.errors.length ? { background: "var(--danger-soft)" } : undefined}>
                <td className="px-3 py-1.5 faint">{r.row_index}</td>
                {cols.map((c) => (
                  <td key={c} className="max-w-[12rem] truncate px-3 py-1.5 font-mono" title={String(r.data[c] ?? "")}>
                    {r.data[c] == null ? <span className="faint">null</span> : String(r.data[c])}
                  </td>
                ))}
                <td className="px-3 py-1.5" style={{ color: "var(--danger)" }}>
                  {r.errors.map((e, i) => <div key={i}>{e.column}: {e.message}</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !loading && !error && <p className="p-8 text-center muted">No rows.</p>}
      </div>
    </div>
  );
}
