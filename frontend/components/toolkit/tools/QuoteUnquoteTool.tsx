"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { wrapInQuotes, removeQuotes, parseLines, escapeQuotes } from "../lib/transformers";
import { OptionLabel, OptionSelect, OptionCheckbox } from "../OptionField";
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
            <label className="text-sm font-medium block mb-2">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="quote">Add Quotes</option>
              <option value="unquote">Remove Quotes</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Quote Style</label>
            <select
              value={quoteStyle}
              onChange={(e) => setQuoteStyle(e.target.value as any)}
              disabled={mode === "unquote"}
              className="w-full rounded border p-2 text-sm disabled:opacity-50"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="single">Single (')</option>
              <option value="double">Double (")</option>
              <option value="backtick">Backtick (`)</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Join With</label>
            <select
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="newline">Newline</option>
              <option value="comma">Comma</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="escape-quotes"
              checked={escapeQuotesInContent}
              onChange={(e) => setEscapeQuotesInContent(e.target.checked)}
              disabled={mode === "unquote"}
              className="rounded disabled:opacity-50"
            />
            <label htmlFor="escape-quotes" className="text-sm font-medium cursor-pointer">
              Escape embedded quotes
            </label>
          </div>
        </>
      }
    />
  );
}
