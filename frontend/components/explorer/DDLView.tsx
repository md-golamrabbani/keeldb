"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ErrorBanner from "./ErrorBanner";
import { IconRefresh, IconDownload } from "@/components/icons";
import { downloadFile } from "@/lib/toast";

// The reconstructed CREATE TABLE for this table — its own tab alongside
// Data / Structure / Operations.
export default function DDLView({ connId, schema, table }: { connId: string; schema: string; table: string }) {
  const [ddl, setDdl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = () => {
    setLoading(true); setError("");
    api.tableDdl(connId, schema, table).then((r) => setDdl(r.ddl)).catch((e) => setError(String(e))).finally(() => setLoading(false));
  };
  useEffect(load, [connId, schema, table]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => { await navigator.clipboard.writeText(ddl); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const download = () => downloadFile(ddl, `${table}.sql`, "application/sql");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm muted">The <code>CREATE TABLE</code> statement for <span className="font-mono">{table}</span>.</p>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}><IconRefresh width={13} height={13} /> Refresh</button>
          <button className="btn btn-secondary btn-sm" onClick={copy} disabled={!ddl}>{copied ? "Copied" : "Copy"}</button>
          <button className="btn btn-secondary btn-sm" onClick={download} disabled={!ddl}><IconDownload width={13} height={13} /> .sql</button>
        </div>
      </div>
      <ErrorBanner message={error} onClose={() => setError("")} />
      <pre className="card overflow-x-auto p-4 text-xs leading-relaxed" style={{ background: "var(--surface-2)" }}>{ddl || (loading ? "Loading…" : "")}</pre>
    </div>
  );
}
