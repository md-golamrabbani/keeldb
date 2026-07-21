"use client";
import { useEffect } from "react";
import { toast } from "@/lib/toast";

type Cell = string | number | boolean | null;

export interface ColumnMenuState {
  x: number;
  y: number;
  column: string;
  colIndex: number;
}

/** SQL literal form for building an IN (…) list: quote strings, pass through
 * numbers/booleans, NULL for empty. */
function sqlLit(v: Cell): string {
  if (v === null || v === "") return "NULL";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Right-click menu for a table/result column header. Copy actions operate on
 * the currently-visible rows' values for that column. Sort/hide are optional. */
export default function ColumnMenu({
  state, values, onClose, onSortAsc, onSortDesc, onHide,
}: {
  state: ColumnMenuState | null;
  values: Cell[];
  onClose: () => void;
  onSortAsc?: () => void;
  onSortDesc?: () => void;
  onHide?: () => void;
}) {
  useEffect(() => {
    if (!state) return;
    const close = () => onClose();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", close);
    };
  }, [state, onClose]);

  if (!state) return null;

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast(label); }
    catch { toast("Copy failed"); }
    onClose();
  };
  const asText = (v: Cell) => (v == null ? "" : String(v));
  const distinct = Array.from(new Set(values.map(asText)));

  const item = (label: string, fn: () => void) => (
    <button className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--surface-2)]" onClick={fn}>
      {label}
    </button>
  );
  const sep = <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />;

  // Keep the menu inside the viewport.
  const left = Math.min(state.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 232);
  const top = Math.min(state.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 260);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 min-w-[13rem] max-w-[20rem] overflow-hidden rounded-lg border py-1 shadow-lg"
        style={{ top, left, background: "var(--surface)", boxShadow: "var(--shadow-lg)", borderColor: "var(--border)" }}
      >
        <div className="truncate px-3 py-1 font-mono text-xs faint" title={state.column}>{state.column}</div>
        {sep}
        {item("Copy column name", () => copy(state.column, "Column name copied"))}
        {item(`Copy ${values.length} value${values.length === 1 ? "" : "s"}`, () => copy(values.map(asText).join("\n"), "Values copied"))}
        {item(`Copy DISTINCT (${distinct.length})`, () => copy(distinct.join("\n"), "Distinct values copied"))}
        {item("Copy as IN (…) list", () => copy(`(${values.map(sqlLit).join(", ")})`, "IN-list copied"))}
        {(onSortAsc || onSortDesc || onHide) && sep}
        {onSortAsc && item("Sort ascending", () => { onSortAsc(); onClose(); })}
        {onSortDesc && item("Sort descending", () => { onSortDesc(); onClose(); })}
        {onHide && item("Hide column", () => { onHide(); onClose(); })}
      </div>
    </>
  );
}
