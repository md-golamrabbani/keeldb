"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines } from "../lib/transformers";

const EMPTY_OPTIONS = {};

export default function SqlPlaceholdersTool() {
  const selectedTool = "sql-placeholder";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [placeholderStyle, setPlaceholderStyle] = useState<"?" | "$" | ":">(options.placeholderStyle || "?");
  const [startIndex, setStartIndex] = useState(options.startIndex || "1");

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";

      const lines = parseLines(input);
      const count = lines.length;
      const start = parseInt(startIndex, 10) || 1;

      if (placeholderStyle === "?") {
        return Array(count).fill("?").join(", ");
      } else if (placeholderStyle === "$") {
        return Array.from({ length: count }, (_, i) => `$${start + i}`).join(", ");
      } else if (placeholderStyle === ":") {
        return Array.from({ length: count }, (_, i) => `:id${start + i}`).join(", ");
      }

      return "";
    } catch (e) {
      return "";
    }
  }, [input, placeholderStyle, startIndex]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { placeholderStyle, startIndex });
  };

  return (
    <ToolContainer
      title="SQL Placeholder Builder"
      description="Generate placeholders for prepared statements. Supports ?, $1-$n, and :id1-:idn styles."
      inputPlaceholder="Paste values (one per line) to count..."
      outputPlaceholder="SQL placeholders will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <label className="text-sm font-medium block mb-2">Placeholder Style</label>
            <select
              value={placeholderStyle}
              onChange={(e) => setPlaceholderStyle(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="?">? (MySQL, SQLite)</option>
              <option value="$">$1, $2, ... (PostgreSQL)</option>
              <option value=":">:id1, :id2, ... (Named)</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Start Index</label>
            <input
              type="number"
              value={startIndex}
              onChange={(e) => setStartIndex(e.target.value)}
              placeholder="1"
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            />
          </div>
        </>
      }
    />
  );
}
