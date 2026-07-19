"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// UI state that survives route changes (Next.js unmounts pages on navigation)
// AND app restarts. The Explorer snapshot (open workspaces, connection, schema
// and open tabs) is persisted to localStorage so reopening the app restores the
// tables you had open — Workbench-style — instead of starting empty. The
// diagram snapshot stays in-memory only (it can be large / transient).

export interface ExplorerTabSnapshot {
  id: string;
  kind: string;
  title: string;
  table?: string;
  initialSub?: string;
  nonce: number;
}

export interface ExplorerSessionSnapshot {
  connId: string;
  schema: string;
  tabs: ExplorerTabSnapshot[];
  activeId: string;
}

export interface ExplorerSnapshot {
  workspaces: { id: string; label: string }[];
  activeWs: string;
  wsCounter: number;
  sessions: Record<string, ExplorerSessionSnapshot>;
}

// Open document tabs remembered PER connection+schema (key `${connId}::${schema}`)
// so switching schema — or reopening the app — restores exactly the tables/SQL
// tabs you had open for that schema, Workbench-style.
export interface SchemaTabs {
  tabs: ExplorerTabSnapshot[];
  activeId: string;
}

export interface DiagramSnapshot {
  diagramId: string;
  name: string;
  src: string;
  positions: Record<string, { x: number; y: number }>;
  savedName: string | null;
  savedDbml: string | null;
}

interface UiState {
  explorer: ExplorerSnapshot | null;
  setExplorer: (s: Partial<ExplorerSnapshot>) => void;
  setExplorerSession: (wsId: string, s: ExplorerSessionSnapshot) => void;
  dropExplorerSession: (wsId: string) => void;
  schemaTabs: Record<string, SchemaTabs>;
  setSchemaTabs: (key: string, s: SchemaTabs) => void;
  diagram: DiagramSnapshot | null;
  setDiagram: (s: DiagramSnapshot | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      explorer: null,
      setExplorer: (s) =>
        set((st) => ({
          explorer: {
            workspaces: [], activeWs: "", wsCounter: 0, sessions: {},
            ...(st.explorer ?? {}), ...s,
          },
        })),
      setExplorerSession: (wsId, snap) =>
        set((st) => ({
          explorer: {
            workspaces: [], activeWs: "", wsCounter: 0,
            ...(st.explorer ?? {}),
            sessions: { ...(st.explorer?.sessions ?? {}), [wsId]: snap },
          },
        })),
      dropExplorerSession: (wsId) =>
        set((st) => {
          if (!st.explorer) return st;
          const sessions = { ...st.explorer.sessions };
          delete sessions[wsId];
          return { explorer: { ...st.explorer, sessions } };
        }),
      schemaTabs: {},
      setSchemaTabs: (key, s) =>
        set((st) => ({ schemaTabs: { ...st.schemaTabs, [key]: s } })),
      diagram: null,
      setDiagram: (diagram) => set({ diagram }),
    }),
    {
      name: "visualdb-ui-store",
      version: 1,
      // The Explorer workspace strip and the per-schema open tabs are durable;
      // the diagram working state is not.
      partialize: (s) => ({ explorer: s.explorer, schemaTabs: s.schemaTabs }),
    },
  ),
);
