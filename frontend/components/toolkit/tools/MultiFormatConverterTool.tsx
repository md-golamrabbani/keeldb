"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines, deduplicate } from "../lib/transformers";
import { OptionLabel } from "../OptionField";
import Select from "@/components/ui/Select";

const EMPTY_OPTIONS = {};

export default function MultiFormatConverterTool() {
  const selectedTool = "multi-format-converter";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [outputFormat, setOutputFormat] = useState<"csv" | "json" | "sql-in" | "plaintext" | "sql-array">(options.outputFormat || "csv");

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";

      const lines = parseLines(input);
      const clean = deduplicate(lines);

      if (outputFormat === "csv") {
        return clean.join(",");
      } else if (outputFormat === "json") {
        return JSON.stringify(clean, null, 2);
      } else if (outputFormat === "sql-in") {
        return "IN (" + clean.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ") + ")";
      } else if (outputFormat === "sql-array") {
        return "'{" + clean.join(",") + "}'";
      } else if (outputFormat === "plaintext") {
        return clean.join("\n");
      }
      return "";
    } catch (e) {
      return "";
    }
  }, [input, outputFormat]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { outputFormat });
  };

  return (
    <ToolContainer
      title="Multi-Format Converter"
      description="Quick conversion between CSV, JSON, SQL lists, plaintext, and PostgreSQL arrays."
      inputPlaceholder="Paste values, one per line..."
      outputPlaceholder="Converted output will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <div>
          <OptionLabel>Output Format</OptionLabel>
          <Select
            value={outputFormat}
            onValueChange={(e) => setOutputFormat(e as any)}
            className="w-full"
            options={[
              { value: "plaintext", label: "Plaintext (one per line)" },
              { value: "csv", label: "CSV (comma-separated)" },
              { value: "json", label: "JSON array" },
              { value: "sql-in", label: "SQL IN clause" },
              { value: "sql-array", label: "PostgreSQL array format" },
            ]}
          />
        </div>
      }
    />
  );
}
