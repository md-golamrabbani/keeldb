"use client";
import { useEffect, useState } from "react";
import { subscribeToasts, type Toast } from "@/lib/toast";
import { IconAlert, IconCheckCircle } from "@/components/icons";

/** Top-center toast stack; mounted once in the root layout. Placed where it's
 * hard to miss, a touch larger, and self-dismisses after 5s. */
export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[100] flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id}
          className="pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border px-4 py-3 text-[15px] font-medium shadow-lg"
          style={{
            background: "var(--surface)",
            borderColor: t.kind === "error" ? "var(--danger)" : "var(--border-strong)",
            boxShadow: "var(--shadow-lg)",
            color: "var(--text)",
          }}>
          {t.kind === "error"
            ? <IconAlert width={18} height={18} className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
            : <IconCheckCircle width={18} height={18} className="mt-0.5 shrink-0" style={{ color: "var(--success)" }} />}
          <span className="min-w-0 flex-1">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
