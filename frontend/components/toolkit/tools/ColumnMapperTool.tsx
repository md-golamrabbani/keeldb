"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseSimpleCSV } from "../lib/transformers";

const EMPTY_OPTIONS = {};

export default function ColumnMapperTool() {
  const selectedTool = "column-mapper";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [format, setFormat] = useState<"csv" | "json">(options.format || "csv");
  const [includeHeaders, setIncludeHeaders] = useState(options.includeHeaders !== false);

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";

      const rows = parseSimpleCSV(input.trim());
      if (rows.length === 0) return "";

      // First row is source columns, second row is target columns
      if (rows.length < 2) return "-- Need at least 2 rows: source columns and target columns";

      const sourceHeaders = rows[0];
      const targetHeaders = rows[1];

      if (sourceHeaders.length !== targetHeaders.length) {
        return "-- Column count mismatch between source and target";
      }

      const dataRows = rows.slice(2);

      if (format === "csv") {
        let result = "";
        if (includeHeaders) {
          result = targetHeaders.join(",") + "\n";
        }
        result += dataRows.map((row) => row.join(",")).join("\n");
        return result;
      } else if (format === "json") {
        const jsonRows = dataRows.map((row) => {
          const obj: Record<string, string> = {};
          targetHeaders.forEach((header, idx) => {
            obj[header] = row[idx] || "";
          });
          return obj;
        });
        return JSON.stringify(jsonRows, null, 2);
      }

      return "";
    } catch (e) {
      return "";
    }
  }, [input, format, includeHeaders]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { format, includeHeaders });
  };

  return (
    <ToolContainer
      title="Column Mapper"
      description="Map source columns to target columns, rename, reorder, or drop fields."
      inputPlaceholder="Paste CSV: Row 1 = source columns, Row 2 = target names, Row 3+ = data"
      outputPlaceholder="Mapped data will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <label className="text-sm font-medium block mb-2">Output Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="include-headers"
              checked={includeHeaders}
              onChange={(e) => setIncludeHeaders(e.target.checked)}
              disabled={format === "json"}
              className="rounded disabled:opacity-50"
            />
            <label htmlFor="include-headers" className="text-sm font-medium cursor-pointer">
              Include headers
            </label>
          </div>
        </>
      }
    />
  );
}
