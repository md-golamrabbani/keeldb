"use client";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { ConnectionProfile, TableInfo } from "@/lib/types";
import TableDocument from "@/components/explorer/TableDocument";
import SqlEditor from "@/components/explorer/SqlEditor";
import DesignerView from "@/components/explorer/DesignerView";
import HealthView from "@/components/explorer/HealthView";
import DatabaseMenu from "@/components/explorer/DatabaseMenu";
import GridTable from "@/components/explorer/GridTable";
import {
  IconColumns,
  IconDatabase,
  IconSearch,
  IconTable,
  IconTerminal,
  IconBolt,
} from "@/components/icons";

type TabKind = "table" | "sql" | "designer" | "triggers" | "health";
interface OpenTab {
  id: string;
  kind: TabKind;
  title: string;
  table?: string;
  initialFilter?: { column: string; value: string } | null;
  initialSub?: "data" | "structure" | "operations";
  nonce: number;
}

const KIND_ICON = {
  table: IconTable,
  sql: IconTerminal,
  designer: IconColumns,
  triggers: IconBolt,
  health: IconDatabase,
};

function Explorer() {
  const params = useSearchParams();
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [connId, setConnId] = useState("");
  const [schema, setSchema] = useState("");
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeId, setActiveId] = useState("");
  const idRef = useRef(0);
  const uid = () => `t${++idRef.current}`;

  const conn = connections.find((c) => c.id === connId);
  const activeTab = tabs.find((t) => t.id === activeId);
  const activeTable = activeTab?.kind === "table" ? activeTab.table : "";

  useEffect(() => {
    api
      .listConnections()
      .then((cs) => {
        setConnections(cs);
        const initial = params.get("conn");
        if (initial && cs.some((c) => c.id === initial)) setConnId(initial);
      })
      .catch((e) => setError(String(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTables = useCallback(() => {
    if (!connId || !schema) {
      setTables([]);
      return;
    }
    api
      .listTables(connId, schema)
      .then(setTables)
      .catch((e) => setError(String(e)));
  }, [connId, schema]);

  useEffect(() => {
    setSchemas([]);
    setSchema("");
    setTables([]);
    setError("");
    if (!connId) return;
    api
      .listSchemas(connId)
      .then((s) => {
        setSchemas(s);
        if (s.length === 1) setSchema(s[0]);
      })
      .catch((e) => setError(String(e)));
  }, [connId]);

  // New schema/connection ⇒ close all open documents (they belong to the old one).
  useEffect(() => {
    setTabs([]);
    setActiveId("");
    loadTables();
  }, [loadTables]);

  const filtered = useMemo(
    () =>
      tables.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase())),
    [tables, filter],
  );

  // ---- tab management ----
  const openTable = (name: string, sub: OpenTab["initialSub"] = "data") => {
    const existing = tabs.find((t) => t.kind === "table" && t.table === name);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const id = uid();
    setTabs((prev) => [
      ...prev,
      {
        id,
        kind: "table",
        table: name,
        title: name,
        initialSub: sub,
        nonce: 0,
      },
    ]);
    setActiveId(id);
  };

  const openTool = (kind: Exclude<TabKind, "table">, title: string) => {
    const existing = tabs.find((t) => t.kind === kind);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const id = uid();
    setTabs((prev) => [...prev, { id, kind, title, nonce: 0 }]);
    setActiveId(id);
  };

  const openReference = (
    targetTable: string,
    column: string,
    value: string,
  ) => {
    const existing = tabs.find(
      (t) => t.kind === "table" && t.table === targetTable,
    );
    if (existing) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === existing.id
            ? { ...t, initialFilter: { column, value }, nonce: t.nonce + 1 }
            : t,
        ),
      );
      setActiveId(existing.id);
    } else {
      const id = uid();
      setTabs((prev) => [
        ...prev,
        {
          id,
          kind: "table",
          table: targetTable,
          title: targetTable,
          initialFilter: { column, value },
          nonce: 0,
        },
      ]);
      setActiveId(id);
    }
  };

  const closeTab = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeId === id)
      setActiveId(next.length ? next[Math.min(idx, next.length - 1)].id : "");
  };

  const renameTab = (id: string, newName: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, table: newName, title: newName } : t,
      ),
    );
    loadTables();
  };
  const dropTab = (id: string) => {
    closeTab(id);
    loadTables();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[15rem]">
            <label className="label">Connection</label>
            <select
              className="select"
              value={connId}
              onChange={(e) => setConnId(e.target.value)}
            >
              <option value="">— select a connection —</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.flavor})
                </option>
              ))}
            </select>
          </div>
          {schemas.length > 0 && (
            <div className="min-w-[11rem]">
              <label className="label">Schema</label>
              <select
                className="select"
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
              >
                <option value="">— select —</option>
                {schemas.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {connId && schema && (
          <div className="flex items-center gap-2">
            <button
              className="btn btn-secondary btn-sm !h-9"
              onClick={() => openTool("sql", "SQL")}
            >
              <IconTerminal width={14} height={14} /> SQL
            </button>
            <button
              className="btn btn-secondary btn-sm !h-9"
              onClick={() => openTool("designer", "Designer")}
            >
              <IconColumns width={14} height={14} /> Designer
            </button>
            <button
              className="btn btn-secondary btn-sm !h-9"
              onClick={() => openTool("triggers", "Triggers")}
            >
              <IconBolt width={14} height={14} /> Triggers
            </button>
            <button
              className="btn btn-secondary btn-sm !h-9"
              onClick={() => openTool("health", "Health")}
            >
              <IconDatabase width={14} height={14} /> Health
            </button>
            <DatabaseMenu
              connId={connId}
              schema={schema}
              database={conn?.database || schema}
              onTableCreated={(n) => {
                loadTables();
                openTable(n, "structure");
              }}
            />
          </div>
        )}
      </div>

      {error && <p className="alert-danger">{error}</p>}

      {conn && (conn.environment === "prod" || conn.read_only) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
          style={conn.environment === "prod"
            ? { background: "var(--danger-soft)", color: "var(--danger)", border: "1px solid var(--danger)" }
            : { background: "var(--accent-soft)", color: "var(--accent)" }}>
          {conn.environment === "prod" && <span>⚠ PRODUCTION connection — writes require confirmation.</span>}
          {conn.read_only && <span>🔒 Read-only — writes are blocked.</span>}
        </div>
      )}

      {connId && schema && (
        <div className="flex gap-5">
          {/* table list */}
          <div className="w-56 shrink-0 space-y-2">
            <div className="relative">
              <IconSearch
                width={13}
                height={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ color: "var(--text-faint)" }}
              />
              <input
                className="input !h-9 !py-0 !pl-8 text-xs"
                placeholder="Filter tables…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="card max-h-[72vh] overflow-y-auto p-1.5">
              {filtered.map((t) => (
                <button
                  key={t.name}
                  onClick={() => openTable(t.name)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors"
                  style={
                    activeTable === t.name
                      ? {
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                        }
                      : { color: "var(--text-muted)" }
                  }
                >
                  <IconTable width={14} height={14} />
                  <span className="flex-1 truncate">{t.name}</span>
                  {t.row_estimate != null && (
                    <span className="text-[10px] faint">
                      {t.row_estimate.toLocaleString()}
                    </span>
                  )}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2 py-3 text-center text-xs muted">
                  No tables.
                </p>
              )}
            </div>
          </div>

          {/* documents */}
          <div className="min-w-0 flex-1 space-y-4">
            {tabs.length > 0 && (
              <div
                className="flex items-stretch gap-1 overflow-x-auto border-b"
                style={{ borderColor: "var(--border)" }}
              >
                {tabs.map((t) => {
                  const Icon = KIND_ICON[t.kind];
                  const active = t.id === activeId;
                  return (
                    <div
                      key={t.id}
                      onClick={() => setActiveId(t.id)}
                      className="group flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm"
                      style={
                        active
                          ? {
                              borderColor: "var(--accent)",
                              color: "var(--accent)",
                              background: "var(--accent-soft)",
                            }
                          : {
                              borderColor: "transparent",
                              color: "var(--text-muted)",
                            }
                      }
                    >
                      <Icon width={14} height={14} />
                      <span className="max-w-[14rem] truncate">{t.title}</span>
                      <button
                        aria-label="Close tab"
                        className="ml-1 rounded px-1 leading-none opacity-60 hover:opacity-100"
                        style={{ color: "inherit" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Keep every open document mounted; show only the active one so state
                (filters, scroll, sub-view, results) survives tab switches. */}
            {tabs.map((t) => (
              <div key={t.id} className={t.id === activeId ? "" : "hidden"}>
                {t.kind === "table" && t.table && (
                  <TableDocument
                    connId={connId}
                    schema={schema}
                    table={t.table}
                    initialFilter={t.initialFilter}
                    filterNonce={t.nonce}
                    initialSub={t.initialSub}
                    readOnly={conn?.read_only ?? false}
                    onOpenReference={openReference}
                    onRenamed={(n) => renameTab(t.id, n)}
                    onDropped={() => dropTab(t.id)}
                  />
                )}
                {t.kind === "sql" && (
                  <SqlEditor
                    connId={connId}
                    schema={schema}
                    table={activeTable || undefined}
                    flavor={conn?.flavor}
                    tableNames={tables.map((x) => x.name)}
                    environment={conn?.environment ?? "dev"}
                    readOnly={conn?.read_only ?? false}
                  />
                )}
                {t.kind === "designer" && (
                  <DesignerView connId={connId} schema={schema} />
                )}
                {t.kind === "health" && (
                  <HealthView connId={connId} schema={schema} />
                )}
                {t.kind === "triggers" && (
                  <GridTable
                    load={() => api.listTriggers(connId, schema)}
                    empty="No triggers in this schema."
                  />
                )}
              </div>
            ))}

            {tabs.length === 0 && (
              <div className="card card-pad py-16 text-center">
                <IconTable width={26} height={26} className="mx-auto mb-2" />
                <p className="font-medium">No open tabs</p>
                <p className="text-sm muted">
                  Click a table on the left to open it in a tab — open as many
                  as you like and switch between them.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {!connId && !error && (
        <div className="card card-pad flex flex-col items-center gap-2 py-16 text-center">
          <IconTable width={28} height={28} />
          <p className="font-medium">Connect to a database</p>
          <p className="text-sm muted">
            Select a connection to open tables in tabs, run SQL, edit rows &amp;
            structure, and view the ERD.
          </p>
        </div>
      )}
    </div>
  );
}

export default function ExplorerPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Explorer />
    </Suspense>
  );
}
