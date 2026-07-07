"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWizard, type EndpointSel } from "@/lib/store";
import type { TableInfo } from "@/lib/types";
import { IconArrows, IconDatabase, IconFile, IconPlus } from "./icons";
import Select from "@/components/ui/Select";

function EndpointPanel({
  title,
  sel,
  onChange,
  source,
}: {
  title: string;
  sel: EndpointSel;
  onChange: (patch: Partial<EndpointSel>) => void;
  source?: EndpointSel; // when set, this is the Target panel → enable "generate from source"
}) {
  const connections = useWizard((s) => s.connections);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [error, setError] = useState("");
  const conn = connections.find((c) => c.id === sel.connId);
  const isTarget = source !== undefined;

  // generate-target state
  const [genName, setGenName] = useState("");
  const [genDdl, setGenDdl] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState("");

  const loadTables = useCallback(() => {
    if (!sel.connId || !sel.schema) { setTables([]); return; }
    api.listTables(sel.connId, sel.schema).then(setTables).catch((e) => setError(String(e)));
  }, [sel.connId, sel.schema]);

  useEffect(() => {
    setSchemas([]);
    setError("");
    if (!sel.connId) return;
    api.listSchemas(sel.connId)
      .then((s) => { setSchemas(s); if (s.length === 1 && !sel.schema) onChange({ schema: s[0], table: "" }); })
      .catch((e) => setError(String(e)));
  }, [sel.connId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setTables([]); loadTables(); }, [loadTables]);

  const rowEstimate = tables.find((t) => t.name === sel.table)?.row_estimate;
  const sourceReady = !!(source?.connId && source.schema && source.table);
  const targetLocReady = !!(sel.connId && sel.schema);
  const effName = () => (genName.trim() || source?.table || "");

  const genPayload = (execute: boolean) => ({
    source_conn_id: source!.connId, source_schema: source!.schema, source_table: source!.table,
    target_conn_id: sel.connId, target_schema: sel.schema, target_table: effName(), execute,
  });

  const preview = async () => {
    setGenBusy(true); setGenMsg(""); setGenDdl("");
    try { setGenDdl((await api.generateTarget(genPayload(false))).ddl); }
    catch (e) { setGenMsg(String(e)); } finally { setGenBusy(false); }
  };
  const create = async () => {
    setGenBusy(true); setGenMsg("");
    try {
      await api.generateTarget(genPayload(true));
      const name = effName();
      setGenMsg(`Created "${name}".`); setGenDdl("");
      loadTables();
      onChange({ table: name });
    } catch (e) { setGenMsg(String(e)); } finally { setGenBusy(false); }
  };

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
        <Select className="w-full" value={sel.connId} placeholder="— select —"
          onValueChange={(v) => onChange({ connId: v, schema: "", table: "" })}
          options={connections.map((c) => ({ value: c.id, label: `${c.name} (${c.flavor})` }))} />
      </div>
      <div>
        <label className="label">Schema</label>
        <Select className="w-full" value={sel.schema} placeholder="— select —" disabled={!schemas.length}
          onValueChange={(v) => onChange({ schema: v, table: "" })}
          options={schemas.map((s) => ({ value: s, label: s }))} />
      </div>
      <div>
        <label className="label">Table</label>
        <Select className="w-full" value={sel.table} placeholder="— select —" disabled={!tables.length}
          onValueChange={(v) => onChange({ table: v })}
          options={tables.map((t) => ({ value: t.name, label: `${t.name}${t.row_estimate != null ? ` (~${t.row_estimate.toLocaleString()} rows)` : ""}` }))} />
      </div>
      {sel.table && rowEstimate != null && (
        <p className="text-xs muted">Estimated rows: ~{rowEstimate.toLocaleString()}</p>
      )}

      {isTarget && targetLocReady && sourceReady && (
        <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
          <p className="mb-2 text-xs muted">Target table doesn’t exist yet? Generate it from <b>{source!.table}</b>.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input !w-44 !py-1.5" placeholder={source!.table} value={genName}
              onChange={(e) => setGenName(e.target.value)} />
            <button className="btn btn-secondary btn-sm" onClick={preview} disabled={genBusy}>Preview DDL</button>
            <button className="btn btn-primary btn-sm" onClick={create} disabled={genBusy}>
              <IconPlus width={13} height={13} /> Create table
            </button>
          </div>
          {genDdl && <pre className="mt-2 overflow-x-auto rounded-md p-2 font-mono text-xs" style={{ background: "var(--surface-2)", color: "var(--text)" }}>{genDdl}</pre>}
          {genMsg && <p className="mt-1 text-xs" style={{ color: genMsg.startsWith("Created") ? "var(--success)" : "var(--danger)" }}>{genMsg}</p>}
        </div>
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
      <EndpointPanel title="Target" sel={target} onChange={onTarget} source={source} />
    </div>
  );
}
