"use client";
import { useState } from "react";
import DataGrid from "./DataGrid";
import DuplicatesView from "./DuplicatesView";
import ProfileView from "./ProfileView";
import StructureEditor from "./StructureEditor";
import OperationsPanel from "./OperationsPanel";

type Sub = "data" | "structure" | "operations" | "profile" | "duplicates";
const SUBS: { id: Sub; label: string }[] = [
  { id: "data", label: "Data" },
  { id: "structure", label: "Structure" },
  { id: "operations", label: "Operations" },
  { id: "profile", label: "Profile" },
  { id: "duplicates", label: "Duplicates" },
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
  // Drill-in filter set when "View rows" is clicked from the Duplicates view.
  const [drill, setDrill] = useState<{ column: string; value: string } | null>(null);
  const [drillNonce, setDrillNonce] = useState(0);

  const viewRows = (column: string, value: string) => {
    setDrill({ column, value });
    setDrillNonce((n) => n + 1);
    setSub("data");
  };
  const gridFilter = drill ?? initialFilter;
  const gridKey = `${table}:${filterNonce}:${drillNonce}`;

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
        <DataGrid key={gridKey} connId={connId} schema={schema} table={table}
          initialFilter={gridFilter} onOpenReference={onOpenReference} readOnly={readOnly} />
      )}
      {sub === "structure" && <StructureEditor connId={connId} schema={schema} table={table} />}
      {sub === "operations" && (
        <OperationsPanel connId={connId} schema={schema} table={table}
          onChanged={(nt) => (nt ? onRenamed(nt) : onDropped())} />
      )}
      {sub === "profile" && <ProfileView connId={connId} schema={schema} table={table} />}
      {sub === "duplicates" && (
        <DuplicatesView connId={connId} schema={schema} table={table} onViewRows={viewRows} />
      )}
    </div>
  );
}
