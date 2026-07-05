"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useWizard } from "@/lib/store";
import type { MappingProfile } from "@/lib/types";
import { IconBookmark, IconPlay, IconTrash } from "@/components/icons";

const OUTPUT_LABEL: Record<string, string> = { push: "push", sql: ".sql", csv: ".csv", json: ".json" };

export default function ProfilesPage() {
  const [mappings, setMappings] = useState<MappingProfile[]>([]);
  const [error, setError] = useState("");
  const router = useRouter();
  const w = useWizard();

  const refresh = () => api.listMappings().then(setMappings).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
  }, []);

  const load = (m: MappingProfile) => {
    w.reset();
    w.setSource({ connId: m.source_conn_id, schema: m.source_schema, table: m.source_table });
    w.setTarget({ connId: m.target_conn_id, schema: m.target_schema, table: m.target_table });
    w.setColumnMaps(m.column_maps);
    w.setGlobals({
      conflictStrategy: m.conflict_strategy, batchSize: m.batch_size, whereFilter: m.where_filter,
      stopOnError: m.stop_on_error, outputMode: m.output_mode, includeDdl: m.include_ddl,
      mappingName: m.name, loadedMappingId: m.id,
    });
    router.push("/migrate");
  };

  const remove = async (m: MappingProfile) => {
    if (!confirm(`Delete mapping profile "${m.name}"?`)) return;
    await api.deleteMapping(m.id);
    refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Saved Migrations</h1>
        <p className="mt-1 text-sm muted">Reusable mapping profiles — load one to re-run the same migration.</p>
      </div>
      {error && <p className="alert-danger">{error}</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {mappings.map((m) => (
          <div key={m.id} className="card card-pad space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-medium">{m.name}</span>
              <div className="flex gap-1.5">
                <span className="badge badge-accent">{OUTPUT_LABEL[m.output_mode] ?? m.output_mode}</span>
                <span className="badge">{m.conflict_strategy}</span>
              </div>
            </div>
            <p className="font-mono text-xs muted">
              {m.source_schema && `${m.source_schema}.`}{m.source_table} → {m.target_schema && `${m.target_schema}.`}{m.target_table}
            </p>
            <p className="text-xs faint">
              {m.column_maps.filter((c) => c.enabled && c.target_col).length} columns · batch {m.batch_size}
              {m.where_filter ? ` · WHERE ${m.where_filter}` : ""}
            </p>
            <div className="flex gap-2 pt-1">
              <button className="btn btn-primary btn-sm" onClick={() => load(m)}><IconPlay width={12} height={12} /> Load &amp; run</button>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(m)} aria-label="Delete"><IconTrash width={14} height={14} /></button>
            </div>
          </div>
        ))}
      </div>
      {mappings.length === 0 && !error && (
        <div className="card card-pad flex flex-col items-center gap-2 py-16 text-center">
          <IconBookmark width={28} height={28} />
          <p className="font-medium">No saved migrations yet</p>
          <p className="text-sm muted">Configure one in the Migrate wizard and save it from the Run step.</p>
        </div>
      )}
    </div>
  );
}
