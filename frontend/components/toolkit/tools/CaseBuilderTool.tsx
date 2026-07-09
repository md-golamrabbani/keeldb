"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseSimpleCSV } from "../lib/transformers";

const EMPTY_OPTIONS = {};

export default function CaseBuilderTool() {
  const selectedTool = "case-builder";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [columnName, setColumnName] = useState(options.columnName || "status");
  const [resultColumn, setResultColumn] = useState(options.resultColumn || "result");
  const [dialect, setDialect] = useState<"sql" | "mysql" | "postgres">(options.dialect || "sql");

  const output = useMemo(() => {
    try {
      if (!input.trim() || !columnName.trim()) return "";

      const rows = parseSimpleCSV(input.trim());
      if (rows.length === 0) return "";

      // Each row is: when_value, then_value
      const whens = rows
        .map((row) => {
          if (row.length < 2) return null;
          const when = row[0].trim();
          const then = row[1].trim();
          return { when, then };
        })
        .filter(Boolean);

      if (whens.length === 0) return "";

      const whenClauses = whens.map((w) => `  WHEN '${w!.when.replace(/'/g, "''")}' THEN '${w!.then.replace(/'/g, "''")}'`).join("\n");

      return `CASE ${columnName}\n${whenClauses}\n  ELSE NULL\nEND AS ${resultColumn}`;
    } catch (e) {
      return "";
    }
  }, [input, columnName, resultColumn, dialect]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { columnName, resultColumn, dialect });
  };

  return (
    <ToolContainer
      title="CASE Expression Builder"
      description="Generate SQL CASE WHEN blocks from key-value mappings. Input: CSV with 'when_value, then_value' pairs."
      inputPlaceholder="Paste CSV data: when_value, then_value (one per line)"
      outputPlaceholder="SQL CASE expression will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <label className="text-sm font-medium block mb-2">Column to Check</label>
            <input
              type="text"
              value={columnName}
              onChange={(e) => setColumnName(e.target.value)}
              placeholder="status"
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Result Alias</label>
            <input
              type="text"
              value={resultColumn}
              onChange={(e) => setResultColumn(e.target.value)}
              placeholder="result"
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">SQL Dialect</label>
            <select
              value={dialect}
              onChange={(e) => setDialect(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="sql">Standard SQL</option>
              <option value="mysql">MySQL</option>
              <option value="postgres">PostgreSQL</option>
            </select>
          </div>
        </>
      }
    />
  );
}
