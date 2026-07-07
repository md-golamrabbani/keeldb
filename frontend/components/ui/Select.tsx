"use client";
import * as RS from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

// shadcn/ui-style Select (Radix): a styled trigger + a custom popover list with
// check indicators — replaces the native <select> where we want the polished look.
export default function Select({
  value, onValueChange, options, placeholder, className, disabled, ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <RS.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <RS.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-9 items-center justify-between gap-2 rounded-lg border px-3 text-sm outline-none transition-colors",
          "focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        style={{ background: "var(--surface)", borderColor: "var(--border-strong)", color: "var(--text)" }}
      >
        <RS.Value placeholder={placeholder} />
        <RS.Icon><ChevronDown size={15} style={{ color: "var(--text-faint)" }} /></RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={4}
          className="z-[60] overflow-hidden rounded-lg border"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border-strong)",
            boxShadow: "var(--shadow-lg)",
            minWidth: "var(--radix-select-trigger-width)",
            maxHeight: "min(20rem, var(--radix-select-content-available-height))",
          }}
        >
          <RS.Viewport className="p-1">
            {options.map((o) => (
              <RS.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-7 pr-3 text-sm outline-none data-[highlighted]:bg-[var(--accent-soft)] data-[highlighted]:text-[var(--accent)]"
              >
                <RS.ItemIndicator className="absolute left-1.5 inline-flex"><Check size={14} /></RS.ItemIndicator>
                <RS.ItemText>{o.label}</RS.ItemText>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
