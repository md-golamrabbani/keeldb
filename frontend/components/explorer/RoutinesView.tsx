"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { IconChevronDown, IconChevronUp } from "@/components/icons";

interface Routine { name: string; kind: string; returns: string; definition: string }

/** Stored procedures & functions in the schema, with expandable definitions. */
export default function RoutinesView({ connId, schema }: { connId: string; schema: string }) {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.listRoutines(connId, schema)
      .then((r) => { setSupported(r.supported); setRoutines(r.routines); })
      .catch((e) => setError(String(e)));
  }, [connId, schema]);

  if (error) return <p className="alert-danger">{error}</p>;
  if (!routines) return <p className="muted">Loading routines…</p>;
  if (!supported)
    return <p className="text-sm muted">Stored routines are available on MySQL and PostgreSQL connections.</p>;
  if (routines.length === 0)
    return <p className="text-sm muted">No stored procedures or functions in this schema.</p>;

  return (
    <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
      {routines.map((r) => {
        const expanded = open === r.name;
        return (
          <div key={r.name}>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-2)]"
              onClick={() => setOpen(expanded ? null : r.name)}
            >
              <span className="badge" style={{ textTransform: "uppercase" }}>{r.kind}</span>
              <span className="font-mono font-medium">{r.name}</span>
              {r.returns && <span className="font-mono text-xs faint">→ {r.returns}</span>}
              <span className="ml-auto" style={{ color: "var(--text-faint)" }}>
                {expanded ? <IconChevronUp width={14} height={14} /> : <IconChevronDown width={14} height={14} />}
              </span>
            </button>
            {expanded && (
              <pre className="overflow-x-auto border-t px-3 py-3 font-mono text-xs"
                style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
                {r.definition || "-- definition not available (insufficient privileges?)"}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
