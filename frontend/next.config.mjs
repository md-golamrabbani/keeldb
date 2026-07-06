/** @type {import('next').NextConfig} */

// For the Tauri desktop build we need a static export (no Node server); the
// frontend talks to the Python sidecar directly (see lib/backend.ts). For the
// normal web app we keep the dev server + /api rewrite proxy to the backend.
const forTauri = process.env.TAURI === "1";

const nextConfig = forTauri
  ? {
      output: "export",
      images: { unoptimized: true },
      // static export can't rewrite; the app resolves the backend URL at runtime.
    }
  : {
      async rewrites() {
        const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
        return [{ source: "/api/:path*", destination: `${backend}/:path*` }];
      },
    };

export default nextConfig;
