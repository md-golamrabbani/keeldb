"use client";
import { create } from "zustand";

// In-memory UI state that survives route changes (Next.js unmounts pages on
// navigation). Deliberately NOT localStorage: a fresh app start begins clean,
// but hopping Explorer → Diagrams → Explorer keeps everything where it was.

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
  diagram: DiagramSnapshot | null;
  setDiagram: (s: DiagramSnapshot | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
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
  diagram: null,
  setDiagram: (diagram) => set({ diagram }),
}));
