"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Environment, WritePreview } from "@/lib/types";
import type { StmtInfo } from "@/lib/sqlguard";
import Modal from "./Modal";

// Shown before any write statement runs from the SQL editor. Fetches the exact
// affected-row count (rolled-back dry run) and, for dangerous/prod writes,
// requires the user to type CONFIRM.
export default function GuardDialog({
  connId, schema, sql, statements, environment, onConfirm, onClose,
}: {
  connId: string;
  schema: string;
  sql: string;
  statements: StmtInfo[];
  environment: Environment;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<WritePreview | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    api.previewWrite(connId, sql, schema).then(setPreview).catch(() => setPreview({ ok: false, error: "preview unavailable" }));
  }, [connId, schema, sql]);

  const isProd = environment === "prod";
  const anyDangerous = statements.some((s) => s.dangerous);
  const needsType = anyDangerous || isProd;
  const canRun = !needsType || typed.trim().toUpperCase() === "CONFIRM";
  const affectedFor = (i: number) => preview?.previews?.[i];

  return (
    <Modal title="Review write before running" wide onClose={onClose}>
      <div className="space-y-4">
        {isProd && (
          <p className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
            ⚠ This is a PRODUCTION connection.
          </p>
        )}

        <div className="card overflow-hidden">
          {statements.map((s, i) => {
            const p = affectedFor(i);
            return (
              <div key={i} className="border-b px-4 py-2.5 text-sm last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="badge" style={s.dangerous ? { background: "var(--danger-soft)", color: "var(--danger)" } : { background: "var(--accent-soft)", color: "var(--accent)" }}>{s.kind}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={s.sql}>{s.sql}</span>
                  {s.isWrite && (
                    <span className="shrink-0 text-xs" style={{ color: s.dangerous ? "var(--danger)" : "var(--text-muted)" }}>
                      {p == null ? "…" : p.previewable ? `${(p.affected ?? 0).toLocaleString()} row(s)` : "not estimable"}
                    </span>
                  )}
                </div>
                {s.reason && <p className="mt-1 text-xs" style={{ color: "var(--danger)" }}>⚠ {s.reason}</p>}
              </div>
            );
          })}
        </div>

        {preview && !preview.ok && (
          <p className="text-xs" style={{ color: "var(--warning)" }}>Couldn’t estimate affected rows: {preview.error}. It will still run inside a transaction.</p>
        )}
        <p className="text-xs faint">Affected-row counts are from a dry run that is rolled back — nothing has changed yet.</p>

        {needsType && (
          <div>
            <label className="label">Type <b>CONFIRM</b> to proceed{isProd ? " on production" : ""}</label>
            <input autoFocus className="input" value={typed} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canRun) onConfirm(); }} placeholder="CONFIRM" />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className={anyDangerous || isProd ? "btn btn-danger" : "btn btn-primary"} disabled={!canRun} onClick={onConfirm}>
            Run {statements.filter((s) => s.isWrite).length} write statement(s)
          </button>
        </div>
      </div>
    </Modal>
  );
}
