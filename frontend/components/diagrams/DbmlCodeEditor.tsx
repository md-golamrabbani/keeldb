"use client";
import { useRef } from "react";
import { handleCommentShortcut } from "@/lib/editorUtils";

// DBML editor: transparent textarea over a highlighted layer (same approach as
// the SQL editor). The two layers MUST share identical text metrics and both
// must use `white-space: pre` (no soft wrap) — any wrap difference makes the
// caret land on the wrong spot, so long lines scroll horizontally instead.

const KEYWORDS = new Set([
  "table", "ref", "enum", "tablegroup", "project", "note", "indexes", "as",
]);
const ATTRS = new Set([
  "pk", "primary", "key", "increment", "not", "null", "unique", "default", "note",
]);

const LH = 20; // px line height — shared by gutter, highlight layer and textarea
const PADY = 12;
const PADX = 14;
const FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";

// One style object for both layers so the metrics can never diverge.
const codeStyle: React.CSSProperties = {
  fontFamily: FONT, fontSize: 12, lineHeight: `${LH}px`, whiteSpace: "pre",
  padding: `${PADY}px ${PADX}px`, margin: 0, tabSize: 2,
};

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
  return out;
}

export default function DbmlCodeEditor({
  value, onChange, errorLine,
}: {
  value: string;
  onChange: (v: string) => void;
  errorLine?: number | null;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const sync = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  const lines = value.split("\n");
  const gutterW = 16 + String(lines.length).length * 8;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* line numbers */}
      <div ref={gutterRef} className="shrink-0 overflow-hidden border-r text-right"
        style={{ width: gutterW, background: "var(--surface-2)", borderColor: "var(--border)", paddingTop: PADY, paddingBottom: PADY }}>
        {lines.map((_, i) => (
          <div key={i} style={{
            height: LH, lineHeight: `${LH}px`, fontFamily: FONT, fontSize: 11, paddingRight: 8,
            color: errorLine === i + 1 ? "var(--danger)" : "var(--text-faint)",
            fontWeight: errorLine === i + 1 ? 700 : 400,
          }}>
            {i + 1}
          </div>
        ))}
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <pre ref={preRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden"
          style={{ ...codeStyle, color: "var(--text)" }}>
          {lines.map((l, i) => (
            <div key={i} style={{
              height: LH, whiteSpace: "pre",
              ...(errorLine === i + 1
                ? { background: "color-mix(in srgb, var(--danger) 12%, transparent)" }
                : {}),
            }}
              dangerouslySetInnerHTML={{ __html: highlight(l) }}
            />
          ))}
        </pre>
        <textarea
          ref={taRef}
          wrap="off"
          className="absolute inset-0 w-full resize-none overflow-auto bg-transparent outline-none"
          style={{ ...codeStyle, color: "transparent", caretColor: "var(--text)" }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={sync}
          onKeyDown={(e) => handleCommentShortcut(e, "// ", onChange)}
          placeholder="Write DBML… e.g.  Table users { id int [pk] } · Ctrl+/ to comment"
        />
      </div>
    </div>
  );
}
