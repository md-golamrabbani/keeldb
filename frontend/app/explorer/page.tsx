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
import { useUiStore } from "@/lib/uiStore";
import type { ConnectionProfile, TableInfo } from "@/lib/types";
import TableDocument from "@/components/explorer/TableDocument";
import ViewDocument from "@/components/explorer/ViewDocument";
import RoutinesView from "@/components/explorer/RoutinesView";
import SqlEditor from "@/components/explorer/SqlEditor";
import DesignerView from "@/components/explorer/DesignerView";
import HealthView from "@/components/explorer/HealthView";
import DatabaseMenu from "@/components/explorer/DatabaseMenu";
import Select from "@/components/ui/Select";
import GridTable from "@/components/explorer/GridTable";
import {
  IconColumns,
  IconDatabase,
  IconLock,
  IconSearch,
  IconTable,
  IconTerminal,
  IconBolt,
  IconWarning,
} from "@/components/icons";

type TabKind = "table" | "view" | "sql" | "designer" | "triggers" | "routines" | "health";
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
  view: IconSearch,
  sql: IconTerminal,
  designer: IconColumns,
  triggers: IconBolt,
  routines: IconBolt,
  health: IconDatabase,
};

/**
 * One independent database workspace: its own connection, schema, table list
 * and document tabs. Several sessions stay mounted side by side; the parent
 * hides inactive ones so their state (open tabs, grids, editors) survives.
 */
function ConnectionSession({
  wsId,
  connections,
  initialConnId,
  onLabelChange,
}: {
  wsId: string;
  connections: ConnectionProfile[];
  initialConnId?: string;
  onLabelChange: (label: string) => void;
}) {
  // Rehydrate from the UI store so leaving the page and coming back doesn't
  // lose the connection, schema, or open tabs.
  const saved = useUiStore.getState().explorer?.sessions[wsId];
  const setExplorerSession = useUiStore((s) => s.setExplorerSession);

  const [connId, setConnId] = useState(saved?.connId ?? initialConnId ?? "");
  const [schema, setSchema] = useState(saved?.schema ?? "");
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [views, setViews] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  const [tabs, setTabs] = useState<OpenTab[]>((saved?.tabs as OpenTab[]) ?? []);
  const [activeId, setActiveId] = useState(saved?.activeId ?? "");
  const idRef = useRef(saved ? Math.max(0, ...saved.tabs.map((t) => Number(t.id.slice(1)) || 0)) : 0);
  const uid = () => `t${++idRef.current}`;
  // Skip the "connection changed → reset" effects on the restore render.
  const restoring = useRef(!!saved);

  // Persist this session's shape whenever it changes.
  useEffect(() => {
    setExplorerSession(wsId, {
      connId, schema, activeId,
      tabs: tabs.map(({ id, kind, title, table, initialSub, nonce }) => ({ id, kind, title, table, initialSub, nonce })),
    });
  }, [wsId, connId, schema, tabs, activeId, setExplorerSession]);

  const conn = connections.find((c) => c.id === connId);
  const activeTab = tabs.find((t) => t.id === activeId);
  const activeTable = activeTab?.kind === "table" ? activeTab.table : "";

  // Keep the workspace tab label in sync with what this session points at.
  useEffect(() => {
    onLabelChange(conn ? (schema ? `${conn.name} · ${schema}` : conn.name) : "New workspace");
  }, [conn, schema]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTables = useCallback(() => {
    if (!connId || !schema) {
      setTables([]);
      setViews([]);
      return;
    }
    api
      .listTables(connId, schema)
      .then(setTables)
      .catch((e) => setError(String(e)));
    api
      .listViews(connId, schema)
      .then((vs) => setViews(vs.map((v) => v.name)))
      .catch(() => setViews([]));
  }, [connId, schema]);

  useEffect(() => {
    setSchemas([]);
    if (!restoring.current) setSchema(""); // keep the restored schema on first run
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

  // New schema/connection ⇒ close all open documents (they belong to the old
  // one) — except on the restore render, where the tabs ARE the point.
  useEffect(() => {
    if (restoring.current) {
      restoring.current = false;
      loadTables();
      return;
    }
    setTabs([]);
    setActiveId("");
    loadTables();
  }, [loadTables]);

  const filtered = useMemo(
    () =>
      tables.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase())),
    [tables, filter],
  );
  const filteredViews = useMemo(
    () => views.filter((v) => v.toLowerCase().includes(filter.toLowerCase())),
    [views, filter],
  );

  const openView = (name: string) => {
    const existing = tabs.find((t) => t.kind === "view" && t.table === name);
    if (existing) { setActiveId(existing.id); return; }
    const id = uid();
    setTabs((prev) => [...prev, { id, kind: "view", table: name, title: name, nonce: 0 }]);
    setActiveId(id);
  };

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
    <div className="flex h-full flex-col gap-4">
      <div className="toolbar shrink-0">
        <div className="flex items-center gap-2">
          <IconDatabase width={16} height={16} className="shrink-0" style={{ color: "var(--text-faint)" }} />
          <Select
            className="min-w-[13rem]"
            ariaLabel="Connection"
            placeholder="Select a connection…"
            value={connId}
            onValueChange={setConnId}
            options={connections.map((c) => ({ value: c.id, label: `${c.name} (${c.flavor})` }))}
          />
        </div>
        {schemas.length > 0 && (
          <>
            <span className="text-xs faint">/</span>
            <Select
              className="min-w-[9rem]"
              ariaLabel="Schema"
              placeholder="Select schema…"
              value={schema}
              onValueChange={setSchema}
              options={schemas.map((s) => ({ value: s, label: s }))}
            />
          </>
        )}

        {connId && schema && (
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center overflow-hidden rounded-lg border" style={{ borderColor: "var(--border-strong)" }}>
              {[
                { kind: "sql" as const, label: "SQL", Icon: IconTerminal },
                { kind: "designer" as const, label: "Designer", Icon: IconColumns },
                { kind: "triggers" as const, label: "Triggers", Icon: IconBolt },
                { kind: "routines" as const, label: "Routines", Icon: IconBolt },
                { kind: "health" as const, label: "Health", Icon: IconDatabase },
              ].map(({ kind, label, Icon }, i) => (
                <button key={kind}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
                  style={i > 0 ? { borderLeft: "1px solid var(--border)", color: "var(--text-muted)" } : { color: "var(--text-muted)" }}
                  onClick={() => openTool(kind, label)}>
                  <Icon width={14} height={14} /> <span className="hidden lg:inline">{label}</span>
                </button>
              ))}
            </div>
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
          {conn.environment === "prod" && (
            <span className="inline-flex items-center gap-1.5">
              <IconWarning width={14} height={14} /> PRODUCTION connection — writes require confirmation.
            </span>
          )}
          {conn.read_only && (
            <span className="inline-flex items-center gap-1.5">
              <IconLock width={14} height={14} /> Read-only — writes are blocked.
            </span>
          )}
        </div>
      )}

      {connId && schema && (
        <div className="flex min-h-0 flex-1 gap-5">
          {/* table list */}
          <div className="flex w-56 shrink-0 flex-col gap-2">
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
            <div className="card min-h-0 flex-1 overflow-y-auto p-1.5">
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
              {filteredViews.length > 0 && (
                <>
                  <p className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide faint">
                    Views
                  </p>
                  {filteredViews.map((v) => (
                    <button
                      key={`view:${v}`}
                      onClick={() => openView(v)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors"
                      style={
                        activeTab?.kind === "view" && activeTab.table === v
                          ? { background: "var(--accent-soft)", color: "var(--accent)" }
                          : { color: "var(--text-muted)" }
                      }
                    >
                      <IconSearch width={13} height={13} />
                      <span className="flex-1 truncate">{v}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* documents */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {tabs.length > 0 && (
              <div
                className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b"
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

            {/* Scroll region: the panes scroll here, so the toolbar, tab strip,
                and table list stay put (no whole-page scroll). Keep every open
                document mounted; show only the active one so per-tab state survives. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
            {tabs.map((t) => (
              <div key={t.id} className={t.id === activeId ? "h-full" : "hidden"}>
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
                {t.kind === "view" && t.table && (
                  <ViewDocument connId={connId} schema={schema} view={t.table} />
                )}
                {t.kind === "designer" && (
                  <DesignerView connId={connId} schema={schema} />
                )}
                {t.kind === "routines" && (
                  <RoutinesView connId={connId} schema={schema} />
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
              <div className="card flex h-full flex-col items-center justify-center py-16 text-center">
                <IconTable width={26} height={26} className="mb-2" />
                <p className="font-medium">No open tabs</p>
                <p className="text-sm muted">
                  Click a table on the left to open it in a tab — open as many
                  as you like and switch between them.
                </p>
              </div>
            )}
            </div>
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

interface Workspace {
  id: string;
  label: string;
  initialConnId?: string;
}

/**
 * Multi-database explorer: a strip of connection workspaces. Each workspace
 * is a fully independent ConnectionSession; all stay mounted so switching
 * between databases keeps every open document, grid and editor intact.
 */
function Explorer() {
  const params = useSearchParams();
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [error, setError] = useState("");

  // Rehydrate the workspace strip from the UI store (survives navigation).
  const savedExplorer = useUiStore.getState().explorer;
  const setExplorer = useUiStore((s) => s.setExplorer);
  const dropExplorerSession = useUiStore((s) => s.dropExplorerSession);

  const wsIdRef = useRef(savedExplorer?.wsCounter ?? 0);
  const newWsId = () => `ws${++wsIdRef.current}`;
  const [workspaces, setWorkspaces] = useState<Workspace[]>(savedExplorer?.workspaces ?? []);
  const [activeWs, setActiveWs] = useState(savedExplorer?.activeWs ?? "");

  // Persist the strip shape (session contents persist from inside each session).
  useEffect(() => {
    setExplorer({
      workspaces: workspaces.map(({ id, label }) => ({ id, label })),
      activeWs,
      wsCounter: wsIdRef.current,
    });
  }, [workspaces, activeWs, setExplorer]);

  useEffect(() => {
    api
      .listConnections()
      .then((cs) => {
        setConnections(cs);
        if (savedExplorer?.workspaces.length) return; // restored — don't reset
        const initial = params.get("conn");
        const id = newWsId();
        setWorkspaces([
          {
            id,
            label: "New workspace",
            initialConnId:
              initial && cs.some((c) => c.id === initial) ? initial : undefined,
          },
        ]);
        setActiveWs(id);
      })
      .catch((e) => setError(String(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addWorkspace = () => {
    const id = newWsId();
    setWorkspaces((prev) => [...prev, { id, label: "New workspace" }]);
    setActiveWs(id);
  };

  const closeWorkspace = (id: string) => {
    dropExplorerSession(id);
    setWorkspaces((prev) => {
      const idx = prev.findIndex((w) => w.id === id);
      const next = prev.filter((w) => w.id !== id);
      if (activeWs === id)
        setActiveWs(next.length ? next[Math.min(idx, next.length - 1)].id : "");
      return next;
    });
  };

  const setLabel = (id: string, label: string) =>
    setWorkspaces((prev) =>
      prev.some((w) => w.id === id && w.label !== label)
        ? prev.map((w) => (w.id === id ? { ...w, label } : w))
        : prev,
    );

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-6.5rem)]">
      {/* workspace strip */}
      <div
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b pb-0"
        style={{ borderColor: "var(--border)" }}
      >
        {workspaces.map((w) => {
          const active = w.id === activeWs;
          return (
            <div
              key={w.id}
              onClick={() => setActiveWs(w.id)}
              className="flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-b-0 px-3 py-1.5 text-sm font-medium"
              style={
                active
                  ? {
                      borderColor: "var(--border)",
                      background: "var(--surface-1, var(--surface-2))",
                      color: "var(--accent)",
                    }
                  : {
                      borderColor: "transparent",
                      color: "var(--text-muted)",
                    }
              }
            >
              <IconDatabase width={13} height={13} />
              <span className="max-w-[16rem] truncate">{w.label}</span>
              {workspaces.length > 1 && (
                <button
                  aria-label="Close workspace"
                  className="ml-1 rounded px-1 leading-none opacity-60 hover:opacity-100"
                  style={{ color: "inherit" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeWorkspace(w.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          aria-label="New workspace"
          title="Open another database side by side"
          onClick={addWorkspace}
          className="ml-1 flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
        >
          +<span className="hidden sm:inline"> Database</span>
        </button>
      </div>

      {error && <p className="alert-danger">{error}</p>}

      {/* All sessions stay mounted; only the active one is visible. */}
      <div className="min-h-0 flex-1">
        {workspaces.map((w) => (
          <div key={w.id} className={w.id === activeWs ? "h-full" : "hidden"}>
            <ConnectionSession
              wsId={w.id}
              connections={connections}
              initialConnId={w.initialConnId}
              onLabelChange={(label) => setLabel(w.id, label)}
            />
          </div>
        ))}
      </div>
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
