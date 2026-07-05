"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const KEYWORDS = new Set([
  "select", "from", "where", "insert", "into", "values", "update", "set", "delete", "create", "table",
  "alter", "drop", "truncate", "add", "column", "primary", "key", "foreign", "references", "join", "inner",
  "left", "right", "outer", "on", "group", "by", "order", "having", "limit", "offset", "as", "and", "or",
  "not", "null", "is", "in", "like", "between", "distinct", "count", "sum", "avg", "min", "max", "union",
  "all", "exists", "case", "when", "then", "else", "end", "asc", "desc", "index", "view", "database",
  "schema", "if", "default", "unique", "constraint", "cascade", "using", "with", "returning", "int",
  "integer", "varchar", "text", "boolean", "date", "timestamp", "numeric", "serial",
]);

// Suggestions offered for keywords (display form).
const KEYWORD_SUGGEST = [
  "SELECT", "FROM", "WHERE", "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "CREATE TABLE",
  "ALTER TABLE", "DROP TABLE", "TRUNCATE TABLE", "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "ON",
  "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET", "DISTINCT", "AS", "AND", "OR", "NOT", "IS NULL",
  "IS NOT NULL", "IN", "LIKE", "BETWEEN", "UNION", "UNION ALL", "EXISTS", "CASE", "WHEN", "THEN", "ELSE",
  "END", "ASC", "DESC", "COUNT(", "SUM(", "AVG(", "MIN(", "MAX(", "COALESCE(", "NOW()",
];

const LH = 20, PADY = 12, PADX = 14;
const FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightLine(line: string): string {
  const re = /(--[^\n]*|\/\*.*?\*\/)|('(?:''|[^'])*'|"(?:[^"])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([(),.;*=<>!+\-/%|]+)|(\s+)/g;
  let out = "", last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out += escapeHtml(line.slice(last, m.index));
    last = re.lastIndex;
    const [, comment, str, num, word, punct, ws] = m;
    if (comment !== undefined) out += `<span style="color:var(--text-faint)">${escapeHtml(comment)}</span>`;
    else if (str !== undefined) out += `<span style="color:var(--success)">${escapeHtml(str)}</span>`;
    else if (num !== undefined) out += `<span style="color:var(--warning)">${escapeHtml(num)}</span>`;
    else if (word !== undefined) out += KEYWORDS.has(word.toLowerCase())
      ? `<span style="color:var(--accent);font-weight:600">${escapeHtml(word)}</span>` : escapeHtml(word);
    else if (punct !== undefined) out += `<span style="color:var(--text-muted)">${escapeHtml(punct)}</span>`;
    else if (ws !== undefined) out += ws;
  }
  if (last < line.length) out += escapeHtml(line.slice(last));
  return out || "&#8203;";
}

const codeStyle: React.CSSProperties = {
  fontFamily: FONT, fontSize: 13, lineHeight: `${LH}px`, whiteSpace: "pre",
  padding: `${PADY}px ${PADX}px`, margin: 0, tabSize: 2,
};

type Kind = "keyword" | "table" | "column";
interface Suggestion { label: string; detail: string; kind: Kind }
interface AC { items: Suggestion[]; index: number; from: number; to: number; top: number; left: number }

const KIND_COLOR: Record<Kind, string> = {
  keyword: "var(--text-muted)", table: "var(--accent)", column: "var(--success)",
};

export default function SqlCodeEditor({
  value, onChange, onRun, minHeight = 160, errorLine, tableNames = [], columns = {},
}: {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  minHeight?: number;
  errorLine?: number | null;
  tableNames?: string[];
  columns?: Record<string, string[]>;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const charW = useRef(7.8);
  const pendingCaret = useRef<number | null>(null);
  const [ac, setAc] = useState<AC | null>(null);
  const lines = useMemo(() => value.split("\n"), [value]);
  const gutterW = Math.max(32, String(lines.length).length * 9 + 16);

  useEffect(() => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    if (ctx) { ctx.font = `13px ${FONT}`; charW.current = ctx.measureText("m").width || 7.8; }
  }, []);

  // Apply the caret position we requested after accepting a suggestion.
  useEffect(() => {
    if (pendingCaret.current != null && taRef.current) {
      const p = pendingCaret.current; pendingCaret.current = null;
      taRef.current.selectionStart = taRef.current.selectionEnd = p;
      taRef.current.focus();
    }
  }, [value]);

  const sync = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) { preRef.current.scrollTop = ta.scrollTop; preRef.current.scrollLeft = ta.scrollLeft; }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
    if (ac) setAc(null); // avoid drift while scrolling
  };

  const resolveTable = (name: string) =>
    tableNames.find((t) => t.toLowerCase() === name.toLowerCase()) ?? name;

  const aliasMap = (text: string): Record<string, string> => {
    const map: Record<string, string> = {};
    const re = /\b(?:from|join)\s+[`"[]?(\w+)[`"\]]?(?:\s+(?:as\s+)?[`"[]?(\w+)[`"\]]?)?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) if (m[2]) map[m[2].toLowerCase()] = m[1];
    return map;
  };

  const queryColumns = (text: string): Suggestion[] => {
    const present = tableNames.filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
    return present.flatMap((n) => (columns[n] || []).map((c) => ({ label: c, detail: n, kind: "column" as const })));
  };

  const compute = (text: string, pos: number) => {
    const ta = taRef.current;
    if (!ta || ta.selectionStart !== ta.selectionEnd) { setAc(null); return; }
    const before = text.slice(0, pos);
    const token = (before.match(/[\w]*$/) || [""])[0];
    const from = pos - token.length;
    const prevChar = text[from - 1];
    const t = token.toLowerCase();
    let items: Suggestion[] = [];

    if (prevChar === ".") {
      const pref = (text.slice(0, from - 1).match(/([\w]+)$/) || ["", ""])[1];
      const tbl = resolveTable(aliasMap(text)[pref.toLowerCase()] || pref);
      items = (columns[tbl] || []).filter((c) => c.toLowerCase().startsWith(t))
        .map((c) => ({ label: c, detail: tbl, kind: "column" }));
    } else if (token.length >= 1) {
      const tbls = tableNames.filter((n) => n.toLowerCase().startsWith(t)).map((n) => ({ label: n, detail: "table", kind: "table" as const }));
      const cols = queryColumns(text).filter((c) => c.label.toLowerCase().startsWith(t));
      const kws = KEYWORD_SUGGEST.filter((k) => k.toLowerCase().startsWith(t)).map((k) => ({ label: k, detail: "keyword", kind: "keyword" as const }));
      const seen = new Set<string>();
      items = [...tbls, ...cols, ...kws].filter((s) => { const k = s.kind + s.label; if (seen.has(k)) return false; seen.add(k); return true; });
    }

    if (!items.length || (items.length === 1 && items[0].label.toLowerCase() === t)) { setAc(null); return; }
    items = items.slice(0, 12);
    const rect = ta.getBoundingClientRect();
    const line = (before.match(/\n/g) || []).length;
    const col = before.length - (before.lastIndexOf("\n") + 1);
    const top = rect.top + PADY + line * LH - ta.scrollTop + LH;
    const left = rect.left + PADX + col * charW.current - ta.scrollLeft;
    setAc({ items, index: 0, from, to: pos, top, left });
  };

  const accept = (item: Suggestion) => {
    if (!ac) return;
    const nv = value.slice(0, ac.from) + item.label + value.slice(ac.to);
    pendingCaret.current = ac.from + item.label.length;
    setAc(null);
    onChange(nv);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ac) {
      if (e.key === "ArrowDown") { e.preventDefault(); setAc({ ...ac, index: (ac.index + 1) % ac.items.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setAc({ ...ac, index: (ac.index - 1 + ac.items.length) % ac.items.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(ac.items[ac.index]); return; }
      if (e.key === "Escape") { e.preventDefault(); setAc(null); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onRun?.(); }
  };

  return (
    <div className="relative flex" style={{ height: minHeight, minHeight: 120, resize: "vertical", overflow: "hidden" }}>
      <div ref={gutterRef} className="shrink-0 overflow-hidden border-r text-right"
        style={{ width: gutterW, background: "var(--surface-2)", paddingTop: PADY, paddingBottom: PADY }}>
        {lines.map((_, i) => (
          <div key={i} style={{ height: LH, lineHeight: `${LH}px`, fontFamily: FONT, fontSize: 12, paddingRight: 8,
            color: errorLine === i + 1 ? "var(--danger)" : "var(--text-faint)", fontWeight: errorLine === i + 1 ? 700 : 400 }}>
            {i + 1}
          </div>
        ))}
      </div>

      <div className="relative flex-1 overflow-hidden">
        <pre ref={preRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-auto" style={{ ...codeStyle, color: "var(--text)" }}>
          {lines.map((ln, i) => (
            <div key={i} style={{ height: LH, whiteSpace: "pre",
              ...(errorLine === i + 1 ? { background: "color-mix(in srgb, var(--danger) 12%, transparent)", textDecoration: "underline wavy var(--danger)", textDecorationSkipInk: "none" } : {}) }}
              dangerouslySetInnerHTML={{ __html: highlightLine(ln) }} />
          ))}
        </pre>
        <textarea ref={taRef} value={value} spellCheck={false}
          onChange={(e) => { onChange(e.target.value); compute(e.target.value, e.target.selectionStart); }}
          onScroll={sync}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) compute(value, e.currentTarget.selectionStart); }}
          onClick={(e) => compute(value, e.currentTarget.selectionStart)}
          onBlur={() => setTimeout(() => setAc(null), 150)}
          className="absolute inset-0 w-full resize-none overflow-auto bg-transparent outline-none"
          style={{ ...codeStyle, color: "transparent", caretColor: "var(--text)" }}
          placeholder="Write SQL… (Ctrl/⌘+Enter to run · type for suggestions)" />
      </div>

      {ac && ac.items.length > 0 && (
        <div className="rounded-lg border py-1 shadow-lg"
          style={{ position: "fixed", top: ac.top, left: ac.left, zIndex: 60, minWidth: 220, maxWidth: 340, maxHeight: 260, overflowY: "auto", background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}>
          {ac.items.map((s, i) => (
            <div key={s.kind + s.label} onMouseDown={(e) => { e.preventDefault(); accept(s); }}
              onMouseEnter={() => setAc((a) => (a ? { ...a, index: i } : a))}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm"
              style={i === ac.index ? { background: "var(--accent-soft)" } : undefined}>
              <span className="w-3 shrink-0 text-center text-[10px] font-bold uppercase" style={{ color: KIND_COLOR[s.kind] }}>
                {s.kind === "keyword" ? "K" : s.kind === "table" ? "T" : "C"}
              </span>
              <span className="flex-1 truncate font-mono">{s.label}</span>
              <span className="shrink-0 text-[10px] faint">{s.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
