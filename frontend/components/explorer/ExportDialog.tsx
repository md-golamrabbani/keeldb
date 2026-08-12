"use client";
import { useState } from "react";
import Modal from "./Modal";
import Select from "@/components/ui/Select";
import { exportDatabaseStream, type ExportEvent } from "@/lib/api";
import { downloadFile } from "@/lib/toast";

// Export a database (or a chosen set of tables) to a .sql file, streaming
// table-by-table so a real progress bar can advance.
const MODES = [
  { value: "structure_data", label: "Structure and data" },
  { value: "structure", label: "Structure only" },
  { value: "data", label: "Data only" },
];

export default function ExportDialog({ connId, schema, tables = null, onClose }: {
  connId: string; schema: string; tables?: string[] | null; onClose: () => void;
}) {
  const [mode, setMode] = useState("structure_data");
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number; table: string }>({ done: 0, total: 0, table: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ tables: number; rows: number } | null>(null);

  const scope = tables && tables.length ? `${tables.length} selected table(s)` : "the whole database";

  const start = async () => {
    setBusy(true); setError(""); setDone(null); setProg({ done: 0, total: 0, table: "" });
    const chunks: string[] = [];
    let fatal = "";
    try {
      await exportDatabaseStream(connId,
        { schema_name: schema, tables, include_ddl: mode !== "data", include_data: mode !== "structure" },
        (e: ExportEvent) => {
          if (e.type === "start") setProg({ done: 0, total: e.total, table: "" });
          else if (e.type === "table") { chunks.push(e.sql); setProg({ done: e.index, total: e.total, table: e.table }); }
          else if (e.type === "done") setDone({ tables: e.tables, rows: e.rows });
          else if (e.type === "fatal") fatal = e.message;
        });
      if (fatal) { setError(fatal); return; }
      const header = `-- KeelDB export — ${schema || "database"}\n\n`;
      downloadFile(header + chunks.join("\n"), `${schema || "database"}.sql`, "application/sql");
    } catch (e) { setError(String(e).replace(/^Error:\s*/, "")); } finally { setBusy(false); }
  };

  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  return (
    <Modal title="Export database" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm muted">Exporting {scope} as a <code>.sql</code> file.</p>
        <div>
          <label className="label">Content</label>
          <Select className="w-full" ariaLabel="Export content" value={mode} onValueChange={setMode} options={MODES} />
        </div>

        {(busy || done) && (
          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${done ? 100 : pct}%`, background: "var(--accent)" }} />
            </div>
            <p className="text-xs muted">
              {done
                ? `Done — ${done.tables} table(s), ${done.rows} row(s). Download starting…`
                : `Exporting ${prog.done}/${prog.total}${prog.table ? ` — ${prog.table}` : ""}…`}
            </p>
          </div>
        )}
        {error && <p className="alert-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{done ? "Close" : "Cancel"}</button>
          <button className="btn btn-primary" onClick={start} disabled={busy}>
            {busy ? "Exporting…" : done ? "Export again" : "Start export"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
