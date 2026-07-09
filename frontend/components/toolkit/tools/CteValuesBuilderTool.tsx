"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { parseLines, isNumeric } from "../lib/transformers";
import { OptionLabel, OptionInput } from "../OptionField";
import Select from "@/components/ui/Select";

const EMPTY_OPTIONS = {};

export default function CteValuesBuilderTool() {
  const selectedTool = "cte-values-builder";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [buildType, setBuildType] = useState<"cte" | "values" | "temporary-table">(options.buildType || "cte");
  const [cteName, setCteName] = useState(options.cteName || "ids");
  const [columnName, setColumnName] = useState(options.columnName || "id");

  const output = useMemo(() => {
    try {
      if (!input.trim() || !cteName.trim() || !columnName.trim()) return "";

      const values = parseLines(input);
      if (values.length === 0) return "";

      const quoted = values.map((v) => (isNumeric(v) ? v : `'${v.replace(/'/g, "''")}'`));

      if (buildType === "cte") {
        return `WITH ${cteName} AS (\n  SELECT ${quoted[0]} as ${columnName}\n${quoted
          .slice(1)
          .map((v) => `  UNION ALL SELECT ${v}`)
          .join("\n")}\n)\nSELECT * FROM ${cteName};`;
      } else if (buildType === "values") {
        const valueRows = quoted.map((v) => `(${v})`).join(",\n  ");
        return `SELECT * FROM (\n  VALUES\n  ${valueRows}\n) AS t(${columnName});`;
      } else if (buildType === "temporary-table") {
        const inserts = quoted.map((v) => `INSERT INTO ${cteName} (${columnName}) VALUES (${v});`).join("\n");
        return `CREATE TEMPORARY TABLE ${cteName} (\n  ${columnName} VARCHAR(255) PRIMARY KEY\n);\n\n${inserts}`;
      }
      return "";
    } catch (e) {
      return "";
    }
  }, [input, buildType, cteName, columnName]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { buildType, cteName, columnName });
  };

  return (
    <ToolContainer
      title="CTE / VALUES Builder"
      description="Generate SQL CTE or VALUES blocks instead of long IN clauses."
      inputPlaceholder="Paste values, one per line..."
      outputPlaceholder="SQL will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <OptionLabel>Build Type</OptionLabel>
            <Select
              value={buildType}
              onValueChange={(e) => setBuildType(e as any)}
              className="w-full"
              options={[
                { value: "cte", label: "CTE (WITH clause)" },
                { value: "values", label: "VALUES clause" },
                { value: "temporary-table", label: "Temporary table" },
              ]}
            />
          </div>

          <div>
            <OptionLabel>
              {buildType === "cte" ? "CTE Name" : buildType === "values" ? "Alias" : "Table Name"}
            </OptionLabel>
            <OptionInput value={cteName} onChange={setCteName} placeholder="ids" />
          </div>

          <div>
            <OptionLabel>Column Name</OptionLabel>
            <OptionInput value={columnName} onChange={setColumnName} placeholder="id" />
          </div>
        </>
      }
    />
  );
}
