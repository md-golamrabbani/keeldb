"use client";
import { useEffect, useState } from "react";
import { api, getToken, setToken, setOnUnauthorized } from "@/lib/api";

type Phase = "loading" | "ready" | "login";

// Single shared-password gate. No-op unless the backend has KEELDB_PASSWORD set.
// If the backend is unreachable we don't block — the app renders and surfaces its
// own connection errors.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOnUnauthorized(() => setPhase("login"));
    api.authStatus()
      .then((s) => setPhase(!s.enabled || getToken() ? "ready" : "login"))
      .catch(() => setPhase("ready"));
  }, []);

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const { token } = await api.login(password);
      setToken(token);
      setPassword("");
      setPhase("ready");
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  if (phase === "loading") {
    return <div className="flex h-full items-center justify-center py-24 text-sm muted">Loading…</div>;
  }

  if (phase === "login") {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="card card-pad w-full max-w-sm space-y-4">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={28} height={28} />
            <h1 className="text-lg font-semibold tracking-tight">Keel<span style={{ color: "var(--accent)" }}>DB</span></h1>
          </div>
          <p className="text-sm muted">This workbench is password-protected. Enter the password to continue.</p>
          <div>
            <label className="label">Password</label>
            <input autoFocus type="password" className="input" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </div>
          {error && <p className="alert-danger">{error}</p>}
          <button className="btn btn-primary w-full" onClick={submit} disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
