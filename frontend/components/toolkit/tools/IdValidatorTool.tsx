"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines, isUUID, isEmail, isNumeric } from "../lib/transformers";

const EMPTY_OPTIONS = {};

export default function IdValidatorTool() {
  const selectedTool = "id-validator";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [validationType, setValidationType] = useState<"auto" | "uuid" | "email" | "integer">(options.validationType || "auto");
  const [showInvalid, setShowInvalid] = useState(options.showInvalid !== false);

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";

      const lines = parseLines(input);
      const valid: string[] = [];
      const invalid: string[] = [];

      lines.forEach((line) => {
        let isValid = false;

        if (validationType === "auto") {
          if (isUUID(line) || isEmail(line) || isNumeric(line)) {
            isValid = true;
          }
        } else if (validationType === "uuid") {
          isValid = isUUID(line);
        } else if (validationType === "email") {
          isValid = isEmail(line);
        } else if (validationType === "integer") {
          isValid = /^-?\d+$/.test(line.trim());
        }

        if (isValid) {
          valid.push(line);
        } else {
          invalid.push(line);
        }
      });

      let result = `Valid (${valid.length}):\n${valid.join("\n")}`;
      if (showInvalid && invalid.length > 0) {
        result += `\n\nInvalid (${invalid.length}):\n${invalid.join("\n")}`;
      }

      return result;
    } catch (e) {
      return "";
    }
  }, [input, validationType, showInvalid]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { validationType, showInvalid });
  };

  return (
    <ToolContainer
      title="ID / UUID / Email Validator"
      description="Validate pasted values: UUIDs, emails, integers. Highlight invalid items."
      inputPlaceholder="Paste IDs to validate, one per line..."
      outputPlaceholder="Valid/invalid results will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <label className="text-sm font-medium block mb-2">Validation Type</label>
            <select
              value={validationType}
              onChange={(e) => setValidationType(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="auto">Auto-detect</option>
              <option value="uuid">UUID format</option>
              <option value="email">Email format</option>
              <option value="integer">Integer only</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="show-invalid"
              checked={showInvalid}
              onChange={(e) => setShowInvalid(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="show-invalid" className="text-sm font-medium cursor-pointer">
              Show invalid items
            </label>
          </div>
        </>
      }
    />
  );
}
