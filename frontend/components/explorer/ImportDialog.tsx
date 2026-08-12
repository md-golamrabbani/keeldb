"use client";
import { useRef, useState } from "react";
import Modal from "./Modal";
import Checkbox from "@/components/ui/Checkbox";
import { importSqlStream, type ImportEvent } from "@/lib/api";
import { IconTable } from "@/components/icons";

// Import (run) a .sql script against the current database, streaming
// per-statement progress. Best-effort by default; optionally stop on first error.
export default function ImportDialog({ connId, schema, onClose, onDone }: {
  connId: string; schema: string; onClose: () => void; onDone?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [stopOnError, setStopOnError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [errors, setErrors] = useState<{ statement: string; message: string }[]>([]);
  const [summary, setSummary] = useState<{ executed: number; failed: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true); setError(""); setErrors([]); setSummary(null); setProg({ done: 0, total: 0 });
    const errs: { statement: string; message: string }[] = [];
    let fatal = "";
    try {
      const sql = await file.text();
      await importSqlStream(connId, { schema_name: schema, sql, stop_on_error: stopOnError }, (e: ImportEvent) => {
        if (e.type === "start") setProg({ done: 0, total: e.total });
        else if (e.type === "progress") setProg({ done: e.done, total: e.total });
        else if (e.type === "error") { setProg({ done: e.done, total: e.total }); errs.push({ statement: e.statement, message: e.message }); }
        else if (e.type === "done") setSummary({ executed: e.executed, failed: e.failed, total: e.total });
        else if (e.type === "fatal") fatal = e.message;
      });
      if (fatal) setError(fatal);
      setErrors(errs);
      if (!fatal) onDone?.();
    } catch (e) { setError(String(e).replace(/^Error:\s*/, "")); } finally { setBusy(false); }
  };

  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  return (
    <Modal title="Import .sql" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm muted">
          Run a <code>.sql</code> script against <strong>{schema || "this connection"}</strong> (e.g. a KeelDB export).
        </p>

        <div>
          <label className="label">SQL file</label>
          <input ref={inputRef} type="file" accept=".sql,text/plain" className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSummary(null); setErrors([]); }} />
          <button className="btn btn-secondary w-full justify-start gap-2" onClick={() => inputRef.current?.click()} disabled={busy}>
            <IconTable width={14} height={14} /> {file ? file.name : "Choose a .sql file…"}
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={stopOnError} onCheckedChange={setStopOnError} /> Stop on first error
        </label>

        {(busy || summary) && (
          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${summary ? 100 : pct}%`, background: summary && summary.failed ? "var(--warning)" : "var(--accent)" }} />
            </div>
            <p className="text-xs muted">
              {summary
                ? `Done — ${summary.executed} run, ${summary.failed} failed of ${summary.total}.`
                : `Running ${prog.done}/${prog.total}…`}
            </p>
          </div>
        )}

        {errors.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-lg border p-2 text-xs" style={{ borderColor: "var(--border)" }}>
            {errors.slice(0, 50).map((er, i) => (
              <div key={i} className="border-b py-1 last:border-0" style={{ borderColor: "var(--border)" }}>
                <span style={{ color: "var(--danger)" }}>{er.message}</span>
                <div className="truncate font-mono faint">{er.statement}</div>
              </div>
            ))}
          </div>
        )}
        {error && <p className="alert-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{summary ? "Close" : "Cancel"}</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || !file}>{busy ? "Importing…" : "Run import"}</button>
        </div>
      </div>
    </Modal>
  );
}
