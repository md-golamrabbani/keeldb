"use client";
import { ReactNode } from "react";
import Select, { SelectOption } from "@/components/ui/Select";
import Checkbox from "@/components/ui/Checkbox";

export function OptionLabel({ children }: { children: ReactNode }) {
  return <label className="label block mb-2 text-sm">{children}</label>;
}

export function OptionInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="input"
    />
  );
}

export function OptionSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder}
      className="w-full"
    />
  );
}

export function OptionCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <div
      className="flex items-center gap-2 cursor-pointer"
      onClick={() => onChange(!checked)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onChange(!checked);
        }
      }}
    >
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <label className="text-sm font-medium cursor-pointer flex-1">{label}</label>
    </div>
  );
}
