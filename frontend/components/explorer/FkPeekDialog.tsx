"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { TableData } from "@/lib/types";
import Modal from "./Modal";
import { IconArrowUpRight } from "@/components/icons";

/** Parse a fk_target like "dept(id)" into { table, column }. */
export function parseFk(fkTarget: string): { table: string; column: string } | null {
  const m = fkTarget.match(/^(.+?)\(([^)]*)\)$/);
  if (!m) return null;
  return { table: m[1].trim(), column: (m[2].split(",")[0] || "").trim() };
}

export default function FkPeekDialog({
  connId, schema, targetTable, targetColumn, value, onOpen, onClose,
}: {
  connId: string;
  schema: string;
  targetTable: string;
  targetColumn: string;
  value: string;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<TableData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError(""); setData(null);
    api.tableData(connId, {
      schema, table: targetTable, limit: 20, offset: 0,
      filters: [{ column: targetColumn, op: "=", value }],
    }).then(setData).catch((e) => setError(String(e)));
  }, [connId, schema, targetTable, targetColumn, value]);

  return (
    <Modal title={`${targetTable} · ${targetColumn} = ${value}`} wide onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs muted">Referenced record{data && data.rows.length !== 1 ? "s" : ""} from <b>{targetTable}</b>.</p>
        {error && <p className="alert-danger">{error}</p>}
        {data && (
          data.rows.length === 0 ? (
            <p className="card card-pad text-center muted">No matching row in {targetTable}.</p>
          ) : data.rows.length === 1 ? (
            // single referenced row → readable field/value list
            <div className="card overflow-hidden">
              {data.colnames.map((c, i) => (
                <div key={c} className="flex gap-3 border-b px-4 py-2 text-sm last:border-b-0">
                  <span className="w-40 shrink-0 font-mono muted">{c}</span>
                  <span className="min-w-0 flex-1 truncate font-mono" title={String(data.rows[0][i] ?? "")}>
                    {data.rows[0][i] == null ? <span className="faint">null</span> : String(data.rows[0][i])}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="card max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr style={{ background: "var(--surface-2)" }} className="text-left uppercase tracking-wide muted">
                  {data.colnames.map((c) => <th key={c} className="px-2.5 py-2 font-mono normal-case">{c}</th>)}
                </tr></thead>
                <tbody>
                  {data.rows.map((row, r) => (
                    <tr key={r} className="border-t">
                      {row.map((cell, c) => <td key={c} className="max-w-[16rem] truncate px-2.5 py-1 font-mono" title={String(cell ?? "")}>{cell == null ? <span className="faint">null</span> : String(cell)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        <div className="flex justify-end">
          <button className="btn btn-primary" onClick={onOpen}>
            Open {targetTable} <IconArrowUpRight width={14} height={14} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
