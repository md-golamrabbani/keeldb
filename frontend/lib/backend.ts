// Resolves where the backend lives.
//   • Web (next dev / static server): "/api" — the Next.js rewrite proxies to :8000.
//   • Tauri desktop: the Rust shell picks a free port for the Python sidecar and
//     exposes it via the `backend_port` command, so we talk to 127.0.0.1:<port>.

let cached: string | null = null;

export function isTauri(): boolean {
  return typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

export async function resolveApiBase(): Promise<string> {
  if (cached) return cached;
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const port = await invoke<number>("backend_port");
    cached = `http://127.0.0.1:${port}`;
  } else {
    cached = "/api";
  }
  return cached;
}

/** Best-effort synchronous base for building <a href>/window.open URLs.
 *  Falls back to "/api" until resolveApiBase() has run once (it runs at startup). */
export function apiBaseSync(): string {
  return cached ?? "/api";
}

/** Wait until the backend answers /health (used by the desktop startup gate). */
export async function waitForBackend(timeoutMs = 20000): Promise<boolean> {
  const base = await resolveApiBase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return true;
    } catch {
      /* sidecar not up yet */
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  return false;
}
