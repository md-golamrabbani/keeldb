"use client";
import { autoMap, useWizard } from "@/lib/store";
import type { ColumnInfo, ConflictStrategy } from "@/lib/types";
import { CAST_TYPES, MASK_PRESETS } from "@/lib/types";
import Checkbox from "@/components/ui/Checkbox";
import { IconBolt } from "./icons";

function ColBadges({ c }: { c: ColumnInfo }) {
  return (
    <span className="ml-1.5 inline-flex gap-1 align-middle">
      {c.is_pk && <span className="badge badge-warning">PK</span>}
      {c.is_fk && <span className="badge badge-accent" title={c.fk_target}>FK</span>}
      {!c.nullable && <span className="badge">NOT NULL</span>}
    </span>
  );
}

function typesCompatible(src: string, tgt: string, cast: string): boolean {
  if (cast) return true;
  const bucket = (t: string) => {
    const s = t.toLowerCase();
    if (/int|serial|dec|num|float|double|real|money/.test(s)) return "num";
    if (/bool|tinyint\(1\)/.test(s)) return "bool";
    if (/timestamp|datetime/.test(s)) return "ts";
    if (/date/.test(s)) return "date";
    if (/uuid/.test(s)) return "uuid";
    return "text";
  };
  return bucket(src) === bucket(tgt);
}

export default function MappingCanvas() {
  const {
    sourceColumns, targetColumns, columnMaps, setColumnMaps, patchColumnMap,
    conflictStrategy, batchSize, whereFilter, stopOnError, setGlobals,
  } = useWizard();

  const targetByName = new Map(targetColumns.map((c) => [c.name, c]));
  const mappedTargets = new Set(columnMaps.filter((m) => m.enabled && m.target_col).map((m) => m.target_col));
  const missingRequired = targetColumns.filter((c) => !c.nullable && c.default == null && !mappedTargets.has(c.name));
  const activeCount = columnMaps.filter((m) => m.enabled && m.target_col).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm" onClick={() => setColumnMaps(autoMap(sourceColumns, targetColumns))}>
          <IconBolt width={14} height={14} /> Auto-map by name
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => setColumnMaps(columnMaps.map((m) => ({ ...m, enabled: true })))}>Check all</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setColumnMaps(columnMaps.map((m) => ({ ...m, enabled: false })))}>Uncheck all</button>
        <span className="ml-auto text-sm muted">{activeCount} of {columnMaps.length} columns mapped</span>
      </div>

      {missingRequired.length > 0 && (
        <p className="alert-danger">
          Required target columns not mapped (NOT NULL, no default):{" "}
          <b>{missingRequired.map((c) => c.name).join(", ")}</b>
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--surface-2)" }} className="text-left text-xs uppercase tracking-wide muted">
              <th className="w-8 px-3 py-2.5"></th>
              <th className="px-3 py-2.5">Source column</th>
              <th className="px-3 py-2.5">Target column</th>
              <th className="px-3 py-2.5">Cast</th>
              <th className="px-3 py-2.5">Format</th>
              <th className="px-3 py-2.5">Transform expression</th>
              <th className="px-3 py-2.5">Default</th>
              <th className="px-3 py-2.5 text-center" title="Conflict key for upsert / skip">Key</th>
            </tr>
          </thead>
          <tbody>
            {columnMaps.map((m) => {
              const sc = sourceColumns.find((c) => c.name === m.source_col);
              const tc = m.target_col ? targetByName.get(m.target_col) : undefined;
              const mismatch = m.enabled && sc && tc && !typesCompatible(sc.data_type, tc.data_type, m.cast_type);
              return (
                <tr key={m.source_col} className="border-t" style={{ opacity: m.enabled ? 1 : 0.45 }}>
                  <td className="px-3 py-1.5">
                    <Checkbox checked={m.enabled} onCheckedChange={(v) => patchColumnMap(m.source_col, { enabled: v })} ariaLabel="Include column" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className="font-mono font-medium">{m.source_col}</span>
                    <span className="ml-1.5 text-xs faint">{sc?.data_type}</span>
                    {sc && <ColBadges c={sc} />}
                  </td>
                  <td className="px-3 py-1.5">
                    <select className="select !w-44 !py-1.5" style={mismatch ? { borderColor: "var(--warning)" } : undefined}
                      title={mismatch ? `Type mismatch: ${sc?.data_type} → ${tc?.data_type}. Add a cast or transform.` : ""}
                      value={m.target_col} disabled={!m.enabled}
                      onChange={(e) => patchColumnMap(m.source_col, { target_col: e.target.value })}>
                      <option value="">— skip —</option>
                      {targetColumns.map((c) => (
                        <option key={c.name} value={c.name}>{c.name} ({c.data_type}){!c.nullable ? " *" : ""}</option>
                      ))}
                    </select>
                    {mismatch && <span className="ml-1" style={{ color: "var(--warning)" }} title="type mismatch">⚠</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    <select className="select !w-24 !py-1.5" value={m.cast_type} disabled={!m.enabled}
                      onChange={(e) => patchColumnMap(m.source_col, { cast_type: e.target.value })}>
                      {CAST_TYPES.map((t) => <option key={t} value={t}>{t || "—"}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input className="input !w-28 !py-1.5 font-mono text-xs"
                      placeholder={["date", "timestamp"].includes(m.cast_type) ? "e.g. %d/%m/%Y" : "—"}
                      value={m.cast_format} disabled={!m.enabled || !["date", "timestamp"].includes(m.cast_type)}
                      onChange={(e) => patchColumnMap(m.source_col, { cast_format: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      <input className="input !w-64 !py-1.5 font-mono text-xs" placeholder="e.g. split_part(value, ' ', -1)"
                        value={m.transform_expr} disabled={!m.enabled}
                        onChange={(e) => patchColumnMap(m.source_col, { transform_expr: e.target.value })} />
                      <select className="select !w-9 !px-1 !py-1.5" value="" disabled={!m.enabled}
                        title="Insert a data-masking preset (anonymize for prod→dev)"
                        onChange={(e) => { if (e.target.value) patchColumnMap(m.source_col, { transform_expr: e.target.value }); }}>
                        <option value="">🎭</option>
                        {MASK_PRESETS.map((p) => <option key={p.expr} value={p.expr}>{p.label}</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <input className="input !w-24 !py-1.5" value={m.default_value ?? ""} disabled={!m.enabled}
                      onChange={(e) => patchColumnMap(m.source_col, { default_value: e.target.value || null })} />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <Checkbox checked={m.is_conflict_key} disabled={!m.enabled}
                      title="Conflict key (used for upsert / skip-duplicates)"
                      onCheckedChange={(v) => patchColumnMap(m.source_col, { is_conflict_key: v })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card card-pad flex flex-wrap items-end gap-5">
        <div>
          <label className="label">Conflict strategy</label>
          <select className="select !w-44" value={conflictStrategy}
            onChange={(e) => setGlobals({ conflictStrategy: e.target.value as ConflictStrategy })}>
            <option value="insert">insert</option>
            <option value="upsert">upsert</option>
            <option value="skip">skip duplicates</option>
          </select>
        </div>
        <div>
          <label className="label">Batch size</label>
          <input className="input !w-28" type="number" value={batchSize}
            onChange={(e) => setGlobals({ batchSize: Number(e.target.value) || 500 })} />
        </div>
        <div className="min-w-[16rem] flex-1">
          <label className="label">WHERE filter on source (optional)</label>
          <input className="input font-mono text-xs" placeholder="status = 'active'"
            value={whereFilter} onChange={(e) => setGlobals({ whereFilter: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 pb-2.5 text-sm">
          <Checkbox checked={stopOnError} onCheckedChange={(v) => setGlobals({ stopOnError: v })} />
          Stop on error
        </label>
      </div>
    </div>
  );
}
