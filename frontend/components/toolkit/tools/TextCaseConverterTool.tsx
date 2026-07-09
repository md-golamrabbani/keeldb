"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines, toCamelCase, toSnakeCase, toKebabCase, toPascalCase, toTitleCase } from "../lib/transformers";
import { OptionLabel } from "../OptionField";
import Select from "@/components/ui/Select";

const EMPTY_OPTIONS = {};

export default function TextCaseConverterTool() {
  const selectedTool = "text-case-converter";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [caseType, setCaseType] = useState<"camel" | "snake" | "kebab" | "pascal" | "title">(options.caseType || "camel");

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";
      const lines = parseLines(input);

      const converter = {
        camel: toCamelCase,
        snake: toSnakeCase,
        kebab: toKebabCase,
        pascal: toPascalCase,
        title: toTitleCase,
      }[caseType];

      return lines.map(converter).join("\n");
    } catch (e) {
      return "";
    }
  }, [input, caseType]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { caseType });
  };

  return (
    <ToolContainer
      title="Text Case Converter"
      description="Convert between case formats: camelCase, snake_case, kebab-case, PascalCase, Title Case"
      inputPlaceholder="Paste text or identifiers, one per line..."
      outputPlaceholder="Converted text will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <div>
          <OptionLabel>Convert To</OptionLabel>
          <Select
            value={caseType}
            onValueChange={(e) => setCaseType(e as any)}
            className="w-full"
            options={[
              { value: "camel", label: "camelCase" },
              { value: "snake", label: "snake_case" },
              { value: "kebab", label: "kebab-case" },
              { value: "pascal", label: "PascalCase" },
              { value: "title", label: "Title Case" },
            ]}
          />
        </div>
      }
    />
  );
}
