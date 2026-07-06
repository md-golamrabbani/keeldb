import type { Metadata } from "next";
import TopNav from "@/components/TopNav";
import BackendProvider from "@/components/BackendProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "DB Migration Studio",
  description:
    "GUI-driven database migration & explorer: MySQL / PostgreSQL / Supabase / Neon / .sql",
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
      </body>
    </html>
  );
}
