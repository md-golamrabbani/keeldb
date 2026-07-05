"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconArrows, IconBookmark, IconDatabase } from "./icons";

const LINKS = [
  { href: "/", label: "Connections", icon: IconDatabase, match: (p: string) => p === "/" },
  { href: "/migrate", label: "Migrate", icon: IconArrows, match: (p: string) => p.startsWith("/migrate") },
  { href: "/profiles", label: "Saved Migrations", icon: IconBookmark, match: (p: string) => p.startsWith("/profiles") },
];

export default function SideNav() {
  const pathname = usePathname();
  return (
    <aside
      className="flex w-60 shrink-0 flex-col gap-1 border-r p-3"
      style={{ background: "var(--surface)" }}
    >
      <div className="mb-4 flex items-center gap-2.5 px-2 pt-2">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
        >
          <IconArrows width={18} height={18} />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Migration Studio</div>
          <div className="text-[11px] faint">MySQL · Postgres · SQL</div>
        </div>
      </div>
      {LINKS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            style={
              active
                ? { background: "var(--accent-soft)", color: "var(--accent)" }
                : { color: "var(--text-muted)" }
            }
          >
            <Icon width={17} height={17} />
            {label}
          </Link>
        );
      })}
      <div className="mt-auto px-2 pb-2 text-[11px] faint">v1 · runs locally</div>
    </aside>
  );
}
