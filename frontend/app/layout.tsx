import type { Metadata } from "next";
import TopNav from "@/components/TopNav";
import Toaster from "@/components/Toaster";
import BackendProvider from "@/components/BackendProvider";
import CommandPalette from "@/components/CommandPalette";
import AuthGate from "@/components/AuthGate";
import Splash from "@/components/Splash";
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
      <body className="flex h-screen flex-col overflow-hidden">
        <Splash />
        {/* AuthGate hides the whole shell (nav + content) until the app is
            unlocked; when unlocked it renders the normal chrome. */}
        <AuthGate>
          <TopNav />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1600px] px-4 pb-8 pt-4 sm:px-6">
              <BackendProvider>{children}</BackendProvider>
            </div>
          </main>
          <CommandPalette />
          <Toaster />
        </AuthGate>
      </body>
    </html>
  );
}
