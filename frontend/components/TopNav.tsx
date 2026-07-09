"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import { IconArrows, IconBookmark, IconDatabase, IconTable, IconWrench } from "./icons";

const LINKS = [
  { href: "/", label: "Connections", icon: IconDatabase, match: (p: string) => p === "/" },
  { href: "/explorer", label: "Explorer", icon: IconTable, match: (p: string) => p.startsWith("/explorer") },
  { href: "/migrate", label: "Migrate", icon: IconArrows, match: (p: string) => p.startsWith("/migrate") },
  { href: "/toolkit", label: "Toolkit", icon: IconWrench, match: (p: string) => p.startsWith("/toolkit") },
  { href: "/profiles", label: "Saved Migrations", icon: IconBookmark, match: (p: string) => p.startsWith("/profiles") },
];

export default function TopNav() {
  const pathname = usePathname();
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
          <kbd className="hidden items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium lg:inline-flex"
            style={{ borderColor: "var(--border-strong)", color: "var(--text-faint)" }}
            title="Command palette">⌘K</kbd>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
