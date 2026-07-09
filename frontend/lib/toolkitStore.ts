import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ToolkitState {
  selectedToolId: string;
  toolInputs: Record<string, string>;
  toolOptions: Record<string, Record<string, any>>;
  history: Array<{ toolId: string; timestamp: number; input: string; output: string }>;
  favorites: string[];
  snippets: Array<{ id: string; name: string; toolId: string; input: string; options: Record<string, any>; createdAt: number }>;

  setSelectedTool: (id: string) => void;
  updateInput: (toolId: string, input: string) => void;
  updateOptions: (toolId: string, options: Record<string, any>) => void;
  addToHistory: (toolId: string, input: string, output: string) => void;
  clearInput: (toolId: string) => void;
  toggleFavorite: (toolId: string) => void;
  saveSnippet: (name: string, toolId: string, input: string, options: Record<string, any>) => void;
  deleteSnippet: (id: string) => void;
  loadSnippet: (id: string) => void;
  clearHistory: () => void;
}

export const useToolkitStore = create<ToolkitState>()(
  persist(
    (set, get) => ({
      selectedToolId: "sql-in-clause",
      toolInputs: {},
      toolOptions: {},
      history: [],
      favorites: [],
      snippets: [],

      setSelectedTool: (id: string) => set({ selectedToolId: id }),

      updateInput: (toolId: string, input: string) =>
        set((state) => ({
          toolInputs: { ...state.toolInputs, [toolId]: input },
        })),

      updateOptions: (toolId: string, options: Record<string, any>) =>
        set((state) => ({
          toolOptions: {
            ...state.toolOptions,
            [toolId]: { ...state.toolOptions[toolId], ...options },
          },
        })),

      addToHistory: (toolId: string, input: string, output: string) =>
        set((state) => ({
          history: [
            { toolId, timestamp: Date.now(), input, output },
            ...state.history.slice(0, 49), // Keep last 50
          ],
        })),

      clearInput: (toolId: string) =>
        set((state) => ({
          toolInputs: { ...state.toolInputs, [toolId]: "" },
        })),

      toggleFavorite: (toolId: string) =>
        set((state) => ({
          favorites: state.favorites.includes(toolId)
            ? state.favorites.filter((id) => id !== toolId)
            : [...state.favorites, toolId],
        })),

      saveSnippet: (name: string, toolId: string, input: string, options: Record<string, any>) =>
        set((state) => ({
          snippets: [
            {
              id: `snippet-${Date.now()}`,
              name,
              toolId,
              input,
              options,
              createdAt: Date.now(),
            },
            ...state.snippets,
          ],
        })),

      deleteSnippet: (id: string) =>
        set((state) => ({
          snippets: state.snippets.filter((s) => s.id !== id),
        })),

      loadSnippet: (id: string) => {
        const snippet = get().snippets.find((s) => s.id === id);
        if (snippet) {
          set({
            selectedToolId: snippet.toolId,
            toolInputs: { ...get().toolInputs, [snippet.toolId]: snippet.input },
            toolOptions: { ...get().toolOptions, [snippet.toolId]: snippet.options },
          });
        }
      },

      clearHistory: () => set({ history: [] }),
    }),
    {
      name: "toolkit-store",
      version: 1,
    }
  )
);
