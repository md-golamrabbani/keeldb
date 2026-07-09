"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";

// Simple fake data generators
function generateId(): string {
  return Math.floor(Math.random() * 1000000).toString();
}

function generateEmail(): string {
  const names = ["alice", "bob", "charlie", "diana", "eve", "frank"];
  const domains = ["example.com", "test.com", "demo.org"];
  return `${names[Math.floor(Math.random() * names.length)]}${Math.floor(Math.random() * 100)}@${domains[Math.floor(Math.random() * domains.length)]}`;
}

function generateName(): string {
  const names = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry"];
  return names[Math.floor(Math.random() * names.length)];
}

function generateStatus(): string {
  const statuses = ["active", "inactive", "pending", "archived"];
  return statuses[Math.floor(Math.random() * statuses.length)];
}

function generateTimestamp(): string {
  const date = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

function generateBoolean(): string {
  return Math.random() > 0.5 ? "true" : "false";
}

const EMPTY_OPTIONS = {};

export default function SampleDataTool() {
  const selectedTool = "sample-data";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [rowCount, setRowCount] = useState(options.rowCount || "10");
  const [outputFormat, setOutputFormat] = useState<"csv" | "json" | "sql">(options.outputFormat || "csv");

  const output = useMemo(() => {
    try {
      const count = parseInt(rowCount, 10) || 10;
      if (count <= 0) return "";

      // Parse input as column definitions (name: type)
      const lines = input.trim().split("\n").filter((l) => l.trim());
      if (lines.length === 0) return "-- Define columns as 'name: type' (one per line)";

      const columns = lines.map((line) => {
        const [name, type] = line.split(":").map((s) => s.trim());
        return { name: name || "col", type: (type || "string").toLowerCase() };
      });

      const rows: Record<string, string>[] = [];
      for (let i = 0; i < count; i++) {
        const row: Record<string, string> = {};
        for (const col of columns) {
          if (col.type === "id" || col.type === "integer") {
            row[col.name] = generateId();
          } else if (col.type === "email") {
            row[col.name] = generateEmail();
          } else if (col.type === "name" || col.type === "string") {
            row[col.name] = generateName();
          } else if (col.type === "status") {
            row[col.name] = generateStatus();
          } else if (col.type === "timestamp" || col.type === "date") {
            row[col.name] = generateTimestamp();
          } else if (col.type === "boolean") {
            row[col.name] = generateBoolean();
          } else {
            row[col.name] = `value_${i}`;
          }
        }
        rows.push(row);
      }

      if (outputFormat === "csv") {
        const header = columns.map((c) => c.name).join(",");
        const data = rows.map((row) => columns.map((c) => `"${row[c.name]}"`).join(",")).join("\n");
        return header + "\n" + data;
      } else if (outputFormat === "json") {
        return JSON.stringify(rows, null, 2);
      } else if (outputFormat === "sql") {
        const colNames = columns.map((c) => `\`${c.name}\``).join(", ");
        const values = rows
          .map((row) =>
            "(" +
            columns
              .map((c) => {
                const val = row[c.name];
                if (col.type === "timestamp" || col.type === "date") return `'${val}'`;
                if (col.type === "integer" || col.type === "id") return val;
                return `'${val.replace(/'/g, "''")}'`;
              })
              .join(", ") +
            ")"
          )
          .join(",\n  ");
        return `INSERT INTO table_name (${colNames}) VALUES\n  ${values};`;
      }

      return "";
    } catch (e) {
      return `-- Error: ${(e as any).message}`;
    }
  }, [input, rowCount, outputFormat]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { rowCount, outputFormat });
  };

  return (
    <ToolContainer
      title="Sample Data Generator"
      description="Generate lightweight SQL-ready test data. Define columns and types to generate rows."
      inputPlaceholder="Define columns (one per line):&#10;id: id&#10;name: name&#10;email: email&#10;created_at: timestamp&#10;status: status"
      outputPlaceholder="Sample data will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
      options={
        <>
          <div>
            <label className="text-sm font-medium block mb-2">Number of Rows</label>
            <input
              type="number"
              value={rowCount}
              onChange={(e) => setRowCount(e.target.value)}
              min="1"
              max="1000"
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Output Format</label>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as any)}
              className="w-full rounded border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
              <option value="sql">SQL</option>
            </select>
          </div>
        </>
      }
    />
  );
}
