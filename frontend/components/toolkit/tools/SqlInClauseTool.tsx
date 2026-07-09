"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseDelimitedValues, generateInClause, deduplicate, isNumeric } from "../lib/transformers";
import { OptionLabel, OptionSelect, OptionCheckbox } from "../OptionField";
import Select from "@/components/ui/Select";
import Checkbox from "@/components/ui/Checkbox";

const EMPTY_OPTIONS = {};

export default function SqlInClauseTool() {
  const selectedTool = "sql-in-clause";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [delimiter, setDelimiter] = useState<"comma" | "newline" | "tab" | "space">(options.delimiter || "comma");
  const [quoteStrings, setQuoteStrings] = useState(options.quoteStrings !== false);
  const [quoteStyle, setQuoteStyle] = useState<"single" | "double" | "backtick">(options.quoteStyle || "single");
  const [format, setFormat] = useState<"inline" | "multiline">(options.format || "inline");
  const [deduplicate_, setDeduplicate] = useState(options.deduplicate !== false);
  const [outputFormat, setOutputFormat] = useState<"in-clause" | "csv" | "json" | "postgres-array">(options.outputFormat || "in-clause");

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";

      let values = parseDelimitedValues(input, delimiter);
      if (deduplicate_) {
        values = deduplicate(values);
      }

      if (outputFormat === "in-clause") {
        return generateInClause(values, quoteStrings, quoteStyle, format);
      } else if (outputFormat === "csv") {
        return values.join(",");
      } else if (outputFormat === "json") {
        return JSON.stringify(values, null, 2);
      } else if (outputFormat === "postgres-array") {
        const quoted = values.map((v) => {
          if (isNumeric(v)) return v;
          return `"${v.replace(/"/g, '\\"')}"`;
        });
        return `'{${quoted.join(",")}}'`;
      }
      return "";
    } catch (e) {
      return "";
    }
  }, [input, delimiter, quoteStrings, quoteStyle, format, deduplicate_, outputFormat]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleClear = () => {
    updateInput(selectedTool, "");
  };

  const handleOptionsChange = () => {
    updateOptions(selectedTool, { delimiter, quoteStrings, quoteStyle, format, deduplicate: deduplicate_, outputFormat });
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    handleOptionsChange();
  };

  return (
    <ToolContainer
      title="SQL IN-Clause Formatter"
      description="Convert pasted values into SQL IN lists. Supports numbers, strings, UUIDs, emails, etc."
      inputPlaceholder="Paste values separated by commas, newlines, tabs, or spaces..."
      outputPlaceholder="SQL IN clause will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={handleClear}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <OptionLabel>Input Separator</OptionLabel>
            <Select
              value={delimiter}
              onValueChange={(e) => setDelimiter(e as any)}
              className="w-full"
              options={[
                { value: "comma", label: "Comma" },
                { value: "newline", label: "Newline" },
                { value: "tab", label: "Tab" },
                { value: "space", label: "Space" },
              ]}
            />
          </div>

          <div>
            <OptionLabel>Quote Style</OptionLabel>
            <Select
              value={quoteStyle}
              onValueChange={(e) => setQuoteStyle(e as any)}
              disabled={!quoteStrings}
              className="w-full"
              options={[
                { value: "single", label: "Single (')" },
                { value: "double", label: 'Double (")' },
                { value: "backtick", label: "Backtick (`)" },
              ]}
            />
          </div>

          <div>
            <OptionLabel>Output Format</OptionLabel>
            <Select
              value={outputFormat}
              onValueChange={(e) => setOutputFormat(e as any)}
              className="w-full"
              options={[
                { value: "in-clause", label: "IN Clause" },
                { value: "csv", label: "CSV" },
                { value: "json", label: "JSON Array" },
                { value: "postgres-array", label: "PostgreSQL Array" },
              ]}
            />
          </div>

          <div>
            <OptionLabel>Display Format</OptionLabel>
            <Select
              value={format}
              onValueChange={(e) => setFormat(e as any)}
              disabled={outputFormat !== "in-clause"}
              className="w-full"
              options={[
                { value: "inline", label: "Inline" },
                { value: "multiline", label: "Multiline" },
              ]}
            />
          </div>

          <OptionCheckbox checked={quoteStrings} onChange={setQuoteStrings} label="Quote strings" />

          <OptionCheckbox checked={deduplicate_} onChange={setDeduplicate} label="Deduplicate" />
        </>
      }
    />
  );
}
