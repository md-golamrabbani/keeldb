"use client";
import { useRef, useState } from "react";
import { api, runMigration } from "@/lib/api";
import { buildMapping } from "@/lib/mapping";
import { useWizard } from "@/lib/store";
import type { OutputMode, Report, RollbackSim, RowError } from "@/lib/types";
import { IconCheck, IconDownload, IconFlask, IconLock, IconPlay } from "./icons";

interface Progress { rows_read: number; rows_written: number; rows_skipped: number; rows_errored: number }

const OUTPUTS: { mode: OutputMode; label: string; hint: string }[] = [
  { mode: "push", label: "Push to target DB", hint: "Write rows into the selected target table" },
  { mode: "sql", label: "Download .sql", hint: "INSERT statements (+ optional CREATE TABLE)" },
  { mode: "csv", label: "Download .csv", hint: "Comma-separated, header row" },
  { mode: "json", label: "Download .json", hint: "Array of row objects" },
];

export default function RunPanel() {
  const wizard = useWizard();
  const { outputMode, includeDdl, setGlobals } = wizard;
  const [running, setRunning] = useState(false);
  const [wasDryRun, setWasDryRun] = useState(false);
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress>({ rows_read: 0, rows_written: 0, rows_skipped: 0, rows_errored: 0 });
  const [errors, setErrors] = useState<RowError[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [fatal, setFatal] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [exportUrl, setExportUrl] = useState("");
  const [sim, setSim] = useState<RollbackSim | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [simError, setSimError] = useState("");
  const errorsRef = useRef<RowError[]>([]);

  const isDownload = outputMode !== "push";

  const checkRollback = async () => {
    setSimBusy(true); setSimError(""); setSim(null);
    try {
      setSim(await api.rollbackSimulate(buildMapping(wizard)));
    } catch (e) {
      setSimError(String(e));
    } finally {
      setSimBusy(false);
    }
  };

  const start = async (dryRun: boolean) => {
    setRunning(true);
    setWasDryRun(dryRun);
    setReport(null); setFatal(""); setSourceCount(null); setExportUrl("");
    setProgress({ rows_read: 0, rows_written: 0, rows_skipped: 0, rows_errored: 0 });
    errorsRef.current = []; setErrors([]);
    try {
      await runMigration(buildMapping(wizard), dryRun, (e) => {
        if (e.event === "start") setSourceCount(e.source_count);
        else if (e.event === "progress") setProgress(e);
        else if (e.event === "row_error") {
          if (errorsRef.current.length < 200) {
            errorsRef.current = [...errorsRef.current, e];
            setErrors(errorsRef.current);
          }
        } else if (e.event === "fatal") setFatal(e.message);
        else if (e.event === "done") {
          setReport(e.report);
          if (e.export_id && e.output_mode) setExportUrl(api.exportUrl(e.export_id, e.output_mode));
        }
      });
    } catch (e) {
      setFatal(String(e));
    } finally {
      setRunning(false);
    }
  };

  const saveProfile = async () => {
    try {
      const saved = await api.saveMapping(buildMapping(wizard));
      wizard.setGlobals({ loadedMappingId: saved.id, mappingName: saved.name });
      setSaveMsg(`Saved as "${saved.name}"`);
    } catch (e) {
      setSaveMsg(String(e));
    }
  };

  const pct = sourceCount ? Math.min(100, Math.round((progress.rows_read / sourceCount) * 100)) : 0;
  const reconciled = report && !wasDryRun && outputMode === "push"
    ? report.source_count === report.rows_written + report.rows_skipped + report.rows_errored
    : null;
  const writtenLabel = wasDryRun ? "would write" : isDownload ? "exported" : "written";

  return (
    <div className="space-y-5">
      {/* output destination */}
      <div className="card card-pad space-y-3">
        <div>
          <h3 className="font-semibold">Output destination</h3>
          <p className="text-sm muted">Choose whether to push rows into the target database or download them as a file.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {OUTPUTS.map((o) => (
            <button key={o.mode} onClick={() => setGlobals({ outputMode: o.mode })}
              className="rounded-xl border p-3 text-left transition-colors"
              style={outputMode === o.mode
                ? { borderColor: "var(--accent)", background: "var(--accent-soft)" }
                : { borderColor: "var(--border-strong)" }}>
              <div className="text-sm font-medium" style={outputMode === o.mode ? { color: "var(--accent)" } : undefined}>{o.label}</div>
              <div className="mt-0.5 text-xs faint">{o.hint}</div>
            </button>
          ))}
        </div>
        {outputMode === "sql" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeDdl} onChange={(e) => setGlobals({ includeDdl: e.target.checked })} />
            Include <code>CREATE TABLE</code> from the target schema
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-secondary" onClick={() => start(true)} disabled={running}>
          <IconFlask width={15} height={15} /> Dry run
        </button>
        {outputMode === "push" && (
          <button className="btn btn-secondary" onClick={checkRollback} disabled={running || simBusy}
            title="Pre-flight: can this migration be rolled back, and what could it cost?">
            <IconLock width={14} height={14} /> {simBusy ? "Checking…" : "Rollback check"}
          </button>
        )}
        <button className="btn btn-primary" onClick={() => start(false)} disabled={running}>
          {isDownload ? <IconDownload width={15} height={15} /> : <IconPlay width={13} height={13} />}
          {running ? "Running…" : isDownload ? "Generate export" : "Run migration"}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <input className="input !w-56" placeholder="Mapping profile name"
            value={wizard.mappingName} onChange={(e) => wizard.setGlobals({ mappingName: e.target.value })} />
          <button className="btn btn-secondary" onClick={saveProfile}>Save profile</button>
        </div>
      </div>
      {saveMsg && <p className="text-xs" style={{ color: "var(--success)" }}>{saveMsg}</p>}

      {simError && <p className="alert-danger">{simError}</p>}
      {sim && <RollbackReport sim={sim} />}

      {(running || report) && (
        <div className="card card-pad space-y-4">
          <div className="h-2.5 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
            <div className="h-full transition-all"
              style={{ width: `${report ? 100 : pct}%`, background: report ? (report.ok ? "var(--success)" : "var(--danger)") : "var(--accent)" }} />
          </div>
          <div className="grid grid-cols-4 gap-3 text-center">
            <Stat value={progress.rows_read} label={`read${sourceCount != null ? ` / ${sourceCount.toLocaleString()}` : ""}`} />
            <Stat value={progress.rows_written} label={writtenLabel} color="var(--success)" />
            <Stat value={progress.rows_skipped} label="skipped" color="var(--warning)" />
            <Stat value={progress.rows_errored} label="errored" color="var(--danger)" />
          </div>
        </div>
      )}

      {exportUrl && (
        <a className="btn btn-primary" href={exportUrl} download>
          <IconDownload width={15} height={15} /> Download {outputMode.toUpperCase()} file
        </a>
      )}

      {fatal && <p className="alert-danger">Fatal: {fatal}</p>}

      {report && (
        <div className="card card-pad space-y-3" style={{ borderColor: report.ok ? "var(--success)" : "var(--danger)" }}>
          <h3 className="flex items-center gap-2 font-semibold">
            {report.ok ? <IconCheck width={16} height={16} /> : null}
            {wasDryRun ? "Dry-run report" : isDownload ? "Export report" : "Reconciliation report"}
            {report.ok ? "" : report.aborted ? " · aborted" : " · completed with errors"}
          </h3>
          <table className="text-sm">
            <tbody>
              <Row k={`Source rows${wizard.whereFilter ? " (filtered)" : ""}`} v={report.source_count} />
              <Row k="Read" v={report.rows_read} />
              <Row k={writtenLabel[0].toUpperCase() + writtenLabel.slice(1)} v={report.rows_written} />
              {outputMode === "push" && <Row k="Skipped (conflicts)" v={report.rows_skipped} />}
              <Row k="Errored" v={report.rows_errored} />
              {outputMode === "push" && report.target_count_after != null && <Row k="Target rows after" v={report.target_count_after} />}
              {reconciled != null && (
                <tr>
                  <td className="pr-8 muted">Reconciled</td>
                  <td>{reconciled ? "yes — source == written + skipped + errored" : "NO — counts do not add up"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {errors.length > 0 && (
        <div className="card max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0" style={{ background: "var(--surface-2)" }}>
              <tr className="text-left uppercase tracking-wide muted">
                <th className="px-3 py-2.5">Row</th><th className="px-3 py-2.5">Column</th><th className="px-3 py-2.5">Error</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-1.5 faint">{e.row_index}</td>
                  <td className="px-3 py-1.5 font-mono">{e.column}</td>
                  <td className="px-3 py-1.5" style={{ color: "var(--danger)" }}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ROLLBACK_TONE: Record<RollbackSim["rollback"], { color: string; soft: string; label: string }> = {
  clean: { color: "var(--success)", soft: "var(--success-soft)", label: "Cleanly reversible" },
  partial: { color: "var(--warning)", soft: "var(--warning-soft)", label: "Partially reversible" },
  lossy: { color: "var(--danger)", soft: "var(--danger-soft)", label: "Not cleanly reversible" },
};

function Badge({ label, tone }: { label: string; tone: string }) {
  return <span className="rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
    style={{ background: `color-mix(in srgb, ${tone} 15%, transparent)`, color: tone }}>{label}</span>;
}

function RollbackReport({ sim }: { sim: RollbackSim }) {
  const t = ROLLBACK_TONE[sim.rollback];
  const lossTone = sim.data_loss_risk === "high" ? "var(--danger)" : sim.data_loss_risk === "low" ? "var(--warning)" : "var(--success)";
  const lockTone = sim.lock_risk === "high" ? "var(--danger)" : sim.lock_risk === "moderate" ? "var(--warning)" : "var(--success)";
  return (
    <div className="card card-pad space-y-3" style={{ borderColor: t.color }}>
      <div className="flex flex-wrap items-center gap-2">
        <IconLock width={16} height={16} />
        <h3 className="font-semibold">Rollback simulation</h3>
        <span className="rounded-md px-2 py-0.5 text-sm font-semibold" style={{ background: t.soft, color: t.color }}>{t.label}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge label={`Data loss: ${sim.data_loss_risk}`} tone={lossTone} />
        <Badge label={`Lock risk: ${sim.lock_risk}`} tone={lockTone} />
        <Badge label={`${sim.source_rows.toLocaleString()} rows in`} tone="var(--accent)" />
        {sim.max_overwrites > 0 && <Badge label={`≤ ${sim.max_overwrites.toLocaleString()} overwritten`} tone="var(--danger)" />}
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm muted">
        {sim.plan.map((step, i) => <li key={i}>{step}</li>)}
      </ul>
      <p className="text-sm font-medium" style={{ color: t.color }}>{sim.recommendation}</p>
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold" style={color ? { color } : undefined}>{value.toLocaleString()}</div>
      <div className="text-xs muted">{label}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: number }) {
  return (
    <tr>
      <td className="pr-8 muted">{k}</td>
      <td className="font-medium">{v.toLocaleString()}</td>
    </tr>
  );
}
