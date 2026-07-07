"use client";
import { COLUMN_TYPES } from "@/lib/types";
import Select from "@/components/ui/Select";

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
      <Select
        className={className}
        value={isCustom ? CUSTOM : value}
        onValueChange={(v) => onChange(v === CUSTOM ? "" : v)}
        options={[...COLUMN_TYPES.map((t) => ({ value: t, label: t })), { value: CUSTOM, label: "Custom…" }]}
      />
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
