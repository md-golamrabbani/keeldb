"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines, deduplicate, deduplicatePreservingOrder, sortArray } from "../lib/transformers";
import { OptionLabel, OptionCheckbox } from "../OptionField";
import Select from "@/components/ui/Select";

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
            <OptionLabel>Deduplicate</OptionLabel>
            <Select
              value={deduplicateOpt}
              onValueChange={(e) => setDeduplicate(e as any)}
              className="w-full"
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
            />
          </div>

          <div>
            <OptionLabel>Sort Order</OptionLabel>
            <Select
              value={sortOpt}
              onValueChange={(e) => setSortOpt(e as any)}
              className="w-full"
              options={[
                { value: "none", label: "No sorting" },
                { value: "asc", label: "Ascending (A-Z)" },
                { value: "desc", label: "Descending (Z-A)" },
              ]}
            />
          </div>

          <OptionCheckbox
            checked={preserveOrder}
            onChange={setPreserveOrder}
            label="Preserve order"
          />

          <OptionCheckbox checked={ignoreCase} onChange={setIgnoreCase} label="Ignore case" />
        </>
      }
    />
  );
}
