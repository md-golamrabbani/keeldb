"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseSimpleCSV, generateUpdateStatement } from "../lib/transformers";
import { OptionLabel, OptionInput } from "../OptionField";
import Select from "@/components/ui/Select";

const EMPTY_OPTIONS = {};

export default function BulkUpdateTool() {
  const selectedTool = "bulk-update";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [tableName, setTableName] = useState(options.tableName || "table_name");
  const [idColumn, setIdColumn] = useState(options.idColumn || "id");
  const [quoteStyle, setQuoteStyle] = useState<"single" | "double" | "backtick">(options.quoteStyle || "backtick");
  const [multiStatement, setMultiStatement] = useState(options.multiStatement === true);

  const output = useMemo(() => {
    try {
      if (!input.trim() || !tableName.trim() || !idColumn.trim()) return "";

      const rows = parseSimpleCSV(input.trim());
      if (rows.length === 0) return "";

      // First row is headers
      const headers = rows[0].map((h) => h.trim());
      const idIndex = headers.indexOf(idColumn);
      if (idIndex < 0) return `-- Error: Column "${idColumn}" not found`;

      const updates = rows.slice(1).map((row) => {
        const id = row[idIndex];
        const values: Record<string, string> = {};
        headers.forEach((header, idx) => {
          if (idx !== idIndex) {
            values[header] = row[idx] || "";
          }
        });
        return { id, values };
      });

      return generateUpdateStatement(tableName, idColumn, updates, {
        style: quoteStyle,
        multiStatement,
      });
    } catch (e) {
      return `-- Error: ${(e as any).message}`;
    }
  }, [input, tableName, idColumn, quoteStyle, multiStatement]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { tableName, idColumn, quoteStyle, multiStatement });
  };

  return (
    <ToolContainer
      title="Bulk Update Generator"
      description="Generate UPDATE statements with CASE or per-row updates from CSV data."
      inputPlaceholder="Paste CSV data. First row should be column headers including ID column..."
      outputPlaceholder="SQL UPDATE statements will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <OptionLabel>Table Name</OptionLabel>
            <OptionInput
              value={tableName}
              onChange={setTableName}
              placeholder="table_name"
            />
          </div>

          <div>
            <OptionLabel>ID Column</OptionLabel>
            <OptionInput
              value={idColumn}
              onChange={setIdColumn}
              placeholder="id"
            />
          </div>

          <div>
            <OptionLabel>Quote Style</OptionLabel>
            <Select
              value={quoteStyle}
              onValueChange={(e) => setQuoteStyle(e as any)}
              className="w-full"
              options={[
                { value: "single", label: "Single (')" },
                { value: "double", label: 'Double (")' },
                { value: "backtick", label: "Backtick (`)" },
              ]}
            />
          </div>
        </>
      }
    />
  );
}
