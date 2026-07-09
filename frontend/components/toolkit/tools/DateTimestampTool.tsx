"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines } from "../lib/transformers";
import { OptionLabel } from "../OptionField";
import Select from "@/components/ui/Select";

const EMPTY_OPTIONS = {};

export default function DateTimestampTool() {
  const selectedTool = "date-timestamp";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [convertMode, setConvertMode] = useState<"unix-to-date" | "date-to-unix" | "to-iso">(options.convertMode || "unix-to-date");
  const [format, setFormat] = useState<"milliseconds" | "seconds">(options.format || "seconds");

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";

      const lines = parseLines(input);
      return lines
        .map((line) => {
          const val = line.trim();

          if (convertMode === "unix-to-date") {
            const num = parseInt(val, 10);
            if (isNaN(num)) return val;
            const ms = format === "seconds" ? num * 1000 : num;
            const date = new Date(ms);
            return date.toISOString();
          } else if (convertMode === "date-to-unix") {
            const date = new Date(val);
            if (isNaN(date.getTime())) return val;
            const timestamp = format === "seconds" ? Math.floor(date.getTime() / 1000) : date.getTime();
            return String(timestamp);
          } else if (convertMode === "to-iso") {
            const date = new Date(val);
            if (isNaN(date.getTime())) return val;
            return date.toISOString();
          }

          return val;
        })
        .join("\n");
    } catch (e) {
      return "";
    }
  }, [input, convertMode, format]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { convertMode, format });
  };

  return (
    <ToolContainer
      title="Date / Timestamp Converter"
      description="Convert between Unix timestamps and human-readable dates, ISO-8601 formatting."
      inputPlaceholder="Paste timestamps or dates, one per line..."
      outputPlaceholder="Converted dates/timestamps will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <OptionLabel>Convert Mode</OptionLabel>
            <Select
              value={convertMode}
              onValueChange={(e) => setConvertMode(e as any)}
              className="w-full"
              options={[
                { value: "unix-to-date", label: "Unix timestamp → Date" },
                { value: "date-to-unix", label: "Date → Unix timestamp" },
                { value: "to-iso", label: "→ ISO-8601" },
              ]}
            />
          </div>

          <div>
            <OptionLabel>Timestamp Format</OptionLabel>
            <Select
              value={format}
              onValueChange={(e) => setFormat(e as any)}
              disabled={convertMode === "to-iso"}
              className="w-full"
              options={[
                { value: "seconds", label: "Seconds" },
                { value: "milliseconds", label: "Milliseconds" },
              ]}
            />
          </div>
        </>
      }
    />
  );
}
