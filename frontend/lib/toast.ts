"use client";
// Minimal global toast bus — no provider wiring needed at call sites:
// import { toast } from "@/lib/toast"; toast("Downloaded users.csv");

export interface Toast {
  id: number;
  message: string;
  kind: "success" | "error" | "info";
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(toasts);
}

export function toast(message: string, kind: Toast["kind"] = "success", ms = 3500) {
  const t = { id: nextId++, message, kind };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, ms);
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  fn(toasts);
  return () => { listeners.delete(fn); };
}

/** Download `content` as a file AND confirm it with a toast — use this for
 * every in-app download so the user always gets feedback. */
export function downloadFile(content: string | Blob, filename: string, mime = "text/plain;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Downloaded ${filename}`);
}
