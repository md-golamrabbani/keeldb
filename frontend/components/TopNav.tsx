"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import { IconArrows, IconBookmark, IconColumns, IconDatabase, IconDownload, IconLock, IconTable, IconWrench } from "./icons";

export const APP_VERSION = "0.1.0";
const RELEASES_API = "https://api.github.com/repos/md-golamrabbani/MigrationStudio/releases/latest";
const RELEASES_PAGE = "https://github.com/md-golamrabbani/MigrationStudio/releases/latest";

function newer(latest: string, current: string): boolean {
  const p = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [a, b] = [p(latest), p(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

/** Checks GitHub releases once per session; silent on any failure (offline,
 * private repo, rate limit) — the banner only appears when an update exists. */
function useUpdateCheck(): string | null {
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const tag = j?.tag_name as string | undefined;
        if (tag && newer(tag, APP_VERSION)) setLatest(tag);
      })
      .catch(() => {});
  }, []);
  return latest;
}

const LINKS = [
  { href: "/", label: "Connections", icon: IconDatabase, match: (p: string) => p === "/" },
  { href: "/explorer", label: "Explorer", icon: IconTable, match: (p: string) => p.startsWith("/explorer") },
  { href: "/migrate", label: "Migrate", icon: IconArrows, match: (p: string) => p.startsWith("/migrate") },
  { href: "/diagrams", label: "Diagrams", icon: IconColumns, match: (p: string) => p.startsWith("/diagrams") },
  { href: "/toolkit", label: "Toolkit", icon: IconWrench, match: (p: string) => p.startsWith("/toolkit") },
  { href: "/profiles", label: "Saved Migrations", icon: IconBookmark, match: (p: string) => p.startsWith("/profiles") },
  { href: "/supabase-auth", label: "Supabase Auth", icon: IconLock, match: (p: string) => p.startsWith("/supabase-auth") },
];

export default function TopNav() {
  const pathname = usePathname();
  const latest = useUpdateCheck();
  return (
    <header className="z-30 shrink-0 border-b backdrop-blur"
      style={{ background: "color-mix(in srgb, var(--surface) 88%, transparent)", borderColor: "var(--border)" }}>
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-5 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="KeelDB home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={28} height={28} />
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">Keel<span style={{ color: "var(--accent)" }}>DB</span></span>
        </Link>

        <div className="divider hidden sm:block" />

        <nav className="flex items-center gap-0.5">
          {LINKS.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link key={href} href={href}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3 sm:py-2"
                style={active ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-muted)" }}>
                <Icon width={16} height={16} />
                <span className="hidden md:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {latest && (
            <a href={RELEASES_PAGE} target="_blank" rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold sm:inline-flex"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              title={`You are on v${APP_VERSION}; ${latest} is available`}>
              <IconDownload width={13} height={13} /> Update {latest}
            </a>
          )}
          <kbd className="hidden h-6 items-center justify-center gap-1 rounded-md border px-1.5 text-[11px] font-medium leading-none lg:inline-flex"
            style={{ borderColor: "var(--border-strong)", color: "var(--text-faint)" }}
            title="Command palette">⌘K</kbd>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
