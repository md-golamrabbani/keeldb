"use client";
// Shared plain-textarea editing helpers for the SQL and DBML editors.

/** Toggle a line comment (e.g. "-- " or "// ") on every line the selection
 * touches. If ALL non-empty selected lines are commented, uncomment; otherwise
 * comment. Returns the new value + selection so the highlight is preserved. */
export function toggleLineComment(
  value: string,
  selStart: number,
  selEnd: number,
  marker: string,
): { value: string; selStart: number; selEnd: number } {
  const lineStart = value.lastIndexOf("\n", selStart - 1) + 1;
  let lineEnd = value.indexOf("\n", Math.max(selEnd - 1, selStart));
  if (lineEnd === -1) lineEnd = value.length;

  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const allCommented = nonEmpty.length > 0 && nonEmpty.every((l) => l.trimStart().startsWith(marker.trim()));

  let startDelta = 0;
  let totalDelta = 0;
  const out = lines.map((l, i) => {
    if (l.trim().length === 0) return l;
    let next: string;
    if (allCommented) {
      const idx = l.indexOf(marker.trim());
      const withSpace = l.slice(idx).startsWith(marker) ? marker.length : marker.trim().length;
      next = l.slice(0, idx) + l.slice(idx + withSpace);
    } else {
      const indent = l.length - l.trimStart().length;
      next = l.slice(0, indent) + marker + l.slice(indent);
    }
    const delta = next.length - l.length;
    if (i === 0) startDelta = delta;
    totalDelta += delta;
    return next;
  });

  return {
    value: value.slice(0, lineStart) + out.join("\n") + value.slice(lineEnd),
    selStart: Math.max(lineStart, selStart + startDelta),
    selEnd: Math.max(lineStart, selEnd + totalDelta),
  };
}

/** Wire Ctrl/⌘+/ on a textarea; returns true when handled. */
export function handleCommentShortcut(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  marker: string,
  onChange: (v: string) => void,
): boolean {
  if (!(e.key === "/" && (e.ctrlKey || e.metaKey))) return false;
  e.preventDefault();
  const ta = e.currentTarget;
  const r = toggleLineComment(ta.value, ta.selectionStart, ta.selectionEnd, marker);
  onChange(r.value);
  requestAnimationFrame(() => {
    ta.selectionStart = r.selStart;
    ta.selectionEnd = r.selEnd;
  });
  return true;
}
