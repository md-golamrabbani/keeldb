import type { MappingProfile } from "./types";
import type { useWizard } from "./store";

type WizardSnapshot = ReturnType<typeof useWizard.getState>;

/** Assemble a MappingProfile from the current wizard state. */
export function buildMapping(w: WizardSnapshot): MappingProfile {
  return {
    id: w.loadedMappingId,
    name: w.mappingName || `${w.source.table} → ${w.target.table}`,
    source_conn_id: w.source.connId,
    target_conn_id: w.target.connId,
    source_schema: w.source.schema,
    source_table: w.source.table,
    target_schema: w.target.schema,
    target_table: w.target.table,
    column_maps: w.columnMaps,
    conflict_strategy: w.conflictStrategy,
    batch_size: w.batchSize,
    where_filter: w.whereFilter,
    stop_on_error: w.stopOnError,
    output_mode: w.outputMode,
    include_ddl: w.includeDdl,
  };
}
