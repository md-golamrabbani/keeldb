"use client";
import { useEffect, useRef, useState } from "react";
import { runProject } from "@/lib/api";
import Modal from "@/components/explorer/Modal";
import { IconFlask, IconPlay } from "@/components/icons";

interface TableState { table: string; written: number; skipped: number; errored: number; status: "pending" | "running" | "done" | "error" }

export default function ProjectRunPanel({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const [running, setRunning] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, TableState>>({});
  const [totals, setTotals] = useState<{ rows_written: number; rows_skipped: number; rows_errored: number } | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [fatal, setFatal] = useState("");
  const [wasDry, setWasDry] = useState(false);
  const rowsRef = useRef<Record<string, TableState>>({});

  const set = (table: string, patch: Partial<TableState>) => {
    rowsRef.current = { ...rowsRef.current, [table]: { ...(rowsRef.current[table] ?? { table, written: 0, skipped: 0, errored: 0, status: "pending" }), ...patch } };
    setRows(rowsRef.current);
  };

  const start = async (dryRun: boolean) => {
    setRunning(true); setWasDry(dryRun); setOrder([]); setTotals(null); setOk(null); setFatal("");
    rowsRef.current = {}; setRows({});
    try {
      await runProject(projectId, dryRun, (e) => {
        if (e.event === "project_start") {
          setOrder(e.order);
          e.order.forEach((t) => set(t, { table: t, status: "pending" }));
        } else if (e.event === "table_start") set(e.table, { status: "running" });
        else if (e.event === "progress") set(e.table, { written: e.rows_written, skipped: e.rows_skipped, errored: e.rows_errored });
        else if (e.event === "done") set(e.table, { status: e.report.ok ? "done" : "error", written: e.report.rows_written, skipped: e.report.rows_skipped, errored: e.report.rows_errored });
        else if (e.event === "project_done") { setTotals(e.totals); setOk(e.ok); }
        else if (e.event === "fatal") setFatal(e.message + (e.table ? ` (${e.table})` : ""));
      });
    } catch (err) { setFatal(String(err)); } finally { setRunning(false); }
  };

  useEffect(() => { start(true); /* auto dry-run on open */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusBadge = (s: TableState["status"]) => {
    const map = { pending: ["", "queued"], running: ["badge-warning", "running…"], done: ["badge-success", "done"], error: ["badge-danger", "failed"] } as const;
    const [cls, label] = map[s];
    return <span className={`badge ${cls}`}>{label}</span>;
  };

  return (
    <Modal title={`Run project · ${projectName}`} wide onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => start(true)} disabled={running}><IconFlask width={14} height={14} /> Dry run</button>
          <button className="btn btn-primary btn-sm" onClick={() => start(false)} disabled={running}><IconPlay width={12} height={12} /> {running ? "Running…" : "Run all"}</button>
          {order.length > 0 && <span className="ml-2 text-xs muted">Order (FK parents first): {order.join(" → ")}</span>}
        </div>

        {fatal && <p className="alert-danger">{fatal}</p>}

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--surface-2)" }} className="text-left text-xs uppercase tracking-wide muted">
                <th className="px-3 py-2">Table</th><th className="px-3 py-2 text-right">{wasDry ? "Would write" : "Written"}</th>
                <th className="px-3 py-2 text-right">Skipped</th><th className="px-3 py-2 text-right">Errored</th><th className="px-3 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {(order.length ? order : Object.keys(rows)).map((t) => {
                const r = rows[t] ?? { table: t, written: 0, skipped: 0, errored: 0, status: "pending" as const };
                return (
                  <tr key={t} className="border-t">
                    <td className="px-3 py-1.5 font-mono">{t}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: "var(--success)" }}>{r.written.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: "var(--warning)" }}>{r.skipped.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: r.errored ? "var(--danger)" : undefined }}>{r.errored.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right">{statusBadge(r.status)}</td>
                  </tr>
                );
              })}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="border-t font-semibold" style={{ background: "var(--surface-2)" }}>
                  <td className="px-3 py-2">Total {ok ? "✅" : "⚠️"}</td>
                  <td className="px-3 py-2 text-right">{totals.rows_written.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{totals.rows_skipped.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{totals.rows_errored.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{wasDry ? "dry run" : ok ? "success" : "with errors"}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="text-xs faint">A dry run reads + transforms every row and reports counts without writing. Tables run parents-first so foreign keys resolve.</p>
      </div>
    </Modal>
  );
}
