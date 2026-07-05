"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import { IconArrows, IconBookmark, IconDatabase, IconTable } from "./icons";

const LINKS = [
  { href: "/", label: "Connections", icon: IconDatabase, match: (p: string) => p === "/" },
  { href: "/explorer", label: "Explorer", icon: IconTable, match: (p: string) => p.startsWith("/explorer") },
  { href: "/migrate", label: "Migrate", icon: IconArrows, match: (p: string) => p.startsWith("/migrate") },
  { href: "/profiles", label: "Saved Migrations", icon: IconBookmark, match: (p: string) => p.startsWith("/profiles") },
];

export default function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b" style={{ background: "var(--surface)" }}>
      <div className="flex h-14 items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>
            <IconArrows width={17} height={17} />
          </span>
          <span className="hidden text-sm font-semibold sm:inline">Migration Studio</span>
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link key={href} href={href}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                style={active ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-muted)" }}>
                <Icon width={16} height={16} />
                <span className="hidden md:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
