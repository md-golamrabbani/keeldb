"use client";
import { useState } from "react";
import type { ColumnInfo, FilterCond } from "@/lib/types";
import { FILTER_OPS } from "@/lib/types";
import { IconPlus, IconTrash } from "@/components/icons";
import Select from "@/components/ui/Select";

const noValue = (op: string) => FILTER_OPS.find((o) => o.value === op)?.noValue ?? false;

export default function AdvancedFilter({
  columns,
  initial,
  onApply,
  onClear,
}: {
  columns: ColumnInfo[];
  initial?: FilterCond[];
  onApply: (filters: FilterCond[]) => void;
  onClear: () => void;
}) {
  const [rows, setRows] = useState<FilterCond[]>(
    initial && initial.length ? initial : [{ column: columns[0]?.name ?? "", op: "=", value: "" }]
  );

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
            <Select className="w-44" value={r.column} onValueChange={(v) => patch(i, { column: v })}
              options={columns.map((c) => ({ value: c.name, label: c.name }))} />
            <Select className="w-36" value={r.op} onValueChange={(v) => patch(i, { op: v })}
              options={FILTER_OPS.map((o) => ({ value: o.value, label: o.label }))} />
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
