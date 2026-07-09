"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseSimpleCSV, generateInsertStatement } from "../lib/transformers";

const EMPTY_OPTIONS = {};

export default function CsvToSqlTool() {
  const selectedTool = "csv-to-sql";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [tableName, setTableName] = useState(options.tableName || "table_name");
  const [hasHeader, setHasHeader] = useState(options.hasHeader !== false);
  const [quoteStyle, setQuoteStyle] = useState<"single" | "double" | "backtick">(options.quoteStyle || "backtick");
  const [multiRow, setMultiRow] = useState(options.multiRow !== false);

  const output = useMemo(() => {
    try {
      if (!input.trim() || !tableName.trim()) return "";

      const rows = parseSimpleCSV(input.trim());
      if (rows.length === 0) return "";

      let columns: string[];
      let dataRows: string[][];

      if (hasHeader && rows.length > 0) {
        columns = rows[0].map((h) => h.trim());
        dataRows = rows.slice(1);
      } else {
        // Auto-generate column names
        if (rows.length === 0) return "";
        const numCols = rows[0].length;
        columns = Array.from({ length: numCols }, (_, i) => `col_${i + 1}`);
        dataRows = rows;
      }

      if (dataRows.length === 0) return "";

      return generateInsertStatement(tableName, columns, dataRows, {
        style: quoteStyle,
        quoteStrings: true,
        multiRow,
        statementType: "insert",
      });
    } catch (e) {
      return `-- Error: ${(e as any).message}`;
    }
  }, [input, tableName, hasHeader, quoteStyle, multiRow]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { tableName, hasHeader, quoteStyle, multiRow });
  };

  return (
    <ToolContainer
      title="CSV to SQL Converter"
      description="Convert CSV data to SQL INSERT statements."
      inputPlaceholder="Paste CSV data..."
      outputPlaceholder="SQL INSERT statements will appear here..."
      input={input}
      output={output}
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
              id="has-header"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="has-header" className="text-sm font-medium cursor-pointer">
              First row is header
            </label>
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
