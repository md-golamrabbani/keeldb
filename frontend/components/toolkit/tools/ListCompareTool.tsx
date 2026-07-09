"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines, compareArrays } from "../lib/transformers";
import { OptionLabel } from "../OptionField";
import Select from "@/components/ui/Select";

const EMPTY_OPTIONS = {};

export default function ListCompareTool() {
  const selectedTool = "list-compare";
  const [input, setInput] = useState("");
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [listA, setListA] = useState(options.listA || "");
  const [listB, setListB] = useState(options.listB || "");
  const [compareMode, setCompareMode] = useState<"all" | "missing-in-a" | "missing-in-b" | "common">(options.compareMode || "all");

  const output = useMemo(() => {
    try {
      const arrayA = parseLines(listA);
      const arrayB = parseLines(listB);

      if (compareMode === "all") {
        const missingInA = compareArrays(arrayA, arrayB, "missing-in-a");
        const missingInB = compareArrays(arrayA, arrayB, "missing-in-b");
        const common = compareArrays(arrayA, arrayB, "common");

        let result = "";
        if (missingInA.length > 0) {
          result += `Missing in A (${missingInA.length}):\n${missingInA.join("\n")}\n\n`;
        }
        if (missingInB.length > 0) {
          result += `Missing in B (${missingInB.length}):\n${missingInB.join("\n")}\n\n`;
        }
        if (common.length > 0) {
          result += `Common (${common.length}):\n${common.join("\n")}\n`;
        }
        return result;
      }

      const result = compareArrays(arrayA, arrayB, compareMode);
      return result.join("\n");
    } catch (e) {
      return "";
    }
  }, [listA, listB, compareMode]);

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, `${listA}\n---\n${listB}`, text);
    updateOptions(selectedTool, { listA, listB, compareMode });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">List Compare / Diff Tool</h2>
        <p className="mt-1 text-sm muted">Compare two lists: find missing items, common values, and differences.</p>
      </div>

      <div className="card card-pad">
        <OptionLabel>Compare Mode</OptionLabel>
        <Select
          value={compareMode}
          onValueChange={(e) => setCompareMode(e as any)}
          className="w-full"
          options={[
            { value: "all", label: "Show all (missing in A, missing in B, common)" },
            { value: "missing-in-a", label: "Only missing in A" },
            { value: "missing-in-b", label: "Only missing in B" },
            { value: "common", label: "Only common values" },
          ]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <label className="block text-sm font-medium">List A</label>
          <textarea
            value={listA}
            onChange={(e) => setListA(e.target.value)}
            placeholder="Paste list A, one item per line..."
            className="input flex-1 font-mono text-sm resize-none"
            style={{ minHeight: "200px" }}
          />
        </div>

        <div className="flex flex-col gap-3">
          <label className="block text-sm font-medium">List B</label>
          <textarea
            value={listB}
            onChange={(e) => setListB(e.target.value)}
            placeholder="Paste list B, one item per line..."
            className="input flex-1 font-mono text-sm resize-none"
            style={{ minHeight: "200px" }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label className="block text-sm font-medium">Output</label>
        <textarea
          value={output}
          readOnly
          placeholder="Comparison results will appear here..."
          className="input flex-1 font-mono text-sm resize-none"
          style={{ minHeight: "200px", background: "var(--surface-2)" }}
        />
        <button
          onClick={() => {
            navigator.clipboard.writeText(output);
            handleCopy(output);
          }}
          className="btn btn-primary btn-sm w-fit"
          disabled={!output}
        >
          Copy Output
        </button>
      </div>
    </div>
  );
}
