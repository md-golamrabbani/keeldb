"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { cleanupText } from "../lib/transformers";

const EMPTY_OPTIONS = {};

export default function CopyPasteCleanupTool() {
  const selectedTool = "copy-paste-cleanup";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [trimLines_, setTrimLines] = useState(options.trimLines !== false);
  const [removeBOM_, setRemoveBOM] = useState(options.removeBOM !== false);
  const [normalizeSpaces_, setNormalizeSpaces] = useState(options.normalizeSpaces !== false);
  const [removeMarkers, setRemoveMarkers] = useState(options.removeMarkers !== false);
  const [removeTrailingCommas_, setRemoveTrailingCommas] = useState(options.removeTrailingCommas !== false);

  const output = useMemo(() => {
    try {
      if (!input) return "";
      let result = input;

      // Apply cleanup transformations
      result = cleanupText(result, {
        trimLines: trimLines_,
        removeBOM: removeBOM_,
        normalizeSpaces: normalizeSpaces_,
      });

      // Remove bullet points, numbers, etc.
      if (removeMarkers) {
        result = result
          .split("\n")
          .map((line) => {
            // Remove bullets: •, -, *, ◦
            // Remove numbering: 1. 2. etc
            return line.replace(/^[\s•\-\*◦]*(\d+\.\s+)?/, "").trim();
          })
          .join("\n");
      }

      // Remove trailing commas before line breaks
      if (removeTrailingCommas_) {
        result = result.replace(/,(\s*[\n])/g, "$1");
      }

      return result;
    } catch (e) {
      return "";
    }
  }, [input, trimLines_, removeBOM_, normalizeSpaces_, removeMarkers, removeTrailingCommas_]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, {
      trimLines: trimLines_,
      removeBOM: removeBOM_,
      normalizeSpaces: normalizeSpaces_,
      removeMarkers,
      removeTrailingCommas: removeTrailingCommas_,
    });
  };

  return (
    <ToolContainer
      title="Copy-Paste Cleanup"
      description="Clean messy data from Slack, docs, spreadsheets, and emails. Normalize whitespace and remove formatting artifacts."
      inputPlaceholder="Paste messy text here..."
      outputPlaceholder="Cleaned text will appear here..."
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
              id="trim-lines"
              checked={trimLines_}
              onChange={(e) => setTrimLines(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="trim-lines" className="text-sm font-medium cursor-pointer">
              Trim lines
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="remove-bom"
              checked={removeBOM_}
              onChange={(e) => setRemoveBOM(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="remove-bom" className="text-sm font-medium cursor-pointer">
              Remove BOM
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="normalize-spaces"
              checked={normalizeSpaces_}
              onChange={(e) => setNormalizeSpaces(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="normalize-spaces" className="text-sm font-medium cursor-pointer">
              Normalize spaces
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="remove-markers"
              checked={removeMarkers}
              onChange={(e) => setRemoveMarkers(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="remove-markers" className="text-sm font-medium cursor-pointer">
              Remove bullets/numbers
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="remove-trailing-commas"
              checked={removeTrailingCommas_}
              onChange={(e) => setRemoveTrailingCommas(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="remove-trailing-commas" className="text-sm font-medium cursor-pointer">
              Remove trailing commas
            </label>
          </div>
        </>
      }
    />
  );
}
