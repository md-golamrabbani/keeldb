"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { autoMap, useWizard } from "@/lib/store";
import SourceTargetPicker from "@/components/SourceTargetPicker";
import MappingCanvas from "@/components/MappingCanvas";
import PreviewPanel from "@/components/PreviewPanel";
import RunPanel from "@/components/RunPanel";
import { IconCheck } from "@/components/icons";

const STEPS = ["Source & Target", "Column Mapping", "Preview & Dry-run", "Run & Report"];

export default function MigratePage() {
  const w = useWizard();
  const [loadingCols, setLoadingCols] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listConnections().then(w.setConnections).catch((e) => setError(String(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickerReady =
    w.source.connId && w.source.schema && w.source.table &&
    w.target.connId && w.target.schema && w.target.table;
  const hasMapping = w.columnMaps.some((m) => m.enabled && m.target_col);

  const goToMapping = async () => {
    setLoadingCols(true);
    setError("");
    try {
      const [sc, tc] = await Promise.all([
        api.listColumns(w.source.connId, w.source.schema, w.source.table),
        api.listColumns(w.target.connId, w.target.schema, w.target.table),
      ]);
      w.setColumns("source", sc);
      w.setColumns("target", tc);
      const matches = w.columnMaps.length > 0 && w.columnMaps.every((m) => sc.some((c) => c.name === m.source_col));
      if (!matches) w.setColumnMaps(autoMap(sc, tc));
      w.setStep(1);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingCols(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Migrate</h1>

      {/* stepper */}
      <div className="flex items-center">
        {STEPS.map((label, i) => {
          const done = i < w.step;
          const active = i === w.step;
          const clickable = i <= w.step && (i !== 1 || w.sourceColumns.length > 0);
          return (
            <div key={label} className="flex flex-1 items-center last:flex-none">
              <button disabled={!clickable} onClick={() => clickable && w.setStep(i)}
                className="flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed">
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors"
                  style={active
                    ? { background: "var(--accent)", color: "var(--accent-fg)" }
                    : done
                      ? { background: "var(--success-soft)", color: "var(--success)" }
                      : { background: "var(--surface-2)", color: "var(--text-faint)" }}>
                  {done ? <IconCheck width={14} height={14} /> : i + 1}
                </span>
                <span style={{ color: active ? "var(--text)" : "var(--text-muted)" }} className="hidden sm:inline">{label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className="mx-3 h-px flex-1" style={{ background: done ? "var(--success)" : "var(--border)" }} />
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="alert-danger">{error}</p>}

      {w.step === 0 && (
        <>
          <SourceTargetPicker />
          <div className="flex justify-end">
            <button className="btn btn-primary" disabled={!pickerReady || loadingCols} onClick={goToMapping}>
              {loadingCols ? "Loading columns…" : "Next: Map columns →"}
            </button>
          </div>
        </>
      )}

      {w.step === 1 && (
        <>
          <MappingCanvas />
          <div className="flex justify-between">
            <button className="btn btn-ghost" onClick={() => w.setStep(0)}>← Back</button>
            <button className="btn btn-primary" disabled={!hasMapping} onClick={() => w.setStep(2)}>Next: Preview →</button>
          </div>
        </>
      )}

      {w.step === 2 && (
        <>
          <PreviewPanel />
          <div className="flex justify-between">
            <button className="btn btn-ghost" onClick={() => w.setStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={() => w.setStep(3)}>Next: Run →</button>
          </div>
        </>
      )}

      {w.step === 3 && (
        <>
          <RunPanel />
          <button className="btn btn-ghost" onClick={() => w.setStep(2)}>← Back</button>
        </>
      )}
    </div>
  );
}
