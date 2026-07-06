"use client";
import { useEffect, useState } from "react";
import { isTauri, resolveApiBase, waitForBackend } from "@/lib/backend";

// In the browser the backend is always the /api proxy, so render immediately.
// In the Tauri desktop app the Python sidecar takes a moment to boot on its
// assigned port — show a splash until /health responds.
export default function BackendProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"ready" | "pending" | "timeout">("ready");

  useEffect(() => {
    if (!isTauri()) {
      resolveApiBase(); // caches "/api"
      return;
    }
    setState("pending");
    (async () => {
      await resolveApiBase();
      setState((await waitForBackend()) ? "ready" : "timeout");
    })();
  }, []);

  if (state === "pending") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-transparent"
          style={{ borderTopColor: "var(--accent)", borderRightColor: "var(--accent)" }} />
        <p className="text-sm muted">Starting the database engine…</p>
      </div>
    );
  }
  if (state === "timeout") {
    return (
      <div className="mx-auto mt-10 max-w-md">
        <p className="alert-danger">
          The local database engine didn’t start. Try reopening the app; if it persists, check that the
          bundled backend is present.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
