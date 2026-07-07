"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DependentsResult } from "@/lib/types";
import Modal from "./Modal";

// Reverse-FK: everything that references one row. "View" jumps to the child
// table filtered on the referencing column (delete/cascade-impact view).
export default function DependentsDialog({ connId, schema, table, pk, onClose, onOpenReference }: {
  connId: string; schema: string; table: string;
  pk: Record<string, string | number | boolean | null>;
  onClose: () => void;
  onOpenReference: (table: string, column: string, value: string) => void;
}) {
  const [res, setRes] = useState<DependentsResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.dependents(connId, schema, table, pk).then(setRes).catch((e) => setError(String(e)));
  }, [connId, schema, table]); // eslint-disable-line react-hooks/exhaustive-deps

  const pkLabel = Object.entries(pk).map(([k, v]) => `${k}=${v}`).join(", ");

  return (
    <Modal title="Rows that reference this row" wide onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm muted">
          <span className="font-mono">{schema}.{table}</span> where <span className="font-mono">{pkLabel}</span>
        </p>
        {error && <p className="alert-danger">{error}</p>}

        {res && !res.found && <p className="alert-danger">That row no longer exists.</p>}

        {res && res.found && (
          <>
            <div className="rounded-lg px-3 py-2 text-sm font-semibold"
              style={res.total_dependents === 0
                ? { background: "var(--success-soft)", color: "var(--success)" }
                : { background: "var(--warning-soft)", color: "var(--warning)" }}>
              {res.total_dependents === 0
                ? "✅ Nothing references this row — safe to delete."
                : `⚠ ${res.total_dependents.toLocaleString()} row(s) across ${res.referencing_tables} table(s) reference this row.`}
            </div>

            {res.dependents.filter((g) => g.count > 0).map((g, i) => {
              const cols = g.sample.length ? Object.keys(g.sample[0]) : [];
              const refValue = String(res.pk[g.ref_columns[0]] ?? "");
              return (
                <div key={i} className="card overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 text-sm" style={{ background: "var(--surface-2)" }}>
                    <span className="font-mono font-semibold">{g.table}</span>
                    <span className="muted">via {g.columns.join(", ")}</span>
                    {g.on_delete && <span className="badge badge-accent">ON DELETE {g.on_delete}</span>}
                    <span className="ml-auto font-semibold" style={{ color: "var(--warning)" }}>{g.count.toLocaleString()} row(s)</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => onOpenReference(g.table, g.columns[0], refValue)}>View all</button>
                  </div>
                  {cols.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left uppercase tracking-wide muted">
                            {cols.map((c) => <th key={c} className="px-3 py-1.5 font-mono normal-case">{c}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {g.sample.map((row, ri) => (
                            <tr key={ri} className="border-t">
                              {cols.map((c) => (
                                <td key={c} className="px-3 py-1 font-mono">
                                  {row[c] === null ? <span className="faint">null</span> : String(row[c])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {g.count > g.sample.length && <p className="px-3 py-1.5 text-xs muted">…and {(g.count - g.sample.length).toLocaleString()} more.</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </Modal>
  );
}
