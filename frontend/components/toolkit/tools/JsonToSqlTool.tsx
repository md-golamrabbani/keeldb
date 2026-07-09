"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { jsonToRows, generateInsertStatement } from "../lib/transformers";

const EMPTY_OPTIONS = {};

export default function JsonToSqlTool() {
  const selectedTool = "json-to-sql";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [tableName, setTableName] = useState(options.tableName || "table_name");
  const [quoteStyle, setQuoteStyle] = useState<"single" | "double" | "backtick">(options.quoteStyle || "backtick");
  const [multiRow, setMultiRow] = useState(options.multiRow !== false);
  const [error, setError] = useState("");

  const output = useMemo(() => {
    try {
      setError("");
      if (!input.trim() || !tableName.trim()) return "";

      const rows = jsonToRows(input.trim());
      if (rows.length <= 1) return "-- No data rows found";

      const [columns, ...dataRows] = rows;

      return generateInsertStatement(tableName, columns, dataRows, {
        style: quoteStyle,
        quoteStrings: true,
        multiRow,
        statementType: "insert",
      });
    } catch (e) {
      const msg = (e as any).message;
      setError(msg);
      return "";
    }
  }, [input, tableName, quoteStyle, multiRow]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { tableName, quoteStyle, multiRow });
  };

  return (
    <ToolContainer
      title="JSON to SQL Converter"
      description="Convert JSON arrays of objects to SQL INSERT statements."
      inputPlaceholder='Paste JSON array of objects like [{"name":"John","age":30},...]'
      outputPlaceholder="SQL INSERT statements will appear here..."
      input={input}
      output={output}
      error={error}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <label className="text-sm font-medium block mb-2">Table Name</label>
            <input
              type="text"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="table_name"
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Quote Style</label>
            <select
              value={quoteStyle}
              onChange={(e) => setQuoteStyle(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="single">Single (')</option>
              <option value="double">Double (")</option>
              <option value="backtick">Backtick (`)</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="multi-row"
              checked={multiRow}
              onChange={(e) => setMultiRow(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="multi-row" className="text-sm font-medium cursor-pointer">
              Multi-row statement
            </label>
          </div>
        </>
      }
    />
  );
}
