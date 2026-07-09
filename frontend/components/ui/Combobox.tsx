"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboOption {
  value: string;
  label?: string;
  hint?: string;
}

// shadcn/ui-style Combobox (Radix Popover + filter input): a searchable select.
// With allowCustom, whatever is typed can be chosen even if it matches no option.
export default function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No match.",
  allowCustom = false,
  className,
  disabled,
  ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowCustom?: boolean;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.value.toLowerCase().includes(q) || (o.label ?? "").toLowerCase().includes(q),
    );
  }, [options, query]);

  const showCustom = allowCustom && query.trim() && !options.some((o) => o.value === query.trim());
  const total = filtered.length + (showCustom ? 1 : 0);

  useEffect(() => { setActive(0); }, [query, open]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (v: string) => {
    onValueChange(v);
    setOpen(false);
    setQuery("");
  };

  const current = options.find((o) => o.value === value);

  return (
    // modal: registers the list as its own scroll container so the wheel works
    // even when the combobox is rendered inside a (scroll-locking) dialog.
    <Popover.Root modal open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <Popover.Trigger
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          "inline-flex h-9 items-center justify-between gap-2 rounded-lg border px-3 text-sm outline-none transition-colors",
          "focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        style={{ background: "var(--surface)", borderColor: "var(--border-strong)", color: value ? "var(--text)" : "var(--text-faint)" }}
      >
        <span className="truncate">{current?.label ?? (value || placeholder)}</span>
        <ChevronsUpDown size={14} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[70] overflow-hidden rounded-lg border"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border-strong)",
            boxShadow: "var(--shadow-lg)",
            width: "max(var(--radix-popover-trigger-width), 14rem)",
          }}
        >
          <input
            autoFocus
            className="w-full border-b px-3 py-2 text-sm outline-none"
            style={{ background: "transparent", borderColor: "var(--border)", color: "var(--text)" }}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(total - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") {
                e.preventDefault();
                if (showCustom && active === filtered.length) pick(query.trim());
                else if (filtered[active]) pick(filtered[active].value);
              } else if (e.key === "Escape") setOpen(false);
            }}
          />
          <div ref={listRef} className="overscroll-contain p-1"
            style={{ maxHeight: "min(16rem, calc(var(--radix-popover-content-available-height, 20rem) - 3rem))", overflowY: "auto" }}>
            {filtered.map((o, i) => (
              <button
                key={o.value}
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
                className="relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-7 pr-3 text-left text-sm outline-none"
                style={i === active ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text)" }}
              >
                {o.value === value && <Check size={14} className="absolute left-1.5" />}
                <span className="truncate">{o.label ?? o.value}</span>
                {o.hint && <span className="ml-auto pl-3 text-xs faint">{o.hint}</span>}
              </button>
            ))}
            {showCustom && (
              <button
                data-idx={filtered.length}
                onMouseEnter={() => setActive(filtered.length)}
                onClick={() => pick(query.trim())}
                className="flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-7 pr-3 text-left text-sm"
                style={active === filtered.length ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text)" }}
              >
                Use “{query.trim()}”
              </button>
            )}
            {total === 0 && <p className="px-3 py-2 text-sm muted">{emptyText}</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
