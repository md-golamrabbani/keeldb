"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { HistoryEntry, Snippet } from "@/lib/types";
import ConfirmDialog, { type ConfirmState } from "./ConfirmDialog";
import { IconBookmark, IconPlus, IconSave, IconTrash } from "@/components/icons";

export type SaveState = "idle" | "saving" | "saved";

// Supabase-style left rail: your saved queries + history. Snippet state lives in
// the editor (it owns auto-save); this component renders it and raises actions.
export default function SqlSidebar({
  connId, snippets, activeId, saveState, onNew, onSelect, onSave, onDelete, onLoadHistory, historyNonce,
}: {
  connId: string;
  snippets: Snippet[];
  activeId: string | null;
  saveState: SaveState;
  onNew: () => void;
  onSelect: (s: Snippet) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  onLoadHistory: (sql: string) => void;
  historyNonce: number;
}) {
  const [tab, setTab] = useState<"saved" | "history">("saved");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const loadHistory = useCallback(() => { api.history(connId).then(setHistory).catch(() => {}); }, [connId]);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { if (historyNonce) loadHistory(); }, [historyNonce, loadHistory]);

  const del = (id: string) => setConfirm({
    title: "Delete query", message: "Delete this saved query?", confirmLabel: "Delete", danger: true,
    onConfirm: async () => onDelete(id),
  });

  return (
    <aside className="card flex w-full shrink-0 flex-col lg:sticky lg:top-0 lg:w-60 lg:max-h-[calc(100vh-9rem)]">
      <div className="flex items-center gap-1.5 border-b p-2" style={{ borderColor: "var(--border)" }}>
        <button className="btn btn-primary btn-sm flex-1" onClick={onNew}><IconPlus width={13} height={13} /> New query</button>
        <button className="btn btn-secondary btn-sm" onClick={onSave} title="Save now">
          <IconSave width={13} height={13} /> Save
        </button>
        {/* silent auto-save: a subtle, fixed-width status that never shifts layout */}
        <span className="w-4 text-center text-xs transition-opacity" title={saveState === "saving" ? "Saving…" : "Saved"}
          style={{ color: saveState === "saved" ? "var(--success)" : "var(--text-faint)", opacity: saveState === "idle" ? 0 : 1 }}>
          {saveState === "saving" ? "•" : "✓"}
        </span>
      </div>

      <div className="flex gap-1 px-2 pt-2 text-xs">
        {(["saved", "history"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="rounded-md px-2 py-1 font-medium capitalize transition-colors"
            style={tab === t ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-muted)" }}>{t}</button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 max-lg:max-h-52">
        {tab === "saved" ? (
          snippets.length === 0 ? <p className="p-3 text-center text-xs muted">No saved queries yet.</p> : (
            <ul className="space-y-0.5">
              {snippets.map((s) => {
                const active = s.id === activeId;
                return (
                  <li key={s.id} className="group flex items-center gap-1 rounded-md px-2 py-1.5"
                    style={active ? { background: "var(--accent-soft)" } : undefined}>
                    <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onSelect(s)} title={s.sql}>
                      <IconBookmark width={12} height={12} style={{ color: active ? "var(--accent)" : "var(--text-faint)", flexShrink: 0 }} />
                      <span className="truncate text-sm" style={active ? { color: "var(--accent)" } : undefined}>{s.name}</span>
                    </button>
                    <button className="opacity-0 transition-opacity group-hover:opacity-100" onClick={() => del(s.id)} aria-label="Delete">
                      <IconTrash width={12} height={12} style={{ color: "var(--text-faint)" }} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          history.length === 0 ? <p className="p-3 text-center text-xs muted">No history yet.</p> : (
            <ul className="space-y-0.5">
              {history.map((h) => (
                <li key={h.id}>
                  <button className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-2)]" onClick={() => onLoadHistory(h.sql)} title={h.sql}>
                    <span aria-hidden style={{ color: h.ok ? "var(--success)" : "var(--danger)", flexShrink: 0 }}>{h.ok ? "✓" : "✗"}</span>
                    <span className="truncate font-mono text-xs">{h.sql}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </aside>
  );
}
