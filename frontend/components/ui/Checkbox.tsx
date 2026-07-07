"use client";
import * as RC from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// shadcn/ui-style checkbox (Radix). Drop-in for native <input type=checkbox>:
// use `checked` + `onCheckedChange`. Sizes to ~16px to match the old boxes.
export default function Checkbox({
  checked, onCheckedChange, disabled, className, ariaLabel, title,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
}) {
  return (
    <RC.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      style={{
        borderColor: checked ? "var(--accent)" : "var(--border-strong)",
        background: checked ? "var(--accent)" : "var(--surface)",
      }}
    >
      <RC.Indicator className="flex items-center justify-center" style={{ color: "var(--accent-fg)" }}>
        <Check width={12} height={12} strokeWidth={3} />
      </RC.Indicator>
    </RC.Root>
  );
}
