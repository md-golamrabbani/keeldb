"use client";
import { create } from "zustand";
import type { ColumnInfo, ColumnMap, ConflictStrategy, ConnectionProfile, OutputMode } from "./types";

export interface EndpointSel {
  connId: string;
  schema: string;
  table: string;
}

interface WizardState {
  step: number; // 0 picker, 1 mapping, 2 preview, 3 run
  connections: ConnectionProfile[];
  source: EndpointSel;
  target: EndpointSel;
  sourceColumns: ColumnInfo[];
  targetColumns: ColumnInfo[];
  columnMaps: ColumnMap[];
  conflictStrategy: ConflictStrategy;
  batchSize: number;
  whereFilter: string;
  stopOnError: boolean;
  outputMode: OutputMode;
  includeDdl: boolean;
  mappingName: string;
  loadedMappingId: string;
  // Opt-in Supabase Auth (auth.users) migration — inert unless enabled.
  supabaseAuthEnabled: boolean;
  supabaseAuthPassword: string;
  supabaseAuthConfirm: boolean;

  setStep: (s: number) => void;
  setConnections: (c: ConnectionProfile[]) => void;
  setSource: (e: Partial<EndpointSel>) => void;
  setTarget: (e: Partial<EndpointSel>) => void;
  setColumns: (side: "source" | "target", cols: ColumnInfo[]) => void;
  setColumnMaps: (m: ColumnMap[]) => void;
  patchColumnMap: (sourceCol: string, patch: Partial<ColumnMap>) => void;
  setGlobals: (
    p: Partial<
      Pick<
        WizardState,
        | "conflictStrategy"
        | "batchSize"
        | "whereFilter"
        | "stopOnError"
        | "outputMode"
        | "includeDdl"
        | "mappingName"
        | "loadedMappingId"
        | "supabaseAuthEnabled"
        | "supabaseAuthPassword"
        | "supabaseAuthConfirm"
      >
    >
  ) => void;
  reset: () => void;
}

const emptySel: EndpointSel = { connId: "", schema: "", table: "" };

export const useWizard = create<WizardState>((set) => ({
  step: 0,
  connections: [],
  source: { ...emptySel },
  target: { ...emptySel },
  sourceColumns: [],
  targetColumns: [],
  columnMaps: [],
  conflictStrategy: "insert",
  batchSize: 500,
  whereFilter: "",
  stopOnError: false,
  outputMode: "push",
  includeDdl: true,
  mappingName: "",
  loadedMappingId: "",
  supabaseAuthEnabled: false,
  supabaseAuthPassword: "",
  supabaseAuthConfirm: true,

  setStep: (step) => set({ step }),
  setConnections: (connections) => set({ connections }),
  setSource: (e) => set((s) => ({ source: { ...s.source, ...e } })),
  setTarget: (e) => set((s) => ({ target: { ...s.target, ...e } })),
  setColumns: (side, cols) =>
    set(side === "source" ? { sourceColumns: cols } : { targetColumns: cols }),
  setColumnMaps: (columnMaps) => set({ columnMaps }),
  patchColumnMap: (sourceCol, patch) =>
    set((s) => ({
      columnMaps: s.columnMaps.map((m) => (m.source_col === sourceCol ? { ...m, ...patch } : m)),
    })),
  setGlobals: (p) => set(p as Partial<WizardState>),
  reset: () =>
    set({
      step: 0,
      source: { ...emptySel },
      target: { ...emptySel },
      sourceColumns: [],
      targetColumns: [],
      columnMaps: [],
      conflictStrategy: "insert",
      batchSize: 500,
      whereFilter: "",
      stopOnError: false,
      outputMode: "push",
      includeDdl: true,
      mappingName: "",
      loadedMappingId: "",
      supabaseAuthEnabled: false,
      supabaseAuthPassword: "",
      supabaseAuthConfirm: true,
    }),
}));

/** Case/underscore-insensitive auto-map: snake/camel normalized name match. */
export function autoMap(sourceCols: ColumnInfo[], targetCols: ColumnInfo[]): ColumnMap[] {
  const norm = (s: string) => s.toLowerCase().replace(/[_\s-]/g, "");
  const targetByNorm = new Map(targetCols.map((c) => [norm(c.name), c.name]));
  return sourceCols.map((sc) => {
    const hit = targetByNorm.get(norm(sc.name));
    return {
      source_col: sc.name,
      target_col: hit ?? "",
      enabled: !!hit,
      cast_type: "",
      cast_format: "",
      transform_expr: "",
      default_value: null,
      is_conflict_key: false,
    };
  });
}
