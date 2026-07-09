"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import DataGrid from "./DataGrid";

/** A database VIEW opened as a document: its defining SQL + its rows
 * (read-only — views have no primary key to edit through). */
export default function ViewDocument({ connId, schema, view }: {
  connId: string; schema: string; view: string;
}) {
  const [definition, setDefinition] = useState("");
  const [showDef, setShowDef] = useState(false);

  useEffect(() => {
    api.viewDefinition(connId, schema, view).then((d) => setDefinition(d.definition)).catch(() => {});
  }, [connId, schema, view]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="badge badge-accent">VIEW</span>
        <span className="font-mono text-sm">{view}</span>
        {definition && (
          <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setShowDef((s) => !s)}>
            {showDef ? "Hide definition" : "Show definition"}
          </button>
        )}
      </div>
      {showDef && definition && (
        <pre className="overflow-x-auto rounded-lg p-3 font-mono text-xs"
          style={{ background: "var(--surface-2)" }}>{definition}</pre>
      )}
      <DataGrid connId={connId} schema={schema} table={view} readOnly />
    </div>
  );
}
