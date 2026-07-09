"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines, deduplicate, deduplicatePreservingOrder, sortArray } from "../lib/transformers";

const EMPTY_OPTIONS = {};

export default function DeduplicateTool() {
  const selectedTool = "deduplicate";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [deduplicateOpt, setDeduplicate] = useState<"yes" | "no">(options.deduplicate || "yes");
  const [preserveOrder, setPreserveOrder] = useState(options.preserveOrder !== false);
  const [sortOpt, setSortOpt] = useState<"none" | "asc" | "desc">(options.sort || "none");
  const [ignoreCase, setIgnoreCase] = useState(options.ignoreCase === true);

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";
      let lines = parseLines(input);

      // Optionally deduplicate
      if (deduplicateOpt === "yes") {
        if (ignoreCase) {
          const seen = new Set<string>();
          lines = lines.filter((v) => {
            const lower = v.toLowerCase();
            if (seen.has(lower)) return false;
            seen.add(lower);
            return true;
          });
        } else {
          lines = preserveOrder ? deduplicatePreservingOrder(lines) : deduplicate(lines);
        }
      }

      // Optionally sort
      if (sortOpt !== "none") {
        lines = sortArray(lines, sortOpt as "asc" | "desc", false);
      }

      return lines.join("\n");
    } catch (e) {
      return "";
    }
  }, [input, deduplicateOpt, preserveOrder, sortOpt, ignoreCase]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { deduplicate: deduplicateOpt, preserveOrder, sort: sortOpt, ignoreCase });
  };

  return (
    <ToolContainer
      title="Deduplicate / Sort Tool"
      description="Remove duplicates, sort, and clean up pasted lists."
      inputPlaceholder="Paste your list, one item per line..."
      outputPlaceholder="Deduplicated and sorted output will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <label className="text-sm font-medium block mb-2">Deduplicate</label>
            <select
              value={deduplicateOpt}
              onChange={(e) => setDeduplicate(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Sort Order</label>
            <select
              value={sortOpt}
              onChange={(e) => setSortOpt(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="none">No sorting</option>
              <option value="asc">Ascending (A-Z)</option>
              <option value="desc">Descending (Z-A)</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="preserve-order"
              checked={preserveOrder}
              onChange={(e) => setPreserveOrder(e.target.checked)}
              disabled={sortOpt !== "none"}
              className="rounded disabled:opacity-50"
            />
            <label htmlFor="preserve-order" className="text-sm font-medium cursor-pointer">
              Preserve order
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ignore-case"
              checked={ignoreCase}
              onChange={(e) => setIgnoreCase(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="ignore-case" className="text-sm font-medium cursor-pointer">
              Ignore case
            </label>
          </div>
        </>
      }
    />
  );
}
