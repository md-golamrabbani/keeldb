"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useToolkitStore } from "@/lib/toolkitStore";
import { OptionLabel, OptionInput } from "../OptionField";
import Select from "@/components/ui/Select";
import { IconCopy, IconDownload, IconPlus, IconTrash } from "@/components/icons";

// Rendering a huge string into the textarea freezes the DOM, so the live
// preview is capped; the full dataset is only materialized for Copy/Download.
const PREVIEW_ROWS = 200;
const MIME: Record<string, string> = { csv: "text/csv", json: "application/json", sql: "application/sql" };

interface ColumnDef {
  name: string;
  type: string;
}

const TYPE_OPTIONS = [
  { value: "id", label: "ID (number)" },
  { value: "uuid", label: "UUID" },
  { value: "name", label: "Full Name" },
  { value: "first_name", label: "First Name" },
  { value: "last_name", label: "Last Name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone Number" },
  { value: "age", label: "Age (number)" },
  { value: "integer", label: "Integer" },
  { value: "decimal", label: "Decimal" },
  { value: "boolean", label: "Boolean" },
  { value: "status", label: "Status" },
  { value: "date", label: "Date" },
  { value: "timestamp", label: "Timestamp" },
  { value: "company", label: "Company" },
  { value: "city", label: "City" },
  { value: "country", label: "Country" },
  { value: "url", label: "URL" },
  { value: "string", label: "Random Word" },
];

const UNQUOTED_SQL_TYPES = new Set(["id", "age", "integer", "decimal", "boolean"]);
const DATE_SQL_TYPES = new Set(["date", "timestamp"]);

const DEFAULT_COLUMNS: ColumnDef[] = [
  { name: "id", type: "id" },
  { name: "name", type: "name" },
  { name: "email", type: "email" },
  { name: "phone", type: "phone" },
  { name: "created_at", type: "timestamp" },
  { name: "status", type: "status" },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const FIRST_NAMES = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry", "Ivan", "Julia"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"];
const STATUSES = ["active", "inactive", "pending", "archived"];
const COMPANIES = ["Acme Corp", "Globex", "Initech", "Umbrella Inc", "Stark Industries", "Wayne Enterprises"];
const CITIES = ["New York", "London", "Tokyo", "Berlin", "Sydney", "Toronto", "Paris", "Dhaka"];
const COUNTRIES = ["USA", "UK", "Japan", "Germany", "Australia", "Canada", "France", "Bangladesh"];
const WORDS = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit"];

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generatePhone(): string {
  const area = 200 + Math.floor(Math.random() * 800);
  const exchange = 200 + Math.floor(Math.random() * 800);
  const line = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `+1-${area}-${exchange}-${line}`;
}

function generateValue(type: string, index: number): string {
  switch (type) {
    case "id":
      return String(Math.floor(Math.random() * 1000000));
    case "uuid":
      return generateUUID();
    case "first_name":
      return pick(FIRST_NAMES);
    case "last_name":
      return pick(LAST_NAMES);
    case "name":
      return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    case "email": {
      const first = pick(FIRST_NAMES).toLowerCase();
      const domains = ["example.com", "test.com", "demo.org", "mail.com"];
      return `${first}${Math.floor(Math.random() * 100)}@${pick(domains)}`;
    }
    case "phone":
      return generatePhone();
    case "age":
      return String(18 + Math.floor(Math.random() * 63));
    case "integer":
      return String(Math.floor(Math.random() * 1000));
    case "decimal":
      return (Math.random() * 1000).toFixed(2);
    case "boolean":
      return Math.random() > 0.5 ? "true" : "false";
    case "status":
      return pick(STATUSES);
    case "date": {
      const date = new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000);
      return date.toISOString().split("T")[0];
    }
    case "timestamp": {
      const date = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
      return date.toISOString();
    }
    case "company":
      return pick(COMPANIES);
    case "city":
      return pick(CITIES);
    case "country":
      return pick(COUNTRIES);
    case "url": {
      const domains = ["example.com", "test.io", "sample.dev"];
      return `https://${pick(domains)}/${Math.random().toString(36).substring(2, 8)}`;
    }
    case "string":
      return pick(WORDS);
    default:
      return `value_${index}`;
  }
}

const EMPTY_OPTIONS = {};

export default function SampleDataTool() {
  const selectedTool = "sample-data";
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [columns, setColumns] = useState<ColumnDef[]>(
    Array.isArray(options.columns) && options.columns.length > 0 ? options.columns : DEFAULT_COLUMNS
  );
  const [rowCount, setRowCount] = useState(options.rowCount || "10");
  const [outputFormat, setOutputFormat] = useState<"csv" | "json" | "sql">(options.outputFormat || "csv");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    updateOptions(selectedTool, { columns, rowCount, outputFormat });
  }, [columns, rowCount, outputFormat]);

  const addColumn = () => {
    setColumns((c) => [...c, { name: `column_${c.length + 1}`, type: "string" }]);
  };

  const removeColumn = (idx: number) => {
    setColumns((c) => c.filter((_, i) => i !== idx));
  };

  const updateColumn = (idx: number, patch: Partial<ColumnDef>) => {
    setColumns((c) => c.map((col, i) => (i === idx ? { ...col, ...patch } : col)));
  };

  const buildOutput = useCallback((count: number): string => {
    try {
      if (count <= 0 || columns.length === 0) return "";

      const rows: Record<string, string>[] = [];
      for (let i = 0; i < count; i++) {
        const row: Record<string, string> = {};
        for (const col of columns) {
          row[col.name] = generateValue(col.type, i);
        }
        rows.push(row);
      }

      if (outputFormat === "csv") {
        const header = columns.map((c) => c.name).join(",");
        const data = rows
          .map((row) => columns.map((c) => `"${row[c.name].replace(/"/g, '""')}"`).join(","))
          .join("\n");
        return header + "\n" + data;
      } else if (outputFormat === "json") {
        return JSON.stringify(rows, null, 2);
      } else if (outputFormat === "sql") {
        const colNames = columns.map((c) => `\`${c.name}\``).join(", ");
        const values = rows
          .map(
            (row) =>
              "(" +
              columns
                .map((c) => {
                  const val = row[c.name];
                  if (DATE_SQL_TYPES.has(c.type)) return `'${val}'`;
                  if (UNQUOTED_SQL_TYPES.has(c.type)) return val;
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
  }, [columns, outputFormat]);

  const totalCount = parseInt(rowCount, 10) || 10;
  const isLarge = totalCount > PREVIEW_ROWS;

  // Live preview only renders up to PREVIEW_ROWS rows — keeps typing snappy
  // even when the requested row count is 100k+.
  const preview = useMemo(
    () => buildOutput(Math.min(totalCount, PREVIEW_ROWS)),
    [buildOutput, totalCount],
  );

  const handleCopy = useCallback(() => {
    const full = isLarge ? buildOutput(totalCount) : preview;
    if (full) {
      navigator.clipboard.writeText(full);
      setCopied(true);
      addToHistory(selectedTool, JSON.stringify(columns), full.slice(0, 10_000));
      setTimeout(() => setCopied(false), 2000);
    }
  }, [buildOutput, preview, isLarge, totalCount, columns]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = useCallback(() => {
    const full = buildOutput(totalCount);
    if (!full) return;
    const blob = new Blob([full], { type: MIME[outputFormat] ?? "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sample-data-${totalCount}.${outputFormat === "sql" ? "sql" : outputFormat}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [buildOutput, totalCount, outputFormat]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Sample Data Generator</h2>
        <p className="mt-1 text-sm muted">
          Generate lightweight SQL-ready test data. Define columns and pick a type for each to generate realistic values.
        </p>
      </div>

      <div className="card card-pad space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Columns</h3>
          <button className="btn btn-secondary btn-sm" onClick={addColumn}>
            <IconPlus width={14} height={14} /> Add column
          </button>
        </div>

        <div className="space-y-2">
          {columns.map((col, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={col.name}
                onChange={(e) => updateColumn(idx, { name: e.target.value })}
                placeholder="column_name"
                className="input flex-1"
              />
              <div className="w-52 shrink-0">
                <Select
                  value={col.type}
                  onValueChange={(v) => updateColumn(idx, { type: v })}
                  className="w-full"
                  options={TYPE_OPTIONS}
                />
              </div>
              <button
                onClick={() => removeColumn(idx)}
                className="btn btn-ghost btn-sm shrink-0"
                aria-label="Remove column"
                disabled={columns.length <= 1}
              >
                <IconTrash width={14} height={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card card-pad">
        <div className="grid gap-4 grid-cols-2">
          <div>
            <OptionLabel>Number of Rows</OptionLabel>
            <OptionInput type="number" value={rowCount} onChange={setRowCount} />
          </div>

          <div>
            <OptionLabel>Output Format</OptionLabel>
            <Select
              value={outputFormat}
              onValueChange={(e) => setOutputFormat(e as any)}
              className="w-full"
              options={[
                { value: "csv", label: "CSV" },
                { value: "json", label: "JSON" },
                { value: "sql", label: "SQL" },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label className="block text-sm font-medium">
          Output{isLarge ? ` — preview of first ${PREVIEW_ROWS.toLocaleString()} rows` : ""}
        </label>
        {isLarge && (
          <p className="rounded-lg px-3 py-2 text-xs"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            {totalCount.toLocaleString()} rows requested — the preview is capped to keep the page responsive.
            Use <b>Download</b> to generate the complete file.
          </p>
        )}
        <textarea
          value={preview}
          readOnly
          placeholder="Sample data will appear here..."
          className="input flex-1 font-mono text-sm resize-none"
          style={{ minHeight: "260px", background: "var(--surface-2)" }}
        />
        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            className="btn btn-sm btn-primary w-fit"
            disabled={!preview}
          >
            <IconDownload width={14} height={14} /> Download ({totalCount.toLocaleString()} rows)
          </button>
          <button
            onClick={handleCopy}
            className={`btn btn-sm w-fit ${copied ? "btn-success" : "btn-secondary"}`}
            disabled={!preview}
          >
            <IconCopy width={14} height={14} /> {copied ? "Copied!" : "Copy all"}
          </button>
        </div>
      </div>
    </div>
  );
}
