"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { OrphanResult } from "@/lib/types";
import Modal from "./Modal";
import { IconRefresh } from "@/components/icons";

// Post-migration integrity: scan every FK in the schema for orphaned rows
// (a child row whose foreign-key value has no matching parent).
export default function IntegrityModal({ connId, schema, onClose }: { connId: string; schema: string; onClose: () => void }) {
  const [res, setRes] = useState<OrphanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const scan = () => {
    setLoading(true); setError("");
    api.orphanScan(connId, schema).then(setRes).catch((e) => setError(String(e))).finally(() => setLoading(false));
  };
  useEffect(scan, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title="Foreign-key integrity" wide onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm muted">Rows whose foreign key points to a non-existent parent — a classic post-migration break.</p>
          <button className="btn btn-secondary btn-sm" onClick={scan} disabled={loading}><IconRefresh width={13} height={13} /> {loading ? "Scanning…" : "Re-scan"}</button>
        </div>

        {error && <p className="alert-danger">{error}</p>}

        {res && (
          <>
            <div className="rounded-lg px-3 py-2 text-sm font-semibold"
              style={res.total_orphans === 0
                ? { background: "var(--success-soft)", color: "var(--success)" }
                : { background: "var(--danger-soft)", color: "var(--danger)" }}>
              {res.total_orphans === 0
                ? `✅ No orphaned rows across ${res.scanned} table(s).`
                : `⚠ ${res.total_orphans.toLocaleString()} orphaned row(s) found.`}
            </div>

            {res.tables.length === 0 ? (
              <p className="text-sm muted">No foreign keys defined in this schema — nothing to check.</p>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--surface-2)" }} className="text-left text-xs uppercase tracking-wide muted">
                      <th className="px-3 py-2">Table</th><th className="px-3 py-2">Foreign key</th>
                      <th className="px-3 py-2">References</th><th className="px-3 py-2 text-right">Orphans</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.tables.flatMap((t) => t.checks.map((chk, i) => (
                      <tr key={`${t.table}-${i}`} className="border-t">
                        <td className="px-3 py-1.5 font-mono">{i === 0 ? t.table : ""}</td>
                        <td className="px-3 py-1.5 font-mono">{chk.columns.join(", ")}</td>
                        <td className="px-3 py-1.5 font-mono muted">{chk.ref_table}({chk.ref_columns.join(", ")})</td>
                        <td className="px-3 py-1.5 text-right font-semibold"
                          style={{ color: chk.error ? "var(--warning)" : (chk.orphans ?? 0) > 0 ? "var(--danger)" : "var(--success)" }}>
                          {chk.error ? "error" : (chk.orphans ?? 0).toLocaleString()}
                        </td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
