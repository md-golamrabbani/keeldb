export type ToolCategory = "sql" | "text" | "data-format" | "validation" | "security" | "util";

export interface ToolDefinition {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  tags: string[];
  icon?: string;
}

export const TOOLS: ToolDefinition[] = [
  // SQL Generation & Formatting
  {
    id: "sql-in-clause",
    name: "SQL IN-Clause Formatter",
    category: "sql",
    description: "Convert pasted values into SQL IN (...) lists",
    tags: ["in-clause", "sql", "list", "format"],
  },
  {
    id: "bulk-insert",
    name: "Bulk Insert Generator",
    category: "sql",
    description: "Generate SQL INSERT statements from rows or CSV",
    tags: ["insert", "bulk", "sql", "csv"],
  },
  {
    id: "bulk-update",
    name: "Bulk Update Generator",
    category: "sql",
    description: "Generate UPDATE or CASE-based bulk update queries",
    tags: ["update", "bulk", "sql", "case"],
  },
  {
    id: "bulk-where",
    name: "Bulk WHERE Builder",
    category: "sql",
    description: "Generate reusable WHERE clauses from lists",
    tags: ["where", "bulk", "sql", "filter"],
  },
  {
    id: "cte-values-builder",
    name: "CTE / VALUES Builder",
    category: "sql",
    description: "Generate SQL CTE or VALUES blocks instead of IN lists",
    tags: ["cte", "values", "sql", "common-table"],
  },
  {
    id: "case-builder",
    name: "CASE Expression Builder",
    category: "sql",
    description: "Generate SQL CASE WHEN blocks from key-value mappings",
    tags: ["case", "when", "sql", "conditional"],
  },
  {
    id: "sql-placeholder",
    name: "SQL Placeholder Builder",
    category: "sql",
    description: "Generate placeholders for prepared statements (?,$1,:id)",
    tags: ["placeholder", "prepared-statement", "sql"],
  },
  {
    id: "query-snippets",
    name: "Query Snippet Builder",
    category: "sql",
    description: "Save and load reusable SQL query templates",
    tags: ["snippet", "template", "sql", "reference"],
  },

  // Text & Format Conversion
  {
    id: "quote-unquote",
    name: "Quote / Unquote Utility",
    category: "text",
    description: "Add or remove quotes (single, double, backticks)",
    tags: ["quote", "text", "format"],
  },
  {
    id: "text-case-converter",
    name: "Text Case Converter",
    category: "text",
    description: "Convert between case formats (camelCase, snake_case, PascalCase, etc)",
    tags: ["case", "text", "naming", "format"],
  },
  {
    id: "copy-paste-cleanup",
    name: "Copy-Paste Cleanup",
    category: "text",
    description: "Clean messy data from Slack, docs, spreadsheets, emails",
    tags: ["cleanup", "text", "normalize", "whitespace"],
  },
  {
    id: "sql-escaping",
    name: "SQL Escaping Helper",
    category: "text",
    description: "Escape problematic values for manual SQL use",
    tags: ["escape", "sql", "text", "sanitize"],
  },

  // Data Format Conversion
  {
    id: "csv-to-sql",
    name: "CSV to SQL Converter",
    category: "data-format",
    description: "Convert CSV data to SQL INSERT or UPDATE statements",
    tags: ["csv", "sql", "convert", "insert"],
  },
  {
    id: "json-to-sql",
    name: "JSON to SQL Converter",
    category: "data-format",
    description: "Convert JSON arrays/objects to SQL inserts",
    tags: ["json", "sql", "convert", "array"],
  },
  {
    id: "multi-format-converter",
    name: "Multi-Format Converter",
    category: "data-format",
    description: "Convert between CSV, JSON, SQL, plaintext, and arrays",
    tags: ["convert", "format", "json", "csv", "sql"],
  },
  {
    id: "deduplicate",
    name: "Deduplicate / Sort Tool",
    category: "data-format",
    description: "Remove duplicates, sort, clean up pasted lists",
    tags: ["deduplicate", "sort", "cleanup", "list"],
  },
  {
    id: "range-expander",
    name: "Range Expander / Compressor",
    category: "data-format",
    description: "Expand ranges (1-5 → 1,2,3,4,5) or compress back",
    tags: ["range", "expand", "compress", "list"],
  },

  // Data Normalization & Validation
  {
    id: "data-normalizer",
    name: "Data Type Normalizer",
    category: "validation",
    description: "Normalize values to DB-safe formats (bool, null, numbers)",
    tags: ["normalize", "data-type", "validation", "clean"],
  },
  {
    id: "date-timestamp",
    name: "Date / Timestamp Converter",
    category: "validation",
    description: "Convert dates to timestamps, ISO-8601, human-readable formats",
    tags: ["date", "timestamp", "convert", "format"],
  },
  {
    id: "id-validator",
    name: "ID / UUID / Email Validator",
    category: "validation",
    description: "Validate and highlight invalid UUIDs, emails, integers",
    tags: ["validate", "uuid", "email", "integer"],
  },
  {
    id: "list-compare",
    name: "List Compare / Diff Tool",
    category: "validation",
    description: "Compare two lists: missing in A, missing in B, common, duplicates",
    tags: ["compare", "diff", "list", "analysis"],
  },

  // Advanced Utilities
  {
    id: "column-mapper",
    name: "Column Mapper",
    category: "util",
    description: "Map source fields to database columns, rename, reorder, drop",
    tags: ["map", "column", "field", "rename", "transform"],
  },
  {
    id: "sample-data",
    name: "Sample Data Generator",
    category: "util",
    description: "Generate lightweight SQL-ready test data",
    tags: ["sample", "data", "test", "seed", "generate"],
  },
  {
    id: "hash-encoding",
    name: "Hash / Encoding Utility",
    category: "security",
    description: "MD5, SHA1, SHA256, Base64, URL encode/decode, hex",
    tags: ["hash", "encode", "md5", "sha", "base64"],
  },
  {
    id: "jwt-inspector",
    name: "JWT / Token Inspector",
    category: "security",
    description: "Decode and inspect JWT tokens, show claims and expiry",
    tags: ["jwt", "token", "decode", "inspect", "auth"],
  },
];

export const CATEGORIES: ToolCategory[] = [
  "sql",
  "text",
  "data-format",
  "validation",
  "security",
  "util",
];

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  sql: "SQL Generation",
  text: "Text & Formatting",
  "data-format": "Format Conversion",
  validation: "Data Validation",
  security: "Security & Encoding",
  util: "Utilities",
};

export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return TOOLS.filter((t) => t.category === category);
}

export function getToolById(id: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.id === id);
}

export function searchTools(query: string): ToolDefinition[] {
  const q = query.toLowerCase();
  return TOOLS.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.toLowerCase().includes(q))
  );
}
