"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface Command {
  label: string;
  hint?: string;
  run: () => void;
}

// Global ⌘/Ctrl-K launcher: jump to a page or run a quick action.
export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const commands: Command[] = useMemo(() => {
    const go = (href: string) => () => { setOpen(false); router.push(href); };
    const toggleTheme = () => {
      const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", cur);
      try { localStorage.setItem("theme", cur); } catch {}
      setOpen(false);
    };
    return [
      { label: "Go to Migrate", hint: "wizard", run: go("/migrate") },
      { label: "Go to Explore", hint: "tables, SQL, health", run: go("/explorer") },
      { label: "Go to Projects & Profiles", hint: "mappings, projects, portable", run: go("/profiles") },
      { label: "Toggle light / dark theme", hint: "appearance", run: toggleTheme },
    ];
  }, [router]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? commands.filter((c) => (c.label + " " + (c.hint ?? "")).toLowerCase().includes(s)) : commands;
  }, [q, commands]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setOpen((o) => !o); setQ(""); setActive(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { setActive(0); }, [q]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl border shadow-lg"
        style={{ background: "var(--surface)", borderColor: "var(--border-strong)", boxShadow: "var(--shadow-lg)" }}
        onClick={(e) => e.stopPropagation()}>
        <input autoFocus className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
          style={{ borderColor: "var(--border)" }} placeholder="Type a command or search…"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); filtered[active]?.run(); }
          }} />
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.map((c, i) => (
            <li key={c.label}>
              <button className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm"
                style={i === active ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}
                onMouseEnter={() => setActive(i)} onClick={c.run}>
                <span className="flex-1">{c.label}</span>
                {c.hint && <span className="text-xs faint">{c.hint}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-4 py-3 text-center text-sm muted">No matching command.</li>}
        </ul>
        <div className="border-t px-4 py-1.5 text-[10px] faint" style={{ borderColor: "var(--border)" }}>
          ↑↓ navigate · ↵ select · esc close · ⌘/Ctrl-K toggle
        </div>
      </div>
    </div>
  );
}
