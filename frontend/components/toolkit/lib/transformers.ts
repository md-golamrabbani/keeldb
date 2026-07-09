/* Shared utilities for text parsing, SQL generation, and data transformation */

export type QuoteStyle = "single" | "double" | "backtick" | "none";
export type Delimiter = "comma" | "newline" | "tab" | "space" | "pipe" | "semicolon";

/* ============================================================================
   Text Parsing & Cleaning
   ========================================================================== */

export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function parseDelimitedValues(
  text: string,
  delimiter: Delimiter = "comma"
): string[] {
  let sep = ",";
  if (delimiter === "newline") sep = "\n";
  else if (delimiter === "tab") sep = "\t";
  else if (delimiter === "space") sep = " ";
  else if (delimiter === "pipe") sep = "|";
  else if (delimiter === "semicolon") sep = ";";

  return text
    .split(sep)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function trimLines(text: string): string {
  return text.split("\n").map((line) => line.trim()).join("\n");
}

export function removeBOM(text: string): string {
  return text.replace(/^﻿/, "");
}

export function cleanupText(text: string, options?: { trimLines?: boolean; removeBOM?: boolean; normalizeSpaces?: boolean }): string {
  const o = { trimLines: true, removeBOM: true, normalizeSpaces: true, ...options };
  let result = text;
  if (o.removeBOM) result = removeBOM(result);
  if (o.trimLines) result = trimLines(result);
  if (o.normalizeSpaces) result = normalizeWhitespace(result);
  return result;
}

/* ============================================================================
   Quoting / Escaping
   ========================================================================== */

export function escapeQuotes(text: string, style: QuoteStyle = "single"): string {
  if (style === "single") {
    return text.replace(/'/g, "''");
  } else if (style === "double") {
    return text.replace(/"/g, '\\"');
  } else if (style === "backtick") {
    return text.replace(/`/g, "``");
  }
  return text;
}

export function wrapInQuotes(text: string, style: QuoteStyle = "single"): string {
  if (style === "none") return text;
  const escaped = escapeQuotes(text, style);
  const quote = style === "single" ? "'" : style === "double" ? '"' : "`";
  return `${quote}${escaped}${quote}`;
}

export function removeQuotes(text: string): string {
  if ((text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("`") && text.endsWith("`"))) {
    return text.slice(1, -1);
  }
  return text;
}

export function isNumeric(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

export function isUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value.trim());
}

export function isEmail(value: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value.trim());
}

/* ============================================================================
   Array Operations
   ========================================================================== */

export function deduplicate(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

export function deduplicatePreservingOrder(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((v) => {
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

export function compareArrays(
  arr1: string[],
  arr2: string[],
  mode: "missing-in-a" | "missing-in-b" | "common" | "union" | "intersection" | "diff"
): string[] {
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);

  if (mode === "missing-in-a") return Array.from(set2).filter((v) => !set1.has(v));
  if (mode === "missing-in-b") return Array.from(set1).filter((v) => !set2.has(v));
  if (mode === "common") return Array.from(set1).filter((v) => set2.has(v));
  if (mode === "union") return Array.from(new Set([...arr1, ...arr2]));
  if (mode === "intersection") return Array.from(set1).filter((v) => set2.has(v));
  if (mode === "diff") {
    // Symmetric difference: in A but not B, or in B but not A
    const result = [...Array.from(set1).filter((v) => !set2.has(v)), ...Array.from(set2).filter((v) => !set1.has(v))];
    return result;
  }
  return [];
}

export function sortArray(arr: string[], direction: "asc" | "desc" = "asc", preserveNumericOrder: boolean = false): string[] {
  const sorted = [...arr].sort((a, b) => {
    if (preserveNumericOrder && isNumeric(a) && isNumeric(b)) {
      return parseFloat(a) - parseFloat(b);
    }
    return a.localeCompare(b);
  });
  return direction === "desc" ? sorted.reverse() : sorted;
}

/* ============================================================================
   SQL Generation
   ========================================================================== */

export function generateInClause(
  values: string[],
  quoteStrings: boolean = true,
  style: QuoteStyle = "single",
  format: "inline" | "multiline" = "inline"
): string {
  const processed = values.map((v) => {
    if (isNumeric(v)) return v;
    return quoteStrings ? wrapInQuotes(v, style) : v;
  });

  if (format === "multiline") {
    return "IN (\n  " + processed.join(",\n  ") + "\n)";
  }
  return "IN (" + processed.join(", ") + ")";
}

export function generateInsertStatement(
  tableName: string,
  columns: string[],
  values: string[][],
  options?: {
    style?: QuoteStyle;
    quoteStrings?: boolean;
    multiRow?: boolean;
    statementType?: "insert" | "insert-ignore" | "replace";
  }
): string {
  const o = {
    style: "backtick" as QuoteStyle,
    quoteStrings: true,
    multiRow: true,
    statementType: "insert" as const,
    ...options,
  };

  const quoteCol = (col: string) => {
    if (o.style === "none") return col;
    const q = o.style === "single" ? "'" : o.style === "double" ? '"' : "`";
    return `${q}${col}${q}`;
  };

  const colList = columns.map(quoteCol).join(", ");
  const stmt = o.statementType === "insert-ignore" ? "INSERT IGNORE INTO" : o.statementType === "replace" ? "REPLACE INTO" : "INSERT INTO";

  if (o.multiRow && values.length > 0) {
    const valueRows = values.map((row) =>
      "(" +
      row
        .map((v) => {
          if (v === null || v === "" || v?.toLowerCase?.() === "null") return "NULL";
          if (isNumeric(v)) return v;
          return o.quoteStrings ? wrapInQuotes(v, o.style) : v;
        })
        .join(", ") +
      ")"
    );
    return `${stmt} ${quoteCol(tableName)} (${colList}) VALUES\n${valueRows.join(",\n")};`;
  } else {
    // Single insert per row
    return values
      .map(
        (row) =>
          `${stmt} ${quoteCol(tableName)} (${colList}) VALUES (${row
            .map((v) => {
              if (v === null || v === "" || v?.toLowerCase?.() === "null") return "NULL";
              if (isNumeric(v)) return v;
              return o.quoteStrings ? wrapInQuotes(v, o.style) : v;
            })
            .join(", ")});`
      )
      .join("\n");
  }
}

export function generateUpdateStatement(
  tableName: string,
  idColumn: string,
  updates: Array<{ id: string; values: Record<string, string> }>,
  options?: { style?: QuoteStyle; multiStatement?: boolean }
): string {
  const o = { style: "backtick" as QuoteStyle, multiStatement: false, ...options };
  const quoteCol = (col: string) => {
    if (o.style === "none") return col;
    const q = o.style === "single" ? "'" : o.style === "double" ? '"' : "`";
    return `${q}${col}${q}`;
  };

  if (o.multiStatement) {
    return updates
      .map(({ id, values }) => {
        const setClauses = Object.entries(values)
          .map(([col, val]) => {
            const v = val === null || val === "" || val?.toLowerCase?.() === "null" ? "NULL" : isNumeric(val) ? val : wrapInQuotes(val, o.style);
            return `${quoteCol(col)} = ${v}`;
          })
          .join(", ");
        return `UPDATE ${quoteCol(tableName)} SET ${setClauses} WHERE ${quoteCol(idColumn)} = ${isNumeric(id) ? id : wrapInQuotes(id, o.style)};`;
      })
      .join("\n");
  } else {
    // Single multi-row UPDATE with CASE
    const columns = updates.length > 0 ? Object.keys(updates[0].values) : [];
    const cases = columns
      .map((col) => {
        const whenClauses = updates
          .map(({ id, values }) => {
            const v = values[col];
            if (v === null || v === "" || v?.toLowerCase?.() === "null") {
              return `WHEN ${isNumeric(id) ? id : wrapInQuotes(id, o.style)} THEN NULL`;
            }
            return `WHEN ${isNumeric(id) ? id : wrapInQuotes(id, o.style)} THEN ${isNumeric(v) ? v : wrapInQuotes(v, o.style)}`;
          })
          .join(" ");
        return `${quoteCol(col)} = CASE ${quoteCol(idColumn)} ${whenClauses} END`;
      })
      .join(",\n  ");

    const ids = updates.map(({ id }) => (isNumeric(id) ? id : wrapInQuotes(id, o.style))).join(", ");
    return `UPDATE ${quoteCol(tableName)} SET\n  ${cases}\nWHERE ${quoteCol(idColumn)} IN (${ids});`;
  }
}

/* ============================================================================
   CSV / JSON Parsing
   ========================================================================== */

export function parseSimpleCSV(csv: string): string[][] {
  const lines = csv.trim().split("\n");
  return lines.map((line) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  });
}

export function jsonToRows(json: string): string[][] {
  const data = JSON.parse(json);
  if (!Array.isArray(data)) {
    throw new Error("JSON must be an array of objects");
  }
  if (data.length === 0) return [];

  const firstItem = data[0];
  if (typeof firstItem !== "object" || firstItem === null) {
    throw new Error("JSON array items must be objects");
  }

  const columns = Object.keys(firstItem);
  const rows = data.map((item) => columns.map((col) => String(item[col] ?? "")));
  return [columns, ...rows];
}

/* ============================================================================
   Range Operations
   ========================================================================== */

export function expandRange(rangeStr: string, delimiter: Delimiter = "comma"): string[] {
  const parts = parseDelimitedValues(rangeStr, delimiter);
  const result: string[] = [];

  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((s) => parseInt(s, 10));
      if (!isNaN(start) && !isNaN(end)) {
        const [min, max] = start <= end ? [start, end] : [end, start];
        for (let i = min; i <= max; i++) {
          result.push(String(i));
        }
      } else {
        result.push(part);
      }
    } else {
      result.push(part);
    }
  }

  return result;
}

export function compressRange(values: string[]): string {
  const nums = values
    .filter((v) => /^\d+$/.test(v.trim()))
    .map((v) => parseInt(v, 10))
    .sort((a, b) => a - b);

  if (nums.length === 0) return values.join(", ");

  const ranges: string[] = [];
  let start = nums[0];
  let end = nums[0];

  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === end + 1) {
      end = nums[i];
    } else {
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      start = nums[i];
      end = nums[i];
    }
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);

  return ranges.join(", ");
}

/* ============================================================================
   Case Conversion
   ========================================================================== */

export function toCamelCase(str: string): string {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) =>
      index === 0 ? word.toLowerCase() : word.toUpperCase()
    )
    .replace(/\s+/g, "")
    .replace(/[_-]/g, "");
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/(?<!^)([A-Z])/g, "_$1")
    .replace(/\s+/g, "_")
    .toLowerCase()
    .replace(/[_]+/g, "_");
}

export function toKebabCase(str: string): string {
  return str
    .replace(/(?<!^)([A-Z])/g, "-$1")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[-]+/g, "-");
}

export function toPascalCase(str: string): string {
  return str
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

export function toTitleCase(str: string): string {
  return str
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
