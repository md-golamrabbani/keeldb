"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines, generateInClause, isNumeric } from "../lib/transformers";
import { OptionLabel, OptionInput, OptionSelect } from "../OptionField";
import Select from "@/components/ui/Select";

const EMPTY_OPTIONS = {};

export default function BulkWhereTool() {
  const selectedTool = "bulk-where";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [columnName, setColumnName] = useState(options.columnName || "id");
  const [format, setFormat] = useState<"in-clause" | "or-clause" | "and-clause">(options.format || "in-clause");
  const [quoteStyle, setQuoteStyle] = useState<"single" | "double" | "backtick" | "none">(options.quoteStyle || "none");

  const output = useMemo(() => {
    try {
      if (!input.trim() || !columnName.trim()) return "";

      const values = parseLines(input);
      if (values.length === 0) return "";

      const q = quoteStyle === "single" ? "'" : quoteStyle === "double" ? '"' : quoteStyle === "backtick" ? "`" : "";

      if (format === "in-clause") {
        const quoted = values.map((v) => (isNumeric(v) ? v : q ? `${q}${v}${q}` : v));
        return `${columnName} IN (${quoted.join(", ")})`;
      } else if (format === "or-clause") {
        const conditions = values.map((v) => {
          const val = isNumeric(v) ? v : q ? `${q}${v}${q}` : v;
          return `${columnName} = ${val}`;
        });
        return "(" + conditions.join(" OR ") + ")";
      } else if (format === "and-clause") {
        const conditions = values.map((v) => {
          const val = isNumeric(v) ? v : q ? `${q}${v}${q}` : v;
          return `${columnName} = ${val}`;
        });
        return conditions.join(" AND ");
      }
      return "";
    } catch (e) {
      return "";
    }
  }, [input, columnName, format, quoteStyle]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { columnName, format, quoteStyle });
  };

  return (
    <ToolContainer
      title="Bulk WHERE Builder"
      description="Generate reusable WHERE clauses from a list of values."
      inputPlaceholder="Paste values, one per line..."
      outputPlaceholder="WHERE clause will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <OptionLabel>Column Name</OptionLabel>
            <OptionInput
              value={columnName}
              onChange={setColumnName}
              placeholder="id"
            />
          </div>

          <div>
            <OptionLabel>Format</OptionLabel>
            <Select
              value={format}
              onValueChange={(e) => setFormat(e as any)}
              className="w-full"
              options={[
                { value: "in-clause", label: "IN clause" },
                { value: "or-clause", label: "OR clause" },
                { value: "and-clause", label: "AND clause" },
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
                { value: "none", label: "No quotes (auto-detect)" },
                { value: "single", label: "Single quotes (')" },
                { value: "double", label: 'Double quotes (")' },
                { value: "backtick", label: "Backticks (`)" },
              ]}
            />
          </div>
        </>
      }
    />
  );
}
