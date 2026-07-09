"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseSimpleCSV, parseLines, generateInsertStatement } from "../lib/transformers";
import { OptionLabel, OptionInput, OptionCheckbox } from "../OptionField";
import Select from "@/components/ui/Select";

const EMPTY_OPTIONS = {};

export default function BulkInsertTool() {
  const selectedTool = "bulk-insert";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [tableName, setTableName] = useState(options.tableName || "table_name");
  const [columns, setColumns] = useState(options.columns || "id, name, value");
  const [quoteStyle, setQuoteStyle] = useState<"single" | "double" | "backtick">(options.quoteStyle || "backtick");
  const [multiRow, setMultiRow] = useState(options.multiRow !== false);
  const [statementType, setStatementType] = useState<"insert" | "insert-ignore" | "replace">(options.statementType || "insert");
  const [delimiter, setDelimiter] = useState<"comma" | "tab">(options.delimiter || "comma");

  const output = useMemo(() => {
    try {
      if (!input.trim() || !tableName.trim() || !columns.trim()) return "";

      // Parse input
      let rows: string[][];
      if (delimiter === "tab") {
        rows = input
          .trim()
          .split("\n")
          .map((line) => line.split("\t").map((v) => v.trim()));
      } else {
        rows = parseSimpleCSV(input.trim());
      }

      const colArray = columns.split(",").map((c: string) => c.trim());

      if (rows.length === 0) return "";

      // Handle first row as header or data
      let dataRows = rows;
      if (rows.length > 0 && rows[0].length === colArray.length) {
        // Assume first row might be data, not header
        dataRows = rows;
      }

      return generateInsertStatement(tableName, colArray, dataRows, {
        style: quoteStyle,
        quoteStrings: true,
        multiRow,
        statementType,
      });
    } catch (e) {
      return `-- Error: ${(e as any).message}`;
    }
  }, [input, tableName, columns, quoteStyle, multiRow, statementType, delimiter]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { tableName, columns, quoteStyle, multiRow, statementType, delimiter });
  };

  return (
    <ToolContainer
      title="Bulk Insert Generator"
      description="Generate SQL INSERT statements from CSV, TSV, or spreadsheet-like data."
      inputPlaceholder="Paste CSV data (comma or tab-separated)..."
      outputPlaceholder="SQL INSERT statements will appear here..."
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
            <OptionLabel>Column Names</OptionLabel>
            <OptionInput
              value={columns}
              onChange={setColumns}
              placeholder="id, name, value"
            />
          </div>

          <div>
            <OptionLabel>Delimiter</OptionLabel>
            <Select
              value={delimiter}
              onValueChange={(e) => setDelimiter(e as any)}
              className="w-full"
              options={[
                { value: "comma", label: "Comma (CSV)" },
                { value: "tab", label: "Tab (TSV)" },
              ]}
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

          <div>
            <OptionLabel>Statement Type</OptionLabel>
            <Select
              value={statementType}
              onValueChange={(e) => setStatementType(e as any)}
              className="w-full"
              options={[
                { value: "insert", label: "INSERT INTO" },
                { value: "insert-ignore", label: "INSERT IGNORE INTO" },
                { value: "replace", label: "REPLACE INTO" },
              ]}
            />
          </div>

          <OptionCheckbox checked={multiRow} onChange={setMultiRow} label="Multi-row statement" />
        </>
      }
    />
  );
}
