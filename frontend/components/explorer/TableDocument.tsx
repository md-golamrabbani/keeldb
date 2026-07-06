"use client";
import { useState } from "react";
import DataGrid from "./DataGrid";
import StructureEditor from "./StructureEditor";
import OperationsPanel from "./OperationsPanel";

type Sub = "data" | "structure" | "operations";
const SUBS: { id: Sub; label: string }[] = [
  { id: "data", label: "Data" },
  { id: "structure", label: "Structure" },
  { id: "operations", label: "Operations" },
];

export default function TableDocument({
  connId, schema, table, initialFilter, filterNonce, initialSub = "data", readOnly = false,
  onOpenReference, onRenamed, onDropped,
}: {
  connId: string;
  schema: string;
  table: string;
  initialFilter?: { column: string; value: string } | null;
  filterNonce: number;
  initialSub?: Sub;
  readOnly?: boolean;
  onOpenReference: (table: string, column: string, value: string) => void;
  onRenamed: (newName: string) => void;
  onDropped: () => void;
}) {
  const [sub, setSub] = useState<Sub>(initialSub);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b" style={{ borderColor: "var(--border)" }}>
        {SUBS.map(({ id, label }) => (
          <button key={id} onClick={() => setSub(id)}
            className="border-b-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={sub === id ? { borderColor: "var(--accent)", color: "var(--accent)" } : { borderColor: "transparent", color: "var(--text-muted)" }}>
            {label}
          </button>
        ))}
        <span className="ml-auto self-center font-mono text-xs faint">{schema}.{table}</span>
      </div>

      {sub === "data" && (
        <DataGrid key={`${table}:${filterNonce}`} connId={connId} schema={schema} table={table}
          initialFilter={initialFilter} onOpenReference={onOpenReference} readOnly={readOnly} />
      )}
      {sub === "structure" && <StructureEditor connId={connId} schema={schema} table={table} />}
      {sub === "operations" && (
        <OperationsPanel connId={connId} schema={schema} table={table}
          onChanged={(nt) => (nt ? onRenamed(nt) : onDropped())} />
      )}
    </div>
  );
}
