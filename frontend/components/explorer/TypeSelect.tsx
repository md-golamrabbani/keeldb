"use client";
import { COLUMN_TYPES } from "@/lib/types";

const CUSTOM = "__custom__";

/** A column-type dropdown of common SQL types, with a "Custom…" escape hatch
 * that reveals a free-text input (so uncommon types are still possible). */
export default function TypeSelect({
  value, onChange, className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const known = COLUMN_TYPES.includes(value);
  const isCustom = value !== "" && !known;

  return (
    <div className="flex items-center gap-1.5">
      <select
        className={`select ${className}`}
        value={isCustom ? CUSTOM : value}
        onChange={(e) => onChange(e.target.value === CUSTOM ? "" : e.target.value)}
      >
        {COLUMN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {isCustom && (
        <input
          className={`input font-mono ${className}`}
          autoFocus
          value={value}
          placeholder="e.g. VARCHAR(64)"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
