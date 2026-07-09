"use client";
import { useRef } from "react";

// Lightweight DBML editor: a transparent textarea over a highlighted <pre>,
// the same technique as the SQL editor — no heavyweight editor dependency.

const KEYWORDS = new Set([
  "table", "ref", "enum", "tablegroup", "project", "note", "indexes", "as",
]);
const ATTRS = new Set([
  "pk", "primary", "key", "increment", "not", "null", "unique", "default", "ref", "note",
]);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(line: string): string {
  const re = /(\/\/[^\n]*)|('(?:''|[^'])*'|"(?:[^"])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([{}[\](),.:<>-]+)|(\s+)/g;
  let out = "", last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out += escapeHtml(line.slice(last, m.index));
    last = re.lastIndex;
    const [, comment, str, num, word, punct, ws] = m;
    if (comment !== undefined) out += `<span style="color:var(--text-faint)">${escapeHtml(comment)}</span>`;
    else if (str !== undefined) out += `<span style="color:var(--success)">${escapeHtml(str)}</span>`;
    else if (num !== undefined) out += `<span style="color:var(--warning)">${escapeHtml(num)}</span>`;
    else if (word !== undefined) {
      const lower = word.toLowerCase();
      if (KEYWORDS.has(lower)) out += `<span style="color:var(--accent);font-weight:600">${escapeHtml(word)}</span>`;
      else if (ATTRS.has(lower)) out += `<span style="color:var(--warning)">${escapeHtml(word)}</span>`;
      else out += escapeHtml(word);
    } else if (punct !== undefined) out += `<span style="color:var(--text-muted)">${escapeHtml(punct)}</span>`;
    else if (ws !== undefined) out += ws;
  }
  if (last < line.length) out += escapeHtml(line.slice(last));
  return out || "&nbsp;";
}

const FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";

export default function DbmlCodeEditor({
  value, onChange, errorLine,
}: {
  value: string;
  onChange: (v: string) => void;
  errorLine?: number | null;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const sync = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  const lines = value.split("\n");
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <pre
        ref={preRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden p-3 text-xs leading-5"
        style={{ fontFamily: FONT, margin: 0 }}
      >
        {lines.map((l, i) => (
          <div
            key={i}
            style={errorLine === i + 1 ? { background: "color-mix(in srgb, var(--danger) 12%, transparent)" } : undefined}
            dangerouslySetInnerHTML={{ __html: highlight(l) }}
          />
        ))}
      </pre>
      <textarea
        ref={taRef}
        className="absolute inset-0 resize-none bg-transparent p-3 text-xs leading-5 outline-none"
        style={{ fontFamily: FONT, color: "transparent", caretColor: "var(--text)" }}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={sync}
      />
    </div>
  );
}
