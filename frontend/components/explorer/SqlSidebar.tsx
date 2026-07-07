"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { HistoryEntry, Snippet } from "@/lib/types";
import ConfirmDialog, { type ConfirmState } from "./ConfirmDialog";
import { IconBookmark, IconPlus, IconTrash } from "@/components/icons";

// Supabase-style left rail for the SQL editor: your saved queries + recent
// history. Click to load, ＋ for a blank query, save the current one by name.
export default function SqlSidebar({ connId, sql, onLoad, onNew, historyNonce }: {
  connId: string; sql: string; onLoad: (sql: string) => void; onNew: () => void; historyNonce: number;
}) {
  const [tab, setTab] = useState<"saved" | "history">("saved");
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const loadSnippets = useCallback(() => { api.listSnippets().then(setSnippets).catch(() => {}); }, []);
  const loadHistory = useCallback(() => { api.history(connId).then(setHistory).catch(() => {}); }, [connId]);

  useEffect(() => { loadSnippets(); loadHistory(); }, [loadSnippets, loadHistory]);
  useEffect(() => { if (historyNonce) loadHistory(); }, [historyNonce, loadHistory]);

  const save = async () => {
    try { await api.createSnippet(name.trim() || "Untitled", sql); setNaming(false); setName(""); setTab("saved"); loadSnippets(); }
    catch { /* surfaced elsewhere */ }
  };
  const del = (id: string) => setConfirm({
    title: "Delete snippet", message: "Delete this saved query?", confirmLabel: "Delete", danger: true,
    onConfirm: async () => { await api.deleteSnippet(id); loadSnippets(); },
  });

  return (
    <aside className="card flex w-full shrink-0 flex-col lg:h-[calc(100vh-13rem)] lg:w-60">
      <div className="flex items-center gap-1.5 border-b p-2" style={{ borderColor: "var(--border)" }}>
        <button className="btn btn-primary btn-sm flex-1" onClick={onNew}><IconPlus width={13} height={13} /> New query</button>
        <button className="btn btn-secondary btn-sm" onClick={() => { setNaming(true); setName(""); }} disabled={!sql.trim()} title="Save current query">
          <IconBookmark width={13} height={13} />
        </button>
      </div>

      {naming && (
        <div className="flex items-center gap-1.5 border-b p-2" style={{ borderColor: "var(--border)" }}>
          <input autoFocus className="input !h-8 !py-0 text-xs" placeholder="Query name" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setNaming(false); }} />
          <button className="btn btn-primary btn-sm !h-8" onClick={save}>Save</button>
        </div>
      )}

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
              {snippets.map((s) => (
                <li key={s.id} className="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-[var(--surface-2)]">
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onLoad(s.sql)} title={s.sql}>
                    <IconBookmark width={12} height={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
                    <span className="truncate text-sm">{s.name}</span>
                  </button>
                  <button className="opacity-0 transition-opacity group-hover:opacity-100" onClick={() => del(s.id)} aria-label="Delete">
                    <IconTrash width={12} height={12} style={{ color: "var(--text-faint)" }} />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          history.length === 0 ? <p className="p-3 text-center text-xs muted">No history yet.</p> : (
            <ul className="space-y-0.5">
              {history.map((h) => (
                <li key={h.id}>
                  <button className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-2)]" onClick={() => onLoad(h.sql)} title={h.sql}>
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
