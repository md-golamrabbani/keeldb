"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { IconDownload, IconUpload } from "./icons";

// Export/import connections (without secrets) + mappings/projects/snippets/alerts
// as a portable JSON bundle, for sharing setups between machines.
export default function PortabilityBar({ onImported }: { onImported: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const exportBundle = async () => {
    setError(""); setMsg("");
    try {
      const bundle = await api.exportPortable();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `migration-studio-bundle-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(String(e)); }
  };

  const importFile = async (file: File) => {
    setError(""); setMsg("");
    try {
      const bundle = JSON.parse(await file.text());
      const res = await api.importPortable(bundle);
      const c = res.imported;
      setMsg(`Imported ${c.connections} connection(s), ${c.mappings} mapping(s), ${c.projects} project(s), ${c.snippets} snippet(s), ${c.alerts} alert(s).`);
      onImported();
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="card card-pad flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold">Portable setup</h2>
        <p className="text-sm muted">Export your connections (without passwords), mappings, projects, snippets, and alerts — or import a shared bundle.</p>
      </div>
      <input ref={fileInput} type="file" accept="application/json,.json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.currentTarget.value = ""; }} />
      <button className="btn btn-secondary" onClick={() => fileInput.current?.click()}><IconUpload width={15} height={15} /> Import</button>
      <button className="btn btn-primary" onClick={exportBundle}><IconDownload width={15} height={15} /> Export</button>
      {msg && <p className="w-full text-xs" style={{ color: "var(--success)" }}>{msg}</p>}
      {error && <p className="w-full alert-danger">{error}</p>}
    </div>
  );
}
