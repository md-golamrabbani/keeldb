"use client";
import { useEffect, useState } from "react";

// Full-screen centered logo shown for ~1s on app open, then fades away. Lives in
// the root layout, which persists across client-side navigation — so it only
// appears on a fresh open, not when moving between routes.
const SEEN_KEY = "keeldb_splash_shown";

export default function Splash() {
  // Play only once per app launch. Reading sessionStorage in the initializer
  // means even if the layout ever remounts (e.g. a route change in the Tauri
  // webview) the splash won't re-show — it only appears on a fresh open.
  const [phase, setPhase] = useState<"show" | "leaving" | "gone">(() => {
    try { if (typeof window !== "undefined" && sessionStorage.getItem(SEEN_KEY)) return "gone"; } catch {}
    return "show";
  });

  useEffect(() => {
    if (phase === "gone") return;
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch {}
    const t1 = setTimeout(() => setPhase("leaving"), 850);
    const t2 = setTimeout(() => setPhase("gone"), 1200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === "gone") return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center transition-opacity duration-300"
      style={{
        background: "var(--bg)",
        opacity: phase === "leaving" ? 0 : 1,
        pointerEvents: phase === "leaving" ? "none" : "auto",
      }}
      aria-hidden
    >
      <div
        className="flex flex-col items-center gap-4"
        style={{ animation: "splash-in 0.6s cubic-bezier(0.2,0.8,0.2,1) both" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.svg"
          alt=""
          width={84}
          height={84}
          style={{ animation: "splash-glow 1.8s ease-in-out infinite" }}
        />
      </div>
    </div>
  );
}
