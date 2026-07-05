import type { Metadata } from "next";
import SideNav from "@/components/SideNav";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "DB Migration Studio",
  description:
    "GUI-driven database migration: MySQL / PostgreSQL / Supabase / Neon / .sql import",
};

// Set the theme before first paint to avoid a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className="flex h-screen overflow-hidden">
          <SideNav />
          <div className="flex flex-1 flex-col overflow-hidden">
            <header
              className="flex h-14 shrink-0 items-center justify-end border-b px-6"
              style={{ background: "var(--surface)" }}
            >
              <ThemeToggle />
            </header>
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto px-6 py-7">{children}</div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
