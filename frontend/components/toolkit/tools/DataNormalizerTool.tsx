"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines } from "../lib/transformers";

const EMPTY_OPTIONS = {};

export default function DataNormalizerTool() {
  const selectedTool = "data-normalizer";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [normalizeBool, setNormalizeBool] = useState(options.normalizeBool !== false);
  const [normalizeNull, setNormalizeNull] = useState(options.normalizeNull !== false);
  const [trimSpaces_, setTrimSpaces] = useState(options.trimSpaces !== false);
  const [normalizeNumbers_, setNormalizeNumbers] = useState(options.normalizeNumbers !== false);

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";

      const lines = parseLines(input);
      return lines
        .map((line) => {
          let val = line;

          // Normalize null
          if (normalizeNull && (val.toLowerCase() === "null" || val === "" || val === "none")) {
            return "NULL";
          }

          // Normalize booleans
          if (normalizeBool) {
            if (val.toLowerCase() === "true" || val === "yes" || val === "1") return "true";
            if (val.toLowerCase() === "false" || val === "no" || val === "0") return "false";
          }

          // Trim spaces
          if (trimSpaces_) {
            val = val.trim();
          }

          // Normalize numbers
          if (normalizeNumbers_) {
            const num = parseFloat(val);
            if (!isNaN(num)) {
              return String(num);
            }
          }

          return val;
        })
        .join("\n");
    } catch (e) {
      return "";
    }
  }, [input, normalizeBool, normalizeNull, trimSpaces_, normalizeNumbers_]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, {
      normalizeBool,
      normalizeNull,
      trimSpaces: trimSpaces_,
      normalizeNumbers: normalizeNumbers_,
    });
  };

  return (
    <ToolContainer
      title="Data Type Normalizer"
      description="Normalize values to DB-safe formats: convert True/False/Yes/No to boolean, null values to NULL, trim spaces."
      inputPlaceholder="Paste values, one per line..."
      outputPlaceholder="Normalized data will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="normalize-bool"
              checked={normalizeBool}
              onChange={(e) => setNormalizeBool(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="normalize-bool" className="text-sm font-medium cursor-pointer">
              Convert to boolean (true/false)
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="normalize-null"
              checked={normalizeNull}
              onChange={(e) => setNormalizeNull(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="normalize-null" className="text-sm font-medium cursor-pointer">
              Convert to NULL
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="trim-spaces"
              checked={trimSpaces_}
              onChange={(e) => setTrimSpaces(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="trim-spaces" className="text-sm font-medium cursor-pointer">
              Trim spaces
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="normalize-numbers"
              checked={normalizeNumbers_}
              onChange={(e) => setNormalizeNumbers(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="normalize-numbers" className="text-sm font-medium cursor-pointer">
              Normalize numbers
            </label>
          </div>
        </>
      }
    />
  );
}
