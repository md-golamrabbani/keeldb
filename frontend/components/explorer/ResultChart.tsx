"use client";
import { useMemo, useState } from "react";

type Cell = string | number | boolean | null;

// Dependency-free SVG chart (bar / line) over a query result. The user picks a
// label column and a numeric value column; we render inline SVG so it works
// offline and inside the Tauri shell with no external chart library.
export default function ResultChart({ columns, rows }: { columns: string[]; rows: Cell[][] }) {
  const numericCols = useMemo(
    () => columns.filter((_, i) => rows.some((r) => r[i] !== null && r[i] !== "" && !isNaN(Number(r[i])))),
    [columns, rows]
  );
  const [labelCol, setLabelCol] = useState(columns[0] ?? "");
  const [valueCol, setValueCol] = useState(numericCols[0] ?? "");
  const [kind, setKind] = useState<"bar" | "line">("bar");

  const li = columns.indexOf(labelCol);
  const vi = columns.indexOf(valueCol);

  const data = useMemo(() => {
    if (vi < 0) return [];
    return rows.slice(0, 50).map((r) => ({ label: String(r[li] ?? ""), value: Number(r[vi]) || 0 }));
  }, [rows, li, vi]);

  if (numericCols.length === 0) return <p className="text-sm muted">No numeric column to chart.</p>;

  const W = 720, H = 260, PAD = 34;
  const max = Math.max(1, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const span = max - min || 1;
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, data.length - (kind === "line" ? 1 : 0)) + (kind === "bar" ? (W - PAD * 2) / data.length / 2 : 0);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const bw = ((W - PAD * 2) / Math.max(1, data.length)) * 0.7;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Sel label="Label" value={labelCol} onChange={setLabelCol} options={columns} />
        <Sel label="Value" value={valueCol} onChange={setValueCol} options={numericCols} />
        <div className="flex overflow-hidden rounded-lg border" style={{ borderColor: "var(--border-strong)" }}>
          {(["bar", "line"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className="px-3 py-1 text-xs capitalize"
              style={kind === k ? { background: "var(--accent)", color: "#fff" } : { color: "var(--text-muted)" }}>{k}</button>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }} role="img">
          <line x1={PAD} y1={y(min)} x2={W - PAD} y2={y(min)} stroke="var(--border-strong)" />
          {kind === "bar"
            ? data.map((d, i) => (
                <rect key={i} x={x(i) - bw / 2} y={y(Math.max(0, d.value))} width={bw}
                  height={Math.abs(y(d.value) - y(0))} fill="var(--accent)" rx="2">
                  <title>{d.label}: {d.value.toLocaleString()}</title>
                </rect>
              ))
            : (
              <polyline fill="none" stroke="var(--accent)" strokeWidth="2"
                points={data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ")} />
            )}
          {kind === "line" && data.map((d, i) => (
            <circle key={i} cx={x(i)} cy={y(d.value)} r="3" fill="var(--accent)"><title>{d.label}: {d.value.toLocaleString()}</title></circle>
          ))}
          {data.length <= 16 && data.map((d, i) => (
            <text key={i} x={x(i)} y={H - PAD + 14} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {d.label.length > 8 ? d.label.slice(0, 8) + "…" : d.label}
            </text>
          ))}
        </svg>
      </div>
      {rows.length > 50 && <p className="text-xs faint">Charting the first 50 rows.</p>}
    </div>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="flex items-center gap-1.5 text-xs muted">
      {label}
      <select className="select !h-8 !w-auto !py-0" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
