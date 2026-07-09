"use client";
import { useCallback, useEffect, useState } from "react";
import { api, clearToken, getToken, setToken, setOnUnauthorized } from "@/lib/api";
import Select from "@/components/ui/Select";
import { IconLock, IconWarning } from "@/components/icons";

type Phase = "loading" | "setup" | "login" | "forgot" | "blocked" | "ready";

const IDLE_MS = 60 * 60 * 1000;          // lock after 1 hour of no activity
const REFRESH_EVERY_MS = 10 * 60 * 1000; // extend the session at most every 10 min

const PRESET_QUESTIONS = [
  "What was the name of your first pet?",
  "What city were you born in?",
  "What was the name of your first school?",
  "What is your mother's maiden name?",
  "What was the make of your first car?",
];
const CUSTOM = "__custom__";

// Module-level so it keeps a stable identity across AuthGate re-renders —
// otherwise every keystroke remounts the form and steals focus.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6" style={{ background: "var(--bg)" }}>
      <div className="card card-pad w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={28} height={28} />
          <h1 className="text-lg font-semibold tracking-tight">Keel<span style={{ color: "var(--accent)" }}>DB</span></h1>
        </div>
        {children}
      </div>
    </div>
  );
}

// Full-screen unlock/setup (the app shell is hidden until unlocked). First launch
// sets a password + security question; forgotten passwords recover via the answer,
// with a permanent block after 3 wrong answers. Backend-unreachable never blocks.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [q, setQ] = useState(PRESET_QUESTIONS[0]);
  const [customQ, setCustomQ] = useState("");
  const [ans, setAns] = useState("");
  const [question, setQuestion] = useState(""); // stored question (for recovery screen)
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = (s: Awaited<ReturnType<typeof api.authStatus>>): Phase => {
    if (!s.enabled) return "ready";
    if (s.blocked) return "blocked";
    if (s.needs_setup) return "setup";
    setQuestion(s.question);
    return getToken() ? "ready" : "login";
  };

  useEffect(() => {
    setOnUnauthorized(() => setPhase("login"));
    let cancelled = false;
    const check = (attempt = 0) => {
      api.authStatus()
        .then((s) => { if (!cancelled) setPhase(decide(s)); })
        .catch(() => { if (!cancelled) attempt < 20 ? setTimeout(() => check(attempt + 1), 500) : setPhase("ready"); });
    };
    check();
    return () => { cancelled = true; };
  }, []);

  // 1-hour sliding session: refresh on activity, lock when idle.
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

  const fail = (e: unknown) => setError(String(e).replace(/^Error:\s*/, ""));

  const doSetup = useCallback(async () => {
    const question = (q === CUSTOM ? customQ : q).trim();
    if (pw.length < 4) return setError("Use at least 4 characters.");
    if (pw !== pw2) return setError("Passwords don't match.");
    if (!question) return setError("Choose or write a security question.");
    if (!ans.trim()) return setError("Enter a security answer.");
    setBusy(true); setError("");
    try {
      const { token } = await api.authSetup(pw, question, ans);
      setToken(token); setPw(""); setPw2(""); setAns(""); setPhase("ready");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [pw, pw2, q, customQ, ans]);

  const doLogin = useCallback(async () => {
    setBusy(true); setError("");
    try { const { token } = await api.login(pw); setToken(token); setPw(""); setPhase("ready"); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }, [pw]);

  const doRecover = useCallback(async () => {
    if (pw.length < 4) return setError("New password: use at least 4 characters.");
    if (pw !== pw2) return setError("Passwords don't match.");
    setBusy(true); setError("");
    try {
      const r = await api.authRecover(ans, pw);
      if (r.ok && r.token) { setToken(r.token); setPw(""); setPw2(""); setAns(""); setPhase("ready"); }
      else if (r.blocked) { setPhase("blocked"); }
      else { setAttemptsLeft(r.attempts_left ?? null); setError(`Wrong answer. ${r.attempts_left ?? 0} attempt(s) left before the app is permanently locked.`); }
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [ans, pw, pw2]);

  if (phase === "loading") return <div className="flex flex-1 items-center justify-center text-sm muted">Loading…</div>;
  if (phase === "ready") return <>{children}</>;

  if (phase === "blocked") {
    return (
      <Shell>
        <div className="rounded-lg px-3 py-3 text-sm font-medium" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
          <span className="inline-flex items-center gap-1.5">
            <IconLock width={14} height={14} className="shrink-0" /> This app is permanently locked after too many failed recovery attempts.
          </span>
        </div>
        <p className="text-xs faint">The local database data is intact but can no longer be unlocked from here.</p>
      </Shell>
    );
  }

  if (phase === "setup") {
    return (
      <Shell>
        <p className="text-sm muted">Create a password to protect this workbench, plus a security question in case you forget it.</p>
        <div>
          <label className="label">New password</label>
          <input autoFocus type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div>
          <label className="label">Confirm password</label>
          <input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        <div>
          <label className="label">Security question</label>
          <Select className="w-full" value={q} onValueChange={setQ}
            options={[...PRESET_QUESTIONS.map((x) => ({ value: x, label: x })), { value: CUSTOM, label: "Write my own…" }]} />
          {q === CUSTOM && (
            <input className="input mt-2" placeholder="Your question" value={customQ} onChange={(e) => setCustomQ(e.target.value)} />
          )}
        </div>
        <div>
          <label className="label">Answer</label>
          <input className="input" value={ans} onChange={(e) => setAns(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doSetup(); }} />
        </div>
        {error && <p className="alert-danger">{error}</p>}
        <button className="btn btn-primary w-full" onClick={doSetup} disabled={busy || !pw}>{busy ? "Please wait…" : "Set password"}</button>
      </Shell>
    );
  }

  if (phase === "forgot") {
    return (
      <Shell>
        <p className="text-sm muted">Answer your security question to set a new password.</p>
        <div>
          <label className="label">{question || "Security question"}</label>
          <input autoFocus className="input" value={ans} onChange={(e) => setAns(e.target.value)} />
        </div>
        <div>
          <label className="label">New password</label>
          <input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {attemptsLeft !== null && attemptsLeft <= 2 && (
          <p className="flex items-center gap-1.5 text-xs" style={{ color: "var(--warning)" }}>
            <IconWarning width={13} height={13} className="shrink-0" /> {attemptsLeft} attempt(s) left before the app is permanently locked.
          </p>
        )}
        {error && <p className="alert-danger">{error}</p>}
        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={() => { setError(""); setPhase("login"); }}>Back</button>
          <button className="btn btn-primary flex-1" onClick={doRecover} disabled={busy || !ans || !pw}>{busy ? "…" : "Reset password"}</button>
        </div>
      </Shell>
    );
  }

  // login
  return (
    <Shell>
      <p className="text-sm muted">Enter your password to unlock.</p>
      <div>
        <label className="label">Password</label>
        <input autoFocus type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") doLogin(); }} />
      </div>
      {error && <p className="alert-danger">{error}</p>}
      <button className="btn btn-primary w-full" onClick={doLogin} disabled={busy || !pw}>{busy ? "Unlocking…" : "Unlock"}</button>
      <button className="w-full text-center text-xs muted hover:underline" onClick={() => { setError(""); setPw(""); setPw2(""); setAns(""); setPhase("forgot"); }}>
        Forgot password?
      </button>
    </Shell>
  );
}
