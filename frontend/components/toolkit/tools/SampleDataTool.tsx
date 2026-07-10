"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useToolkitStore } from "@/lib/toolkitStore";
import type { ColumnInfo, ConnectionProfile } from "@/lib/types";
import { OptionLabel, OptionInput } from "../OptionField";
import Select from "@/components/ui/Select";
import Combobox from "@/components/ui/Combobox";
import { IconCopy, IconDownload, IconPlus, IconTrash, IconUpload } from "@/components/icons";
import { downloadFile } from "@/lib/toast";

// Rendering a huge string into the textarea freezes the DOM, so the live
// preview is capped; the full dataset is only materialized for Copy/Download.
const PREVIEW_ROWS = 200;
const MIME: Record<string, string> = { csv: "text/csv", json: "application/json", sql: "application/sql" };

interface ColumnDef {
  name: string;
  type: string;
  options?: string[]; // enum choices when type === "enum"
}

/** Map a real DB column onto the closest generator type (name + type heuristics). */
function inferGenType(col: ColumnInfo): ColumnDef {
  const n = col.name.toLowerCase();
  const t = col.data_type.toUpperCase();
  if (col.enum_values?.length) return { name: col.name, type: "enum", options: col.enum_values };
  if (/UUID|CHAR\(36\)/.test(t) || n.endsWith("uuid")) return { name: col.name, type: "uuid" };
  if (col.is_pk && /INT|SERIAL/.test(t)) return { name: col.name, type: "id" };
  if (n.includes("email")) return { name: col.name, type: "email" };
  if (n.includes("phone") || n.includes("mobile")) return { name: col.name, type: "phone" };
  if (n === "first_name") return { name: col.name, type: "first_name" };
  if (n === "last_name") return { name: col.name, type: "last_name" };
  if (n.includes("name") || n.includes("title")) return { name: col.name, type: "name" };
  if (n.includes("company")) return { name: col.name, type: "company" };
  if (n.includes("city")) return { name: col.name, type: "city" };
  if (n.includes("country")) return { name: col.name, type: "country" };
  if (n.includes("url") || n.includes("link") || n.includes("slug")) return { name: col.name, type: "url" };
  if (n.includes("status") || n.includes("state")) return { name: col.name, type: "status" };
  if (n.includes("age")) return { name: col.name, type: "age" };
  if (/BOOL|TINYINT\(1\)/.test(t)) return { name: col.name, type: "boolean" };
  if (/DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL/.test(t)) return { name: col.name, type: "decimal" };
  if (/INT|SERIAL|YEAR/.test(t)) return { name: col.name, type: "integer" };
  if (t.startsWith("DATETIME") || t.startsWith("TIMESTAMP")) return { name: col.name, type: "timestamp" };
  if (t.startsWith("DATE")) return { name: col.name, type: "date" };
  return { name: col.name, type: "string" };
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
  { value: "enum", label: "Enum (from table)" },
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

function generateValue(type: string, index: number, options?: string[]): string {
  switch (type) {
    case "enum":
      return options?.length ? pick(options) : pick(STATUSES);
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

  // ---- database target (load columns from a table / push rows into it) ----
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [connId, setConnId] = useState("");
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [pushErr, setPushErr] = useState("");

  useEffect(() => { api.listConnections().then(setConnections).catch(() => {}); }, []);
  useEffect(() => {
    setSchemas([]); setSchema(""); setTables([]); setTable("");
    if (!connId) return;
    api.listSchemas(connId).then((s) => { setSchemas(s); if (s.length === 1) setSchema(s[0]); }).catch(() => {});
  }, [connId]);
  useEffect(() => {
    setTables([]); setTable("");
    if (!connId || !schema) return;
    api.listTables(connId, schema).then((ts) => setTables(ts.map((t) => t.name))).catch(() => {});
  }, [connId, schema]);

  const conn = connections.find((c) => c.id === connId);

  const loadFromTable = async () => {
    setPushErr(""); setPushMsg("");
    try {
      const cols = await api.listColumns(connId, schema, table);
      // FK columns pull real parent-key values, so generated rows reference
      // rows that actually exist (no orphaned foreign keys).
      const defs = await Promise.all(
        cols.map(async (col) => {
          if (col.is_fk && col.fk_target) {
            const m = col.fk_target.match(/^(.+?)\(([^)]*)\)$/);
            if (m) {
              const refTable = m[1].trim();
              const refCol = (m[2].split(",")[0] || "").trim();
              try {
                const d = await api.tableData(connId, {
                  schema, table: refTable, limit: 500, offset: 0, order_by: refCol,
                });
                const idx = d.colnames.indexOf(refCol);
                const values = idx >= 0
                  ? d.rows.map((r) => r[idx]).filter((v) => v != null).map(String)
                  : [];
                if (values.length) return { name: col.name, type: "enum", options: values };
              } catch { /* fall through to type inference */ }
            }
          }
          return inferGenType(col);
        }),
      );
      setColumns(defs);
      const fkCount = defs.filter((d, i) => cols[i].is_fk && d.type === "enum").length;
      setPushMsg(
        `Loaded ${cols.length} columns from ${table}` +
        (fkCount ? ` — ${fkCount} FK column(s) will use real parent ids` : "") +
        ". Tweak the generator types, then Push.",
      );
    } catch (e) { setPushErr(String(e)); }
  };

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
          row[col.name] = generateValue(col.type, i, col.options);
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

  const pushRows = useCallback(async () => {
    if (!connId || !schema || !table) return;
    setPushBusy(true); setPushErr(""); setPushMsg("");
    try {
      // CSV goes through the existing import pipeline (batched, header-matched)
      const rows: string[] = [columns.map((c) => c.name).join(",")];
      for (let i = 0; i < totalCount; i++) {
        rows.push(columns.map((c) => `"${generateValue(c.type, i, c.options).replace(/"/g, '""')}"`).join(","));
      }
      const file = new File([rows.join("\n")], "generated.csv", { type: "text/csv" });
      const res = await api.importCsv(connId, schema, table, file);
      setPushMsg(
        `Inserted ${res.inserted.toLocaleString()} of ${res.total.toLocaleString()} rows into ${table}` +
        (res.errors.length ? ` — ${res.errors.length} batch error(s): ${res.errors[0]}` : ""),
      );
    } catch (e) { setPushErr(String(e)); } finally { setPushBusy(false); }
  }, [connId, schema, table, columns, totalCount]);

  const handleDownload = useCallback(() => {
    const full = buildOutput(totalCount);
    if (!full) return;
    downloadFile(full, `sample-data-${totalCount}.${outputFormat === "sql" ? "sql" : outputFormat}`,
      MIME[outputFormat] ?? "text/plain");
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

      {/* database target: pull real column structure, push generated rows */}
      <div className="card card-pad space-y-3">
        <div>
          <h3 className="text-sm font-medium">Database target (optional)</h3>
          <p className="text-xs muted">Pick a table to load its columns into the generator, then push the rows straight in — no copy/paste.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <OptionLabel>Connection</OptionLabel>
            <Select className="!w-52" value={connId} onValueChange={setConnId} placeholder="— select —"
              options={connections.map((c) => ({ value: c.id, label: `${c.name} (${c.flavor})` }))} />
          </div>
          {schemas.length > 0 && (
            <div>
              <OptionLabel>Schema</OptionLabel>
              <Select className="!w-40" value={schema} onValueChange={setSchema} placeholder="— select —"
                options={schemas.map((s) => ({ value: s, label: s }))} />
            </div>
          )}
          {tables.length > 0 && (
            <div>
              <OptionLabel>Table</OptionLabel>
              <Combobox className="!w-48" value={table} onValueChange={setTable} placeholder="— select —"
                searchPlaceholder="Search tables…" options={tables.map((t) => ({ value: t }))} />
            </div>
          )}
          <button className="btn btn-secondary btn-sm" onClick={loadFromTable} disabled={!table}>
            Load columns
          </button>
          <button className="btn btn-primary btn-sm" onClick={pushRows}
            disabled={!table || pushBusy || conn?.read_only}
            title={conn?.read_only ? "Connection is read-only" : `Insert ${totalCount.toLocaleString()} generated rows into ${table || "the table"}`}>
            <IconUpload width={13} height={13} /> {pushBusy ? "Pushing…" : `Push ${totalCount.toLocaleString()} rows`}
          </button>
        </div>
        {conn?.environment === "prod" && (
          <p className="text-xs" style={{ color: "var(--danger)" }}>This is a PRODUCTION connection — pushing sample data here is almost certainly a mistake.</p>
        )}
        {pushMsg && <p className="text-xs" style={{ color: "var(--success)" }}>{pushMsg}</p>}
        {pushErr && <p className="alert-danger whitespace-pre-wrap">{pushErr}</p>}
        <p className="text-xs faint">Tip: delete the auto-increment PK column from the list above to let the database assign ids.</p>
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
