"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, clearToken, getToken, setToken, setOnUnauthorized } from "@/lib/api";

type Phase = "loading" | "setup" | "login" | "ready";

const IDLE_MS = 60 * 60 * 1000;      // lock after 1 hour of no activity
const REFRESH_EVERY_MS = 10 * 60 * 1000; // extend the session at most every 10 min

// Local app-unlock: first launch sets a password, every launch unlocks with it,
// and the session lapses after 1h idle (activity keeps it alive). No-op unless the
// backend requires auth; an unreachable backend never blocks the app.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOnUnauthorized(() => setPhase("login"));
    api.authStatus()
      .then((s) => setPhase(!s.enabled ? "ready" : s.needs_setup ? "setup" : getToken() ? "ready" : "login"))
      .catch(() => setPhase("ready"));
  }, []);

  // 1-hour sliding session: refresh the token on activity, lock when idle.
  useEffect(() => {
    if (phase !== "ready" || !getToken()) return;
    let lastActivity = Date.now();
    let lastRefresh = Date.now();
    const onActivity = () => {
      lastActivity = Date.now();
      if (getToken() && Date.now() - lastRefresh > REFRESH_EVERY_MS) {
        lastRefresh = Date.now();
        api.authRefresh().then(({ token }) => token && setToken(token)).catch(() => {});
      }
    };
    const evts = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    evts.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const idle = setInterval(() => {
      if (Date.now() - lastActivity > IDLE_MS) { clearToken(); setPhase("login"); }
    }, 30_000);
    return () => { evts.forEach((e) => window.removeEventListener(e, onActivity)); clearInterval(idle); };
  }, [phase]);

  const doSetup = useCallback(async () => {
    if (pw.length < 4) { setError("Use at least 4 characters."); return; }
    if (pw !== pw2) { setError("Passwords don't match."); return; }
    setBusy(true); setError("");
    try {
      const { token } = await api.authSetup(pw);
      setToken(token); setPw(""); setPw2(""); setPhase("ready");
    } catch (e) { setError(String(e).replace(/^Error:\s*/, "")); } finally { setBusy(false); }
  }, [pw, pw2]);

  const doLogin = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const { token } = await api.login(pw);
      setToken(token); setPw(""); setPhase("ready");
    } catch (e) { setError(String(e).replace(/^Error:\s*/, "")); } finally { setBusy(false); }
  }, [pw]);

  if (phase === "loading") {
    return <div className="flex h-full items-center justify-center py-24 text-sm muted">Loading…</div>;
  }

  if (phase === "ready") return <>{children}</>;

  const setup = phase === "setup";
  return (
    <div className="flex items-center justify-center py-20">
      <div className="card card-pad w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={28} height={28} />
          <h1 className="text-lg font-semibold tracking-tight">Keel<span style={{ color: "var(--accent)" }}>DB</span></h1>
        </div>
        <p className="text-sm muted">
          {setup ? "Create a password to protect this workbench. You'll enter it each time you open the app." : "Enter your password to unlock."}
        </p>
        <div>
          <label className="label">{setup ? "New password" : "Password"}</label>
          <input autoFocus type="password" className="input" value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !setup) doLogin(); }} />
        </div>
        {setup && (
          <div>
            <label className="label">Confirm password</label>
            <input type="password" className="input" value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doSetup(); }} />
          </div>
        )}
        {error && <p className="alert-danger">{error}</p>}
        <button className="btn btn-primary w-full" onClick={setup ? doSetup : doLogin} disabled={busy || !pw}>
          {busy ? "Please wait…" : setup ? "Set password" : "Unlock"}
        </button>
      </div>
    </div>
  );
}
