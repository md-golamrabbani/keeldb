"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { expandRange, compressRange } from "../lib/transformers";

const EMPTY_OPTIONS = {};

export default function RangeExpanderTool() {
  const selectedTool = "range-expander";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [mode, setMode] = useState<"expand" | "compress">(options.mode || "expand");
  const [delimiter, setDelimiter] = useState<"comma" | "newline">(options.delimiter || "comma");

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";

      if (mode === "expand") {
        const expanded = expandRange(input, delimiter === "comma" ? "comma" : "newline");
        return expanded.join(delimiter === "comma" ? ", " : "\n");
      } else {
        const values = input.split(delimiter === "comma" ? "," : "\n").map((v) => v.trim());
        return compressRange(values);
      }
    } catch (e) {
      return "";
    }
  }, [input, mode, delimiter]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { mode, delimiter });
  };

  return (
    <ToolContainer
      title="Range Expander / Compressor"
      description="Expand ranges (1-5 → 1,2,3,4,5) or compress lists back into ranges."
      inputPlaceholder={mode === "expand" ? "Paste ranges like: 1-5, 10, 12-15" : "Paste numbers, one per line or comma-separated..."}
      outputPlaceholder="Expanded or compressed output will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <label className="text-sm font-medium block mb-2">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="expand">Expand ranges</option>
              <option value="compress">Compress to ranges</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Output Format</label>
            <select
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="comma">Comma-separated</option>
              <option value="newline">Newline-separated</option>
            </select>
          </div>
        </>
      }
    />
  );
}
