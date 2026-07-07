"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { HistoryEntry, Snippet } from "@/lib/types";
import { IconBookmark, IconTrash } from "@/components/icons";

// Query history (auto-recorded) + saved snippets, in a collapsible panel under
// the SQL editor toolbar. Clicking an entry loads it into the editor.
export default function QueryLibrary({ connId, sql, onLoad, historyNonce }: {
  connId: string; sql: string; onLoad: (sql: string) => void; historyNonce: number;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"history" | "snippets">("history");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const loadHistory = useCallback(() => { api.history(connId).then(setHistory).catch(() => {}); }, [connId]);
  const loadSnippets = useCallback(() => { api.listSnippets().then(setSnippets).catch(() => {}); }, []);

  useEffect(() => { if (open) { loadHistory(); loadSnippets(); } }, [open, loadHistory, loadSnippets]);
  useEffect(() => { if (open && historyNonce) loadHistory(); }, [historyNonce, open, loadHistory]);

  const saveSnippet = async () => {
    setError("");
    try {
      await api.createSnippet(name.trim() || "Untitled", sql);
      setNaming(false); setName(""); loadSnippets(); setTab("snippets"); setOpen(true);
    } catch (e) { setError(String(e)); }
  };

  const clearHistory = async () => { await api.clearHistory(connId); loadHistory(); };
  const delSnippet = async (id: string) => { await api.deleteSnippet(id); loadSnippets(); };

  return (
    <div className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button className="text-sm font-medium" onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"} Library
        </button>
        <button className="btn btn-ghost btn-sm !h-7 ml-auto" onClick={() => { setNaming(true); setOpen(true); }}
          disabled={!sql.trim()} title="Save the current query as a snippet">
          <IconBookmark width={12} height={12} /> Save snippet
        </button>
      </div>

      {naming && (
        <div className="flex items-center gap-2 border-t px-3 py-2" style={{ background: "var(--surface-2)" }}>
          <input autoFocus className="input !h-8 !w-64 !py-0" placeholder="Snippet name" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveSnippet(); if (e.key === "Escape") setNaming(false); }} />
          <button className="btn btn-primary btn-sm !h-8" onClick={saveSnippet}>Save</button>
          <button className="btn btn-ghost btn-sm !h-8" onClick={() => setNaming(false)}>Cancel</button>
        </div>
      )}
      {error && <p className="alert-danger mx-3 my-2">{error}</p>}

      {open && (
        <div className="border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-1 px-3 pt-2">
            {(["history", "snippets"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className="border-b-2 px-2 py-1 text-xs font-medium capitalize transition-colors"
                style={tab === t ? { borderColor: "var(--accent)", color: "var(--accent)" } : { borderColor: "transparent", color: "var(--text-muted)" }}>
                {t}
              </button>
            ))}
            {tab === "history" && history.length > 0 && (
              <button className="btn btn-ghost btn-sm !h-6 ml-auto text-xs" onClick={clearHistory}>Clear history</button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto p-2">
            {tab === "history" ? (
              history.length === 0 ? <p className="p-3 text-center text-xs muted">No queries yet.</p> : (
                <ul className="space-y-0.5">
                  {history.map((h) => (
                    <li key={h.id}>
                      <button className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-[var(--surface-2)]" onClick={() => onLoad(h.sql)}>
                        <span aria-hidden style={{ color: h.ok ? "var(--success)" : "var(--danger)" }}>{h.ok ? "✓" : "✗"}</span>
                        <span className="flex-1 truncate font-mono text-xs">{h.sql}</span>
                        {h.rowcount != null && <span className="text-xs faint">{h.rowcount} rows</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              snippets.length === 0 ? <p className="p-3 text-center text-xs muted">No saved snippets. Use “Save snippet”.</p> : (
                <ul className="space-y-0.5">
                  {snippets.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-[var(--surface-2)]">
                      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onLoad(s.sql)}>
                        <IconBookmark width={12} height={12} style={{ color: "var(--accent)" }} />
                        <span className="font-medium text-xs">{s.name}</span>
                        <span className="flex-1 truncate font-mono text-xs faint">{s.sql}</span>
                      </button>
                      <button className="btn btn-ghost btn-sm !p-1" onClick={() => delSnippet(s.id)} aria-label="Delete snippet"><IconTrash width={12} height={12} /></button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
