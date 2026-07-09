"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { wrapInQuotes, removeQuotes, parseLines, escapeQuotes } from "../lib/transformers";
import { OptionLabel, OptionCheckbox } from "../OptionField";
import Select from "@/components/ui/Select";
import Checkbox from "@/components/ui/Checkbox";

const EMPTY_OPTIONS = {};

export default function QuoteUnquoteTool() {
  const selectedTool = "quote-unquote";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [mode, setMode] = useState<"quote" | "unquote">(options.mode || "quote");
  const [quoteStyle, setQuoteStyle] = useState<"single" | "double" | "backtick">(options.quoteStyle || "single");
  const [delimiter, setDelimiter] = useState<"comma" | "newline">(options.delimiter || "newline");
  const [escapeQuotesInContent, setEscapeQuotesInContent] = useState(options.escapeQuotes !== false);

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";

      const lines = parseLines(input);
      let result: string[];

      if (mode === "quote") {
        result = lines.map((line) => {
          const escaped = escapeQuotesInContent ? escapeQuotes(line, quoteStyle) : line;
          return wrapInQuotes(escaped, quoteStyle);
        });
      } else {
        result = lines.map((line) => removeQuotes(line));
      }

      return result.join(delimiter === "comma" ? ", " : "\n");
    } catch (e) {
      return "";
    }
  }, [input, mode, quoteStyle, delimiter, escapeQuotesInContent]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { mode, quoteStyle, delimiter, escapeQuotes: escapeQuotesInContent });
  };

  return (
    <ToolContainer
      title="Quote / Unquote Utility"
      description="Add or remove quotes from values. Auto-escape embedded quotes if needed."
      inputPlaceholder="Paste values, one per line..."
      outputPlaceholder="Quoted or unquoted output will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <OptionLabel>Mode</OptionLabel>
            <Select
              value={mode}
              onValueChange={(e) => setMode(e as any)}
              className="w-full"
              options={[
                { value: "quote", label: "Add Quotes" },
                { value: "unquote", label: "Remove Quotes" },
              ]}
            />
          </div>

          <div>
            <OptionLabel>Quote Style</OptionLabel>
            <Select
              value={quoteStyle}
              onValueChange={(e) => setQuoteStyle(e as any)}
              disabled={mode === "unquote"}
              className="w-full"
              options={[
                { value: "single", label: "Single (')" },
                { value: "double", label: 'Double (")' },
                { value: "backtick", label: "Backtick (`)" },
              ]}
            />
          </div>

          <div>
            <OptionLabel>Join With</OptionLabel>
            <Select
              value={delimiter}
              onValueChange={(e) => setDelimiter(e as any)}
              className="w-full"
              options={[
                { value: "newline", label: "Newline" },
                { value: "comma", label: "Comma" },
              ]}
            />
          </div>

          <OptionCheckbox
            checked={escapeQuotesInContent}
            onChange={setEscapeQuotesInContent}
            label="Escape embedded quotes"
          />
        </>
      }
    />
  );
}
