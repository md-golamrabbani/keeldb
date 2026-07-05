"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWizard, type EndpointSel } from "@/lib/store";
import type { TableInfo } from "@/lib/types";
import { IconArrows, IconDatabase, IconFile } from "./icons";

function EndpointPanel({
  title,
  sel,
  onChange,
}: {
  title: string;
  sel: EndpointSel;
  onChange: (patch: Partial<EndpointSel>) => void;
}) {
  const connections = useWizard((s) => s.connections);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [error, setError] = useState("");
  const conn = connections.find((c) => c.id === sel.connId);

  useEffect(() => {
    setSchemas([]);
    setError("");
    if (!sel.connId) return;
    api.listSchemas(sel.connId)
      .then((s) => {
        setSchemas(s);
        if (s.length === 1 && !sel.schema) onChange({ schema: s[0], table: "" });
      })
      .catch((e) => setError(String(e)));
  }, [sel.connId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setTables([]);
    if (!sel.connId || !sel.schema) return;
    api.listTables(sel.connId, sel.schema).then(setTables).catch((e) => setError(String(e)));
  }, [sel.connId, sel.schema]);

  const rowEstimate = tables.find((t) => t.name === sel.table)?.row_estimate;

  return (
    <div className="card card-pad flex-1 space-y-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
          {conn?.flavor === "sqlfile" ? <IconFile width={15} height={15} /> : <IconDatabase width={15} height={15} />}
        </span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div>
        <label className="label">Connection</label>
        <select className="select" value={sel.connId}
          onChange={(e) => onChange({ connId: e.target.value, schema: "", table: "" })}>
          <option value="">— select —</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.flavor})</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Schema</label>
        <select className="select" value={sel.schema} disabled={!schemas.length}
          onChange={(e) => onChange({ schema: e.target.value, table: "" })}>
          <option value="">— select —</option>
          {schemas.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Table</label>
        <select className="select" value={sel.table} disabled={!tables.length}
          onChange={(e) => onChange({ table: e.target.value })}>
          <option value="">— select —</option>
          {tables.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}{t.row_estimate != null ? ` (~${t.row_estimate.toLocaleString()} rows)` : ""}
            </option>
          ))}
        </select>
      </div>
      {sel.table && rowEstimate != null && (
        <p className="text-xs muted">Estimated rows: ~{rowEstimate.toLocaleString()}</p>
      )}
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}

export default function SourceTargetPicker() {
  const { source, target, setSource, setTarget } = useWizard();
  const onSource = useCallback((p: Partial<EndpointSel>) => setSource(p), [setSource]);
  const onTarget = useCallback((p: Partial<EndpointSel>) => setTarget(p), [setTarget]);
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      <EndpointPanel title="Source" sel={source} onChange={onSource} />
      <div className="flex items-center justify-center lg:flex-col">
        <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <IconArrows width={18} height={18} />
        </span>
      </div>
      <EndpointPanel title="Target" sel={target} onChange={onTarget} />
    </div>
  );
}
