"use client";
import { useEffect, useState } from "react";
import { subscribeToasts, type Toast } from "@/lib/toast";
import { IconAlert, IconCheckCircle } from "@/components/icons";

/** Bottom-right toast stack; mounted once in the root layout. */
export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id}
          className="pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg"
          style={{
            background: "var(--surface)",
            borderColor: t.kind === "error" ? "var(--danger)" : "var(--border-strong)",
            boxShadow: "var(--shadow-lg)",
            color: "var(--text)",
          }}>
          {t.kind === "error"
            ? <IconAlert width={15} height={15} className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
            : <IconCheckCircle width={15} height={15} className="mt-0.5 shrink-0" style={{ color: "var(--success)" }} />}
          <span className="min-w-0 flex-1">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
