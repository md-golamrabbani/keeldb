"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines, isUUID, isEmail, isNumeric } from "../lib/transformers";
import { OptionLabel, OptionCheckbox } from "../OptionField";
import Select from "@/components/ui/Select";

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
            <OptionLabel>Validation Type</OptionLabel>
            <Select
              value={validationType}
              onValueChange={(e) => setValidationType(e as any)}
              className="w-full"
              options={[
                { value: "auto", label: "Auto-detect" },
                { value: "uuid", label: "UUID format" },
                { value: "email", label: "Email format" },
                { value: "integer", label: "Integer only" },
              ]}
            />
          </div>

          <OptionCheckbox checked={showInvalid} onChange={setShowInvalid} label="Show invalid items" />
        </>
      }
    />
  );
}
