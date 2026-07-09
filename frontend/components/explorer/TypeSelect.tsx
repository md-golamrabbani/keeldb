"use client";
import { COLUMN_TYPES } from "@/lib/types";
import Combobox from "@/components/ui/Combobox";

/** Searchable column-type picker (shadcn-style combobox) over the full type
 * catalog — integers, decimals, text family, ENUM/SET, blobs, date/time, JSON,
 * UUID, network types… Typing anything not in the list uses it as a custom
 * type, so e.g. ENUM values can be edited freely. */
export default function TypeSelect({
  value, onChange, className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <Combobox
      className={className}
      value={value}
      onValueChange={onChange}
      allowCustom
      placeholder="Type…"
      searchPlaceholder="Search types (or type your own)…"
      options={COLUMN_TYPES.map((t) => ({ value: t }))}
    />
  );
}
