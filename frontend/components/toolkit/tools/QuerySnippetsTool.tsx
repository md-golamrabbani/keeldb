"use client";
import { useState } from "react";
import { useToolkitStore } from "@/lib/toolkitStore";
import { IconPlus, IconTrash } from "@/components/icons";

export default function QuerySnippetsTool() {
  const snippets = useToolkitStore((s) => s.snippets);
  const saveSnippet = useToolkitStore((s) => s.saveSnippet);
  const deleteSnippet = useToolkitStore((s) => s.deleteSnippet);
  const loadSnippet = useToolkitStore((s) => s.loadSnippet);

  const [snippetName, setSnippetName] = useState("");
  const [snippetContent, setSnippetContent] = useState("");

  const handleSave = () => {
    if (!snippetName.trim() || !snippetContent.trim()) return;
    saveSnippet(snippetName, "", snippetContent, {});
    setSnippetName("");
    setSnippetContent("");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Query Snippet Builder</h2>
        <p className="mt-1 text-sm muted">Save and reuse favorite query templates and patterns.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card card-pad space-y-3">
          <h3 className="font-medium">Create Snippet</h3>
          <div>
            <label className="text-sm font-medium block mb-2">Name</label>
            <input
              type="text"
              value={snippetName}
              onChange={(e) => setSnippetName(e.target.value)}
              placeholder="e.g., Find by ID range"
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">SQL Template</label>
            <textarea
              value={snippetContent}
              onChange={(e) => setSnippetContent(e.target.value)}
              placeholder="SELECT * FROM table WHERE id IN (...)"
              className="w-full rounded border p-3 font-mono text-sm resize-none"
              style={{ minHeight: "120px", borderColor: "var(--border)", background: "var(--surface)" }}
            />
          </div>

          <button
            onClick={handleSave}
            className="btn btn-primary btn-sm w-fit"
            disabled={!snippetName.trim() || !snippetContent.trim()}
          >
            <IconPlus width={14} height={14} /> Save Snippet
          </button>
        </div>

        <div className="card card-pad space-y-3">
          <h3 className="font-medium">Saved Snippets ({snippets.length})</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {snippets.length === 0 ? (
              <p className="text-sm muted">No snippets saved yet</p>
            ) : (
              snippets.map((snippet) => (
                <div key={snippet.id} className="flex items-start justify-between gap-2 rounded border p-2" style={{ borderColor: "var(--border)" }}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm">{snippet.name}</div>
                    <div className="truncate text-xs muted font-mono" title={snippet.input}>
                      {snippet.input}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => loadSnippet(snippet.id)}
                      className="btn btn-secondary btn-xs"
                      title="Load snippet"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deleteSnippet(snippet.id)}
                      className="btn btn-ghost btn-xs"
                      title="Delete snippet"
                    >
                      <IconTrash width={12} height={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
