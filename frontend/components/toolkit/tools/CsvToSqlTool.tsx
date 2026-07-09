"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseSimpleCSV, generateInsertStatement } from "../lib/transformers";
import { OptionLabel, OptionInput, OptionCheckbox } from "../OptionField";
import Select from "@/components/ui/Select";

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
            <OptionLabel>Table Name</OptionLabel>
            <OptionInput value={tableName} onChange={setTableName} placeholder="table_name" />
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

          <OptionCheckbox checked={hasHeader} onChange={setHasHeader} label="First row is header" />
          <OptionCheckbox checked={multiRow} onChange={setMultiRow} label="Multi-row statement" />
        </>
      }
    />
  );
}
