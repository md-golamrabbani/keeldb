import type { Metadata } from "next";
import TopNav from "@/components/TopNav";
import BackendProvider from "@/components/BackendProvider";
import CommandPalette from "@/components/CommandPalette";
import "./globals.css";

export const metadata: Metadata = {
  title: "KeelDB — production-safe database workbench",
  description:
    "Migrate, explore, guard, and monitor MySQL / PostgreSQL / Supabase / Neon databases from one clean workbench.",
  icons: { icon: "/logo.png" },
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
        <TopNav />
        <main className="mx-auto w-full max-w-[1600px] px-6 pb-7 pt-3">
          <BackendProvider>{children}</BackendProvider>
        </main>
        <CommandPalette />
      </body>
    </html>
  );
}
