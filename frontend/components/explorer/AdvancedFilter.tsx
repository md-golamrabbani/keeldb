"use client";
import { useState } from "react";
import type { ColumnInfo, FilterCond } from "@/lib/types";
import { FILTER_OPS } from "@/lib/types";
import { IconPlus, IconTrash } from "@/components/icons";

const noValue = (op: string) => FILTER_OPS.find((o) => o.value === op)?.noValue ?? false;

export default function AdvancedFilter({
  columns,
  onApply,
  onClear,
}: {
  columns: ColumnInfo[];
  onApply: (filters: FilterCond[]) => void;
  onClear: () => void;
}) {
  const [rows, setRows] = useState<FilterCond[]>([{ column: columns[0]?.name ?? "", op: "=", value: "" }]);

  const patch = (i: number, p: Partial<FilterCond>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const add = () => setRows((rs) => [...rs, { column: columns[0]?.name ?? "", op: "=", value: "" }]);
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const apply = () => onApply(rows.filter((r) => r.column && (noValue(r.op) || r.value !== "")));

  return (
    <div className="card card-pad space-y-3">
      <p className="text-xs font-medium muted">Advanced filter — conditions are combined with AND</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className="select !h-9 !w-44 !py-0" value={r.column} onChange={(e) => patch(i, { column: e.target.value })}>
              {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <select className="select !h-9 !w-36 !py-0" value={r.op} onChange={(e) => patch(i, { op: e.target.value })}>
              {FILTER_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {!noValue(r.op) && (
              <input className="input !h-9 !w-56 !py-0" placeholder="value" value={r.value}
                onChange={(e) => patch(i, { value: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") apply(); }} />
            )}
            <button className="btn btn-ghost btn-sm !h-9" onClick={() => remove(i)} aria-label="Remove condition"><IconTrash width={13} height={13} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="btn btn-secondary btn-sm" onClick={add}><IconPlus width={13} height={13} /> Add condition</button>
        <button className="btn btn-primary btn-sm" onClick={apply}>Apply filter</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setRows([{ column: columns[0]?.name ?? "", op: "=", value: "" }]); onClear(); }}>Clear</button>
      </div>
    </div>
  );
}
