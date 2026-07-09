"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines, escapeQuotes } from "../lib/transformers";

const EMPTY_OPTIONS = {};

export default function SqlEscapingTool() {
  const selectedTool = "sql-escaping";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [escapeType, setEscapeType] = useState<"single-quote" | "backslash" | "both">(options.escapeType || "single-quote");
  const [processPerLine, setProcessPerLine] = useState(options.processPerLine !== false);

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";

      let result = input;
      let lines = processPerLine ? parseLines(input) : [input];

      if (processPerLine) {
        lines = lines.map((line) => {
          if (escapeType === "single-quote" || escapeType === "both") {
            line = line.replace(/'/g, "''");
          }
          if (escapeType === "backslash" || escapeType === "both") {
            line = line.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          }
          return line;
        });
        result = lines.join("\n");
      } else {
        if (escapeType === "single-quote" || escapeType === "both") {
          result = result.replace(/'/g, "''");
        }
        if (escapeType === "backslash" || escapeType === "both") {
          result = result.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        }
      }

      // Clean up control characters
      result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, (char) => {
        const code = char.charCodeAt(0);
        if (char === "\n" || char === "\r" || char === "\t") return char;
        return `\\x${code.toString(16).padStart(2, "0")}`;
      });

      return result;
    } catch (e) {
      return "";
    }
  }, [input, escapeType, processPerLine]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { escapeType, processPerLine });
  };

  return (
    <ToolContainer
      title="SQL Escaping Helper"
      description="Escape problematic values for manual SQL use. Handle quotes, backslashes, and control characters."
      inputPlaceholder="Paste text that needs SQL escaping..."
      outputPlaceholder="Escaped text will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <label className="text-sm font-medium block mb-2">Escape Type</label>
            <select
              value={escapeType}
              onChange={(e) => setEscapeType(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="single-quote">Single quotes (SQL)</option>
              <option value="backslash">Backslash (strings)</option>
              <option value="both">Both</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="process-per-line"
              checked={processPerLine}
              onChange={(e) => setProcessPerLine(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="process-per-line" className="text-sm font-medium cursor-pointer">
              Process per line
            </label>
          </div>
        </>
      }
    />
  );
}
