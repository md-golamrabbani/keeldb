"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@/components/icons";

export type DateKind = "date" | "datetime" | "time";

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Parts { y: number; mo: number; d: number; h: number; mi: number; s: number }

const int = (x: string | undefined) => parseInt(x ?? "", 10) || 0; // tolerant of ".123456+00" suffixes

function parseValue(kind: DateKind, v: string): Parts {
  const now = new Date();
  const p: Parts = { y: now.getFullYear(), mo: now.getMonth(), d: now.getDate(), h: 0, mi: 0, s: 0 };
  if (!v) return p;
  if (kind === "time") {
    const [h, mi, s] = v.split(":");
    return { ...p, h: int(h), mi: int(mi), s: int(s) };
  }
  const [datePart, timePart] = v.replace("T", " ").trim().split(/\s+/);
  const [y, mo, d] = (datePart || "").split("-");
  if (y) p.y = int(y) || p.y;
  if (mo) p.mo = Math.min(11, Math.max(0, (int(mo) || 1) - 1));
  if (d) p.d = int(d) || p.d;
  if (timePart) {
    const [h, mi, s] = timePart.split(":");
    p.h = int(h); p.mi = int(mi); p.s = int(s);
  }
  return p;
}

function format(kind: DateKind, p: Parts): string {
  const date = `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}`;
  const time = `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
  if (kind === "date") return date;
  if (kind === "time") return time;
  return `${date} ${time}`;
}

/** Self-contained date / datetime / time picker — reliable in the desktop
 * webview where the native pickers misbehave. Month + year navigation, a day
 * grid, and (for datetime/time) hour/minute/second fields. `value === ""` means
 * NULL. Commits on Apply / day-click (date-only) and on outside click. */
export default function DatePicker({
  kind, value, onChange, onCommit, onCancel, nullable = true, className = "", autoOpen = false,
}: {
  kind: DateKind;
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  onCancel?: () => void;
  nullable?: boolean;
  className?: string;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [parts, setParts] = useState<Parts>(() => parseValue(kind, value));
  // The month currently shown in the calendar (independent of the selected day).
  const [view, setView] = useState<{ y: number; mo: number }>(() => {
    const p = parseValue(kind, value);
    return { y: p.y, mo: p.mo };
  });
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const hasValue = value !== "";

  // Re-sync when the external value changes (e.g. a different cell).
  useEffect(() => { setParts(parseValue(kind, value)); }, [kind, value]);

  const place = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 260;
    const left = Math.min(r.left, window.innerWidth - width - 8);
    let top = r.bottom + 4;
    const estH = kind === "date" ? 300 : kind === "time" ? 120 : 360;
    if (top + estH > window.innerHeight) top = Math.max(8, r.top - estH - 4);
    setPos({ top, left });
  };
  useEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (p: Parts) => { const v = format(kind, p); onChange(v); onCommit?.(v); };
  const emit = (p: Parts) => { setParts(p); onChange(format(kind, p)); };

  // Calendar grid: 6 weeks starting on the Sunday on/before the 1st.
  const cells = useMemo(() => {
    const first = new Date(view.y, view.mo, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      return dt;
    });
  }, [view]);

  const today = new Date();
  const isSameDay = (dt: Date) => hasValue && dt.getFullYear() === parts.y && dt.getMonth() === parts.mo && dt.getDate() === parts.d;

  const pickDay = (dt: Date) => {
    const p = { ...parts, y: dt.getFullYear(), mo: dt.getMonth(), d: dt.getDate() };
    setView({ y: p.y, mo: p.mo });
    if (kind === "date") { commit(p); setOpen(false); }
    else emit(p);
  };

  const stepMonth = (delta: number) => setView((v) => {
    const dt = new Date(v.y, v.mo + delta, 1);
    return { y: dt.getFullYear(), mo: dt.getMonth() };
  });
  const stepYear = (delta: number) => setView((v) => ({ ...v, y: v.y + delta }));

  const timeField = (label: string, key: "h" | "mi" | "s", max: number) => (
    <label className="flex flex-1 flex-col items-center gap-0.5">
      <span className="text-[10px] uppercase tracking-wide faint">{label}</span>
      <input type="number" min={0} max={max}
        className="input !h-8 w-full !px-1 text-center text-sm"
        value={pad(parts[key])}
        onChange={(e) => {
          let n = parseInt(e.target.value.replace(/\D/g, ""), 10);
          if (isNaN(n)) n = 0;
          n = Math.min(max, Math.max(0, n));
          emit({ ...parts, [key]: n });
        }} />
    </label>
  );

  const close = (apply: boolean) => {
    setOpen(false);
    if (apply) commit(parts);
    else onCancel?.();
  };

  return (
    <div ref={anchorRef} className="relative">
      <input
        readOnly
        className={`input cursor-pointer ${className}`}
        value={hasValue ? format(kind, parts) : ""}
        placeholder={nullable ? "null" : "pick…"}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Escape") close(false); if (e.key === "Enter") close(true); }}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => close(true)} onContextMenu={(e) => { e.preventDefault(); close(true); }} />
          <div className="fixed z-50 w-[260px] rounded-xl border p-2.5 shadow-lg"
            style={{ top: pos.top, left: pos.left, background: "var(--surface)", boxShadow: "var(--shadow-lg)", borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}>
            {kind !== "time" && (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-0.5">
                    <button className="btn btn-ghost !p-1" onClick={() => stepMonth(-1)} aria-label="Previous month"><IconChevronLeft width={15} height={15} /></button>
                    <span className="w-[5.5rem] text-center text-sm font-semibold">{MONTHS[view.mo]}</span>
                    <button className="btn btn-ghost !p-1" onClick={() => stepMonth(1)} aria-label="Next month"><IconChevronRight width={15} height={15} /></button>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button className="btn btn-ghost !p-1" onClick={() => stepYear(-1)} aria-label="Previous year"><IconChevronLeft width={15} height={15} /></button>
                    <span className="w-10 text-center text-sm font-semibold">{view.y}</span>
                    <button className="btn btn-ghost !p-1" onClick={() => stepYear(1)} aria-label="Next year"><IconChevronRight width={15} height={15} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {DOW.map((d) => <div key={d} className="py-1 text-[10px] font-semibold uppercase faint">{d}</div>)}
                  {cells.map((dt, i) => {
                    const other = dt.getMonth() !== view.mo;
                    const sel = isSameDay(dt);
                    const isToday = dt.toDateString() === today.toDateString();
                    return (
                      <button key={i} onClick={() => pickDay(dt)}
                        className="rounded-md py-1.5 text-xs transition-colors hover:bg-[var(--surface-2)]"
                        style={sel
                          ? { background: "var(--accent)", color: "#fff", fontWeight: 600 }
                          : { color: other ? "var(--text-faint)" : "var(--text)", ...(isToday ? { border: "1px solid var(--accent)" } : {}) }}>
                        {dt.getDate()}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {(kind === "datetime" || kind === "time") && (
              <div className={`flex items-end gap-1.5 ${kind === "datetime" ? "mt-2.5 border-t pt-2.5" : ""}`} style={{ borderColor: "var(--border)" }}>
                {timeField("HH", "h", 23)}
                <span className="pb-1.5 font-semibold faint">:</span>
                {timeField("MM", "mi", 59)}
                <span className="pb-1.5 font-semibold faint">:</span>
                {timeField("SS", "s", 59)}
              </div>
            )}
            <div className="mt-2.5 flex items-center gap-2 border-t pt-2.5" style={{ borderColor: "var(--border)" }}>
              <button className="text-xs font-medium" style={{ color: "var(--accent)" }}
                onClick={() => { const n = new Date(); const p = { y: n.getFullYear(), mo: n.getMonth(), d: n.getDate(), h: n.getHours(), mi: n.getMinutes(), s: n.getSeconds() }; setView({ y: p.y, mo: p.mo }); if (kind === "date") { commit(p); setOpen(false); } else emit(p); }}>
                {kind === "time" ? "Now" : "Today"}
              </button>
              {nullable && (
                <button className="text-xs muted hover:underline" onClick={() => { onChange(""); onCommit?.(""); setOpen(false); }}>Clear</button>
              )}
              <button className="btn btn-primary btn-sm !h-7 ml-auto" onClick={() => close(true)}>Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
