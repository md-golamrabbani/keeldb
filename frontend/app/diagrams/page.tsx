"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  getRectOfNodes,
  getTransformForBounds,
} from "reactflow";
import "reactflow/dist/style.css";
import { toPng } from "html-to-image";
import dagre from "dagre";
import { api } from "@/lib/api";
import {
  parseDbml, exportSql, importSql, graphToDbml, diffGraphs, buildSyncScript, STARTER_DBML,
  type DbmlGraph, type DbmlError, type DbmlEnum, type DbmlTable,
} from "@/lib/dbml";
import type { ConnectionProfile } from "@/lib/types";
import Modal from "@/components/explorer/Modal";
import AiSettingsModal from "@/components/explorer/AiSettingsModal";
import DbmlCodeEditor from "@/components/diagrams/DbmlCodeEditor";
import Select from "@/components/ui/Select";
import { downloadFile, toast } from "@/lib/toast";
import { useUiStore } from "@/lib/uiStore";
import {
  IconBolt, IconChevronDown, IconDownload, IconLayers, IconMaximize, IconMinimize, IconPlay, IconPlus, IconRefresh, IconSearch, IconSettings, IconSparkles, IconTrash, IconUpload, IconWarning,
} from "@/components/icons";

const NODE_W = 240;
const HEADER_H = 34;
const ROW_H = 22;
const EDGE_COLORS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#14b8a6", "#f97316", "#ec4899", "#84cc16",
];

// ---- canvas table node -------------------------------------------------------
function TableNode({ data }: NodeProps<{ table: DbmlTable }>) {
  const t = data.table;
  return (
    <div className="overflow-hidden rounded-lg border text-xs"
      style={{ width: NODE_W, background: "var(--surface)", borderColor: "var(--border-strong)", boxShadow: "var(--shadow)" }}>
      <div className="px-3 py-2 font-semibold" title={t.note || undefined}
        style={{ background: "var(--accent-soft)", color: "var(--accent)", height: HEADER_H }}>
        {t.name}
      </div>
      <div>
        {t.columns.map((c) => (
          <div key={c.name} className="relative flex items-center gap-1.5 border-t px-3 font-mono"
            style={{ height: ROW_H, borderColor: "var(--border)" }} title={c.note || undefined}>
            <Handle type="target" position={Position.Left} id={`t-${c.name}`} style={{ opacity: 0, left: 0 }} isConnectable={false} />
            <Handle type="source" position={Position.Right} id={`s-${c.name}`} style={{ opacity: 0, right: 0 }} isConnectable={false} />
            {c.pk && <span className="h-1.5 w-1.5 shrink-0 rounded-full" title="Primary key" style={{ background: "var(--warning)" }} />}
            <span className="truncate" style={{ color: "var(--text)", fontWeight: c.pk ? 600 : 400 }}>{c.name}</span>
            <span className="ml-auto truncate pl-2" style={{ color: "var(--text-faint)" }}>
              {c.type}{c.notNull ? "" : "?"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
function EnumNode({ data }: NodeProps<{ enum: DbmlEnum }>) {
  const e = data.enum;
  return (
    <div className="overflow-hidden rounded-lg border border-dashed text-xs"
      style={{ width: 180, background: "var(--surface)", borderColor: "var(--warning)", boxShadow: "var(--shadow)" }}>
      <div className="px-3 py-2 font-semibold" style={{ background: "color-mix(in srgb, var(--warning) 14%, transparent)", color: "var(--warning)", height: HEADER_H }}>
        «enum» {e.name}
      </div>
      {e.values.map((v) => (
        <div key={v} className="border-t px-3 font-mono" style={{ height: ROW_H, lineHeight: `${ROW_H}px`, borderColor: "var(--border)", color: "var(--text-muted)" }}>
          {v}
        </div>
      ))}
    </div>
  );
}

const nodeTypes = { table: TableNode, enum: EnumNode };

type Positions = Record<string, { x: number; y: number }>;

interface LayoutItem { id: string; rows: number; width: number }

function layoutItems(graph: DbmlGraph): LayoutItem[] {
  return [
    ...graph.tables.map((t) => ({ id: t.name, rows: t.columns.length, width: NODE_W })),
    ...graph.enums.map((e) => ({ id: `enum:${e.name}`, rows: e.values.length, width: 180 })),
  ];
}

function autoPositions(graph: DbmlGraph, existing: Positions): Positions {
  const items = layoutItems(graph);
  const perRow = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(items.length || 1))));
  const GAP_X = 90, GAP_Y = 70, PAD = 20;
  const out: Positions = {};
  let x = PAD, y = PAD, col = 0, rowMaxH = 0;
  for (const it of items) {
    const h = HEADER_H + it.rows * ROW_H;
    out[it.id] = existing[it.id] ?? { x, y };
    rowMaxH = Math.max(rowMaxH, h);
    col++;
    if (col >= perRow) { col = 0; x = PAD; y += rowMaxH + GAP_Y; rowMaxH = 0; }
    else x += NODE_W + GAP_X;
  }
  return out;
}

/** Layered auto-layout (dagre): FK edges flow left→right, minimal crossings. */
function dagreLayout(graph: DbmlGraph): Positions {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 55, ranksep: 110, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const it of layoutItems(graph)) {
    g.setNode(it.id, { width: it.width, height: HEADER_H + it.rows * ROW_H });
  }
  for (const r of graph.refs) {
    if (g.hasNode(r.fromTable) && g.hasNode(r.toTable)) g.setEdge(r.fromTable, r.toTable);
  }
  dagre.layout(g);
  const out: Positions = {};
  for (const id of g.nodes()) {
    const n = g.node(id);
    out[id] = { x: n.x - n.width / 2, y: n.y - n.height / 2 };
  }
  return out;
}

interface ChatMsg { role: "user" | "assistant"; text: string }

export default function DiagramsPage() {
  // Rehydrate from the UI store so navigating away and back keeps the draft.
  const draft = useUiStore.getState().diagram;
  const setDraft = useUiStore((s) => s.setDiagram);

  const [name, setName] = useState(draft?.name ?? "Untitled diagram");
  const [diagramId, setDiagramId] = useState<string>(draft?.diagramId ?? "");
  const [src, setSrc] = useState(draft?.src ?? STARTER_DBML);
  const [graph, setGraph] = useState<DbmlGraph>({ tables: [], refs: [], enums: [] });
  const [parseError, setParseError] = useState<DbmlError | null>(null);
  const [positions, setPositions] = useState<Positions>(draft?.positions ?? {});

  // Persist the draft on every meaningful change (in-memory across navigation).
  useEffect(() => {
    setDraft({
      diagramId, name, src, positions,
      savedName: savedRef.current?.name ?? null,
      savedDbml: savedRef.current?.dbml ?? null,
    });
  }, [diagramId, name, src, positions, setDraft]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [nameDialog, setNameDialog] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);
  // what was last persisted — powers the unsaved-changes indicator
  const savedRef = useRef<{ name: string; dbml: string } | null>(
    draft?.savedName != null && draft?.savedDbml != null
      ? { name: draft.savedName, dbml: draft.savedDbml }
      : null,
  );
  const dirty = !savedRef.current || savedRef.current.dbml !== src || savedRef.current.name !== name;

  const [openList, setOpenList] = useState<{ id: string; name: string; updated_at: string }[] | null>(null);
  const [openSearch, setOpenSearch] = useState("");
  // always-visible saved-diagrams sidebar
  const [sideList, setSideList] = useState<{ id: string; name: string; updated_at: string }[]>([]);
  const [sideSearch, setSideSearch] = useState("");
  const refreshList = useCallback(() => {
    api.listDiagrams().then(setSideList).catch(() => {});
  }, []);
  useEffect(refreshList, [refreshList]);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [importMenu, setImportMenu] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [importDb, setImportDb] = useState(false);

  // AI chat
  const [chatOpen, setChatOpen] = useState(true);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [pendingAi, setPendingAi] = useState<{ dbml: string; changes: string[] } | null>(null);
  const [applyDb, setApplyDb] = useState(false);
  const undoRef = useRef<string[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const flowRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileKind = useRef<"dbml" | "mysql" | "postgres">("dbml");

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(""), 2500); };

  // ---- live parse (debounced) ----
  useEffect(() => {
    let cancel = false;
    const t = setTimeout(async () => {
      const { graph: g, error: e } = await parseDbml(src);
      if (cancel) return;
      setParseError(e);
      if (g) setGraph(g); // node/position sync happens in the graph effect
    }, 400);
    return () => { cancel = true; clearTimeout(t); };
  }, [src]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, aiBusy]);

  // ---- flow nodes/edges ----
  // useNodesState (not fully-controlled nodes) so React Flow can store each
  // node's measured size — without that, v11 keeps nodes invisible forever.
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const positionsRef = useRef<Positions>({});
  positionsRef.current = positions;

  useEffect(() => {
    const pos = autoPositions(graph, positionsRef.current);
    setPositions(pos);
    setNodes([
      ...graph.tables.map((t) => ({
        id: t.name,
        type: "table",
        position: pos[t.name],
        data: { table: t },
      })),
      ...graph.enums.map((e) => ({
        id: `enum:${e.name}`,
        type: "enum",
        position: pos[`enum:${e.name}`],
        data: { enum: e },
      })),
    ]);
  }, [graph, setNodes]);

  const applyLayout = () => {
    const pos = dagreLayout(graph);
    setPositions(pos);
    setNodes((ns) => ns.map((n) => ({ ...n, position: pos[n.id] ?? n.position })));
  };

  const edges: Edge[] = useMemo(
    () =>
      graph.refs.map((r, i) => {
        const color = EDGE_COLORS[i % EDGE_COLORS.length];
        return {
          id: `e${i}`,
          source: r.fromTable,
          sourceHandle: `s-${r.fromCol}`,
          target: r.toTable,
          targetHandle: `t-${r.toCol}`,
          type: "smoothstep",
          animated: true,
          label: `${r.fromCol} → ${r.toCol}`,
          labelStyle: { fontSize: 10, fill: color },
          labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.85 },
          style: { stroke: color, strokeWidth: 1.6, opacity: 0.85 },
        };
      }),
    [graph],
  );

  // persist drags into the positions map (saved with the diagram)
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    setPositions((p) => ({ ...p, [node.id]: { x: node.position.x, y: node.position.y } }));
  }, []);

  // ---- toolbar actions ----
  const newDiagram = () => {
    undoRef.current = [];
    savedRef.current = null;
    setDiagramId(""); setName("Untitled diagram"); setSrc(STARTER_DBML);
    setPositions({}); setChat([]); flash("New diagram");
  };

  const doSave = async (saveName: string, asCopy = false) => {
    setSaving(true); setError("");
    try {
      const d = await api.saveDiagram({
        id: asCopy ? undefined : diagramId || undefined,
        name: asCopy && diagramId ? `${saveName} (copy)` : saveName,
        dbml: src, positions,
      });
      setDiagramId(d.id);
      setName(d.name);
      savedRef.current = { name: d.name, dbml: src };
      setNameDialog(false);
      refreshList();
      flash(`Saved "${d.name}"`);
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };

  // First save (or a still-untitled diagram) asks for a proper name so
  // diagrams never pile up as "Untitled diagram …".
  const save = (asCopy = false) => {
    if (asCopy) return doSave(name, true);
    if (!diagramId || /^untitled diagram/i.test(name.trim())) setNameDialog(true);
    else doSave(name);
  };

  const openDiagram = async (id: string) => {
    try {
      const d = await api.getDiagram(id);
      undoRef.current = [];
      savedRef.current = { name: d.name, dbml: d.dbml };
      setDiagramId(d.id); setName(d.name); setSrc(d.dbml);
      setPositions(d.positions ?? {}); setOpenList(null); setChat([]);
    } catch (e) { setError(String(e)); }
  };

  const importFromConnection = async (conn: ConnectionProfile, schema: string) => {
    try {
      const g = await api.schemaGraph(conn.id, schema);
      setSrc(graphToDbml(g));
      setPositions({});
      setImportDb(false);
      flash(`Imported ${g.tables.length} tables from ${conn.name}`);
    } catch (e) { setError(String(e)); }
  };

  const onFile = async (f: File) => {
    try {
      const text = await f.text();
      if (fileKind.current === "dbml") setSrc(text);
      else setSrc(await importSql(text, fileKind.current));
      setPositions({});
      flash(`Imported ${f.name}`);
    } catch (e) { setError(`Import failed: ${String((e as { diags?: { message: string }[] })?.diags?.[0]?.message ?? e)}`); }
  };

  const download = (content: string, filename: string) => downloadFile(content, filename);

  const renderPng = async (): Promise<string | null> => {
    const el = flowRef.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!el) return null;
    const rect = getRectOfNodes(nodes);
    const W = Math.min(4096, Math.max(800, Math.ceil(rect.width + 80)));
    const H = Math.min(4096, Math.max(600, Math.ceil(rect.height + 80)));
    const [tx, ty, zoom] = getTransformForBounds(rect, W, H, 0.2, 2);
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
    return toPng(el, {
      width: W, height: H, backgroundColor: bg,
      style: { width: `${W}px`, height: `${H}px`, transform: `translate(${tx}px, ${ty}px) scale(${zoom})` },
    });
  };

  const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const doExport = async (kind: "mysql" | "postgres" | "dbml" | "png" | "html") => {
    setExportMenu(false); setError("");
    try {
      if (kind === "dbml") return download(src, `${name || "diagram"}.dbml`);
      if (kind === "png") {
        const url = await renderPng();
        if (!url) return;
        const a = document.createElement("a");
        a.href = url; a.download = `${name || "diagram"}.png`; a.click();
        toast(`Downloaded ${a.download}`);
        return;
      }
      if (kind === "html") {
        // Single self-contained file: diagram image + DBML source — mail it,
        // drop it in a wiki, no KeelDB needed to view it.
        const url = await renderPng();
        if (!url) return;
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)} — ER diagram</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:1100px;padding:0 1rem;color:#1f2937}
img{max-width:100%;border:1px solid #e5e7eb;border-radius:12px}
details{margin-top:1.5rem}pre{background:#f3f4f6;border-radius:8px;padding:1rem;overflow:auto;font-size:13px}
.meta{color:#6b7280;font-size:14px}</style></head><body>
<h1>${escapeHtml(name)}</h1>
<p class="meta">${graph.tables.length} tables · ${graph.refs.length} relationships · exported ${new Date().toLocaleString()} · made with KeelDB</p>
<img src="${url}" alt="ER diagram">
<details><summary>DBML source</summary><pre>${escapeHtml(src)}</pre></details>
</body></html>`;
        return download(html, `${name || "diagram"}.html`);
      }
      download(await exportSql(src, kind), `${name || "diagram"}.${kind === "mysql" ? "mysql" : "pg"}.sql`);
    } catch (e) {
      setError(`Export failed: ${String((e as { diags?: { message: string }[] })?.diags?.[0]?.message ?? e)}`);
    }
  };

  // ---- AI chat: propose → preview diff → apply/discard ----
  const send = async () => {
    const q = chatInput.trim();
    if (!q || aiBusy) return;
    setChat((c) => [...c, { role: "user", text: q }]);
    setChatInput(""); setAiBusy(true); setPendingAi(null);
    try {
      const r = await api.aiDiagram(src, q);
      if (!r.available || !r.dbml) {
        setChat((c) => [...c, { role: "assistant", text: r.message || "AI assist is not configured — click the gear above to add a provider & key." }]);
      } else {
        const { graph: newGraph, error: pe } = await parseDbml(r.dbml);
        if (!newGraph) {
          setChat((c) => [...c, { role: "assistant", text: `The AI returned invalid DBML (${pe?.message ?? "parse error"}) — try rephrasing.` }]);
        } else {
          const changes = diffGraphs(graph, newGraph);
          setPendingAi({ dbml: r.dbml, changes });
          setChat((c) => [...c, { role: "assistant", text: `Here's what would change${r.model ? ` (${r.model})` : ""} — review below, then Apply or Discard.` }]);
        }
      }
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", text: String(e) }]);
    } finally {
      setAiBusy(false);
    }
  };

  const applyAi = () => {
    if (!pendingAi) return;
    undoRef.current.push(src);
    setSrc(pendingAi.dbml);
    setPendingAi(null);
    setChat((c) => [...c, { role: "assistant", text: "Applied. Use Undo AI in the toolbar to revert." }]);
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (prev != null) { setSrc(prev); flash("Reverted"); }
  };

  const menuBtn = "block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-2)]";

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-6.5rem)]">
      {/* toolbar */}
      <div className="toolbar shrink-0">
        <input className="input !h-9 !w-56" value={name} onChange={(e) => setName(e.target.value)} aria-label="Diagram name" />
        <button className="btn btn-secondary btn-sm !h-9" onClick={newDiagram}><IconPlus width={14} height={14} /> New</button>
        <button className="btn btn-secondary btn-sm !h-9"
          onClick={() => { setOpenSearch(""); api.listDiagrams().then(setOpenList).catch((e) => setError(String(e))); }}>Open</button>
        <button className="btn btn-primary btn-sm !h-9" onClick={() => save(false)} disabled={saving || !name.trim()}
          title={dirty ? "You have unsaved changes" : "All changes saved"}>
          {saving ? "Saving…" : diagramId ? "Save" : "Save as…"}
          {dirty && <span aria-label="Unsaved changes" className="ml-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--warning)" }} />}
        </button>
        {diagramId && (
          <button className="btn btn-secondary btn-sm !h-9" onClick={() => save(true)} disabled={saving}
            title="Save a copy under a new name">Save copy</button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {undoRef.current.length > 0 && (
            <button className="btn btn-secondary btn-sm !h-9" onClick={undo} title="Revert the last AI edit">
              <IconRefresh width={14} height={14} /> Undo AI
            </button>
          )}
          <button className="btn btn-secondary btn-sm !h-9" onClick={applyLayout}
            title="Layered auto-layout: FK edges flow left to right">
            <IconLayers width={14} height={14} /> <span className="hidden xl:inline">Auto-layout</span>
          </button>
          <button className="btn btn-secondary btn-sm !h-9" onClick={() => setApplyDb(true)}
            disabled={graph.tables.length === 0 || !!parseError}
            title="Generate the DDL and run it on a connection">
            <IconPlay width={14} height={14} /> <span className="hidden xl:inline">Apply to database</span>
          </button>
          <div className="relative">
            <button className="btn btn-secondary btn-sm !h-9" onClick={() => setImportMenu((o) => !o)}>
              <IconUpload width={14} height={14} /> Import <IconChevronDown width={13} height={13} style={{ color: "var(--text-faint)" }} />
            </button>
            {importMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setImportMenu(false)} />
                <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border py-1 shadow-lg" style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}>
                  <button className={menuBtn} onClick={() => { setImportMenu(false); setImportDb(true); }}>From live connection…</button>
                  <button className={menuBtn} onClick={() => { setImportMenu(false); fileKind.current = "mysql"; fileInput.current?.click(); }}>From MySQL .sql dump</button>
                  <button className={menuBtn} onClick={() => { setImportMenu(false); fileKind.current = "postgres"; fileInput.current?.click(); }}>From PostgreSQL .sql dump</button>
                  <button className={menuBtn} onClick={() => { setImportMenu(false); fileKind.current = "dbml"; fileInput.current?.click(); }}>From .dbml file</button>
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <button className="btn btn-secondary btn-sm !h-9" onClick={() => setExportMenu((o) => !o)}>
              <IconDownload width={14} height={14} /> Export <IconChevronDown width={13} height={13} style={{ color: "var(--text-faint)" }} />
            </button>
            {exportMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportMenu(false)} />
                <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border py-1 shadow-lg" style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}>
                  <button className={menuBtn} onClick={() => doExport("mysql")}>MySQL DDL (.sql)</button>
                  <button className={menuBtn} onClick={() => doExport("postgres")}>PostgreSQL DDL (.sql)</button>
                  <button className={menuBtn} onClick={() => doExport("dbml")}>DBML source (.dbml)</button>
                  <button className={menuBtn} onClick={() => doExport("png")}>PNG image</button>
                  <button className={menuBtn} onClick={() => doExport("html")}>Standalone HTML (shareable)</button>
                </div>
              </>
            )}
          </div>
          <button className="btn btn-sm !h-9" onClick={() => setChatOpen((o) => !o)}
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <IconSparkles width={14} height={14} /> AI assistant
          </button>
        </div>
      </div>

      <input ref={fileInput} type="file" className="hidden" accept=".sql,.dbml,.txt,text/plain"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} />

      {notice && <p className="text-xs shrink-0" style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <p className="alert-danger shrink-0">{error}</p>}

      {/* workspace: saved list | editor | canvas | (chat) */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {/* saved diagrams sidebar */}
        <div className="flex max-h-56 w-full shrink-0 flex-col lg:max-h-none lg:w-52">
          <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <span className="text-xs font-semibold uppercase tracking-wide muted">Saved diagrams</span>
              <span className="text-xs faint">{sideList.length}</span>
            </div>
            <div className="relative border-b p-2" style={{ borderColor: "var(--border)" }}>
              <IconSearch width={12} height={12} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
              <input className="input !h-8 !w-full !py-0 !pl-7 text-xs" placeholder="Search…"
                value={sideSearch} onChange={(e) => setSideSearch(e.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {sideList.filter((d) => d.name.toLowerCase().includes(sideSearch.toLowerCase())).map((d) => (
                <div key={d.id}
                  className="group flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-left transition-colors"
                  style={d.id === diagramId ? { background: "var(--accent-soft)" } : undefined}
                  onClick={() => openDiagram(d.id)}>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm" style={d.id === diagramId ? { color: "var(--accent)", fontWeight: 600 } : { color: "var(--text)" }}>
                      {d.name}
                    </span>
                    <span className="block truncate text-[10px] faint">{new Date(d.updated_at).toLocaleString()}</span>
                  </div>
                  <button className="opacity-0 transition-opacity group-hover:opacity-100" aria-label="Delete diagram"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await api.deleteDiagram(d.id).catch(() => {});
                      if (d.id === diagramId) setDiagramId("");
                      refreshList();
                    }}>
                    <IconTrash width={13} height={13} style={{ color: "var(--text-faint)" }} />
                  </button>
                </div>
              ))}
              {sideList.length === 0 && (
                <p className="px-2 py-4 text-center text-xs muted">Nothing saved yet — hit Save and give it a name.</p>
              )}
            </div>
          </div>
        </div>

        {/* DBML editor */}
        <div className="flex min-h-[16rem] w-full shrink-0 flex-col lg:w-80">
          <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <span className="text-xs font-semibold uppercase tracking-wide muted">DBML</span>
              <span className="text-xs faint">{graph.tables.length} tables · {graph.refs.length} refs</span>
            </div>
            <DbmlCodeEditor value={src} onChange={setSrc} errorLine={parseError?.line ?? null} />
            <div className="border-t px-3 py-1.5 text-xs" style={{ borderColor: "var(--border)", color: parseError ? "var(--danger)" : "var(--text-faint)" }}>
              {parseError ? (
                <span className="inline-flex items-center gap-1.5">
                  <IconWarning width={12} height={12} className="shrink-0" />
                  {parseError.line ? <b>Line {parseError.line}:</b> : null} {parseError.message}
                </span>
              ) : "Valid DBML — canvas is live"}
            </div>
          </div>
        </div>

        {/* canvas (same element in normal & fullscreen mode so React Flow keeps its state) */}
        <div ref={flowRef}
          className={fullscreen
            ? "fixed inset-0 z-50 overflow-hidden"
            : "card relative min-h-[20rem] flex-1 overflow-hidden p-0"}
          style={fullscreen ? { background: "var(--bg)" } : undefined}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.15}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
          >
            <Background gap={18} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={() => "var(--accent-soft)"}
              maskColor="color-mix(in srgb, var(--surface-2) 70%, transparent)"
              style={{ background: "var(--surface)" }} />
          </ReactFlow>
          <button
            className="btn btn-secondary btn-sm absolute right-3 top-3 z-10 !h-8"
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? "Exit full screen (Esc)" : "Full screen canvas"}
          >
            {fullscreen
              ? <><IconMinimize width={13} height={13} /> Exit full screen</>
              : <><IconMaximize width={13} height={13} /> Full screen</>}
          </button>
        </div>

        {/* AI chat */}
        {chatOpen && (
          <div className="flex min-h-[16rem] w-full shrink-0 flex-col lg:w-[20rem]">
            <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
                <IconSparkles width={14} height={14} style={{ color: "var(--accent)" }} />
                <span className="text-xs font-semibold uppercase tracking-wide muted">AI assistant</span>
                <button className="ml-auto rounded-md p-1 transition-colors hover:bg-[var(--surface-2)]"
                  onClick={() => setAiSettingsOpen(true)}
                  title="AI settings (provider & API key — shared with the SQL editor)"
                  aria-label="AI settings">
                  <IconSettings width={14} height={14} style={{ color: "var(--text-muted)" }} />
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {chat.length === 0 && (
                  <div className="space-y-2 text-xs muted">
                    <p>Describe what you want and the diagram updates instantly. Try:</p>
                    {["Design a blog schema with users, posts, comments and tags",
                      "Add an orders table linked to users, with status enum and totals",
                      "Add created_at/updated_at to every table",
                      "Normalize the address fields into their own table"].map((s) => (
                      <button key={s} className="block w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--surface-2)]"
                        style={{ borderColor: "var(--border)" }} onClick={() => setChatInput(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {chat.map((m, i) => (
                  <div key={i} className="max-w-[95%] rounded-lg px-2.5 py-1.5 text-xs"
                    style={m.role === "user"
                      ? { background: "var(--accent-soft)", color: "var(--accent)", marginLeft: "auto" }
                      : { background: "var(--surface-2)", color: "var(--text)" }}>
                    {m.text}
                  </div>
                ))}
                {aiBusy && <p className="text-xs muted">Thinking…</p>}
                {pendingAi && (
                  <div className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: "var(--accent)" }}>
                    <p className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Proposed changes</p>
                    <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-xs">
                      {pendingAi.changes.map((c, i) => (
                        <li key={i} style={{
                          color: c.startsWith("+") ? "var(--success)" : c.startsWith("−") ? "var(--danger)" : "var(--text-muted)",
                        }}>{c}</li>
                      ))}
                    </ul>
                    <div className="flex gap-2">
                      <button className="btn btn-primary btn-sm !h-7" onClick={applyAi}>Apply</button>
                      <button className="btn btn-ghost btn-sm !h-7" onClick={() => setPendingAi(null)}>Discard</button>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="flex items-center gap-2 border-t p-2" style={{ borderColor: "var(--border)" }}>
                <input className="input !h-9 min-w-0 flex-1" placeholder="e.g. add a payments table…"
                  value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
                <button className="btn btn-primary btn-sm !h-9" onClick={send} disabled={aiBusy || !chatInput.trim()}>Send</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {aiSettingsOpen && (
        <AiSettingsModal onClose={() => setAiSettingsOpen(false)}
          onSaved={() => setChat((c) => [...c, { role: "assistant", text: "AI settings saved — ready when you are." }])} />
      )}

      {/* open dialog */}
      {openList && (
        <Modal title="Open diagram" onClose={() => setOpenList(null)}>
          {openList.length === 0 ? (
            <p className="text-sm muted">No saved diagrams yet — hit Save to create one.</p>
          ) : (
            <div className="space-y-2">
            <div className="relative">
              <IconSearch width={13} height={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
              <input autoFocus className="input !h-9 !py-0 !pl-8 text-sm" placeholder="Search diagrams…"
                value={openSearch} onChange={(e) => setOpenSearch(e.target.value)} />
            </div>
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {openList.filter((d) => d.name.toLowerCase().includes(openSearch.toLowerCase())).map((d) => (
                <li key={d.id} className="group flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                  <button className="min-w-0 flex-1 text-left" onClick={() => openDiagram(d.id)}>
                    <span className="block truncate text-sm font-medium">{d.name}</span>
                    <span className="text-xs faint">{new Date(d.updated_at).toLocaleString()}</span>
                  </button>
                  <button className="opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Delete diagram"
                    onClick={async () => {
                      await api.deleteDiagram(d.id).catch(() => {});
                      setOpenList((l) => l?.filter((x) => x.id !== d.id) ?? null);
                    }}>
                    <IconTrash width={14} height={14} style={{ color: "var(--text-faint)" }} />
                  </button>
                </li>
              ))}
            </ul>
            </div>
          )}
        </Modal>
      )}

      {importDb && <ImportFromDbModal onClose={() => setImportDb(false)} onImport={importFromConnection} />}
      {applyDb && <ApplyToDbModal dbml={src} onClose={() => setApplyDb(false)} />}
      {nameDialog && (
        <SaveNameModal
          initial={/^untitled diagram/i.test(name.trim()) ? "" : name}
          saving={saving}
          onClose={() => setNameDialog(false)}
          onSave={(n) => { setName(n); doSave(n); }}
        />
      )}
    </div>
  );
}

/** Generate DDL for a chosen connection's dialect, preview it, then run it
 * through the normal query endpoint. Two modes: Create (full DDL for a fresh
 * schema) and Sync (diff the diagram against the live schema → ALTER script,
 * destructive changes commented out). */
function ApplyToDbModal({ dbml, onClose }: { dbml: string; onClose: () => void }) {
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [connId, setConnId] = useState("");
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");
  const [mode, setMode] = useState<"create" | "sync">("sync");
  const [sql, setSql] = useState("");
  const [building, setBuilding] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { api.listConnections().then(setConnections).catch((e) => setError(String(e))); }, []);
  const conn = connections.find((c) => c.id === connId);

  useEffect(() => {
    setSchemas([]); setSchema(""); setSql(""); setResult("");
    if (!connId) return;
    api.listSchemas(connId).then((s) => { setSchemas(s); if (s.length === 1) setSchema(s[0]); }).catch((e) => setError(String(e)));
  }, [connId]);

  useEffect(() => {
    setError(""); setSql(""); setResult("");
    if (!conn) return;
    const dialect: "mysql" | "postgres" = conn.flavor === "mysql" || conn.flavor === "sqlfile" || conn.flavor === "sqlite" ? "mysql" : "postgres";
    let cancel = false;
    const build = async () => {
      setBuilding(true);
      try {
        if (mode === "create") {
          setSql(await exportSql(dbml, dialect));
        } else {
          if (!schema) return;
          const { graph: g, error: pe } = await parseDbml(dbml);
          if (!g) throw new Error(pe?.message ?? "diagram does not parse");
          const tables = await api.listTables(connId, schema);
          const live: Record<string, { name: string; data_type: string; nullable: boolean }[]> = {};
          await Promise.all(
            tables.map(async (t) => {
              try { live[t.name] = await api.listColumns(connId, schema, t.name); } catch { /* skip unreadable */ }
            }),
          );
          if (!cancel) setSql(buildSyncScript(g, live, dialect));
        }
      } catch (e) {
        if (!cancel) setError(`Could not generate SQL: ${String((e as { diags?: { message: string }[] })?.diags?.[0]?.message ?? e)}`);
      } finally {
        if (!cancel) setBuilding(false);
      }
    };
    build();
    return () => { cancel = true; };
  }, [conn, dbml, mode, schema, connId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isProd = conn?.environment === "prod";
  const canRun = !!conn && !!schema && !!sql && !running && (!isProd || confirmText === "CONFIRM");

  const run = async () => {
    setRunning(true); setError(""); setResult("");
    try {
      const r = await api.runSql(connId, sql, schema, 0);
      if (!r.ok) setError(r.error || "DDL failed");
      else setResult(`Done — ${r.executed} statement(s) executed in ${r.elapsed_ms} ms. Open the Explorer to see the new tables.`);
    } catch (e) { setError(String(e)); } finally { setRunning(false); }
  };

  return (
    <Modal title="Apply diagram to database" wide onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Connection</label>
            <Select className="w-full" value={connId} onValueChange={setConnId} placeholder="Select a connection…"
              options={connections.map((c) => ({ value: c.id, label: `${c.name} (${c.flavor})` }))} />
          </div>
          {schemas.length > 0 && (
            <div>
              <label className="label">Schema</label>
              <Select className="w-full" value={schema} onValueChange={setSchema} placeholder="Select schema…"
                options={schemas.map((s) => ({ value: s, label: s }))} />
            </div>
          )}
        </div>

        {conn && (
          <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--surface-2)" }}>
            {([
              { id: "sync", label: "Sync (diff → ALTER script)", hint: "compare with the live schema" },
              { id: "create", label: "Create (full DDL)", hint: "for an empty schema" },
            ] as const).map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)}
                className="flex-1 rounded-md py-1.5 text-sm font-medium transition-colors"
                style={mode === m.id ? { background: "var(--surface)", color: "var(--text)", boxShadow: "var(--shadow-sm)" } : { color: "var(--text-muted)" }}
                title={m.hint}>
                {m.label}
              </button>
            ))}
          </div>
        )}

        {conn?.read_only && (
          <p className="alert-danger">This connection is read-only — pick another or disable read-only mode.</p>
        )}

        {building && <p className="text-sm muted">Comparing with the live schema…</p>}
        {sql && !building && (
          <>
            <label className="label">
              {mode === "sync" ? "Migration script" : "Generated DDL"} ({conn?.flavor === "mysql" || conn?.flavor === "sqlite" ? "MySQL" : "PostgreSQL"}) — review before running
            </label>
            <pre className="max-h-64 overflow-auto rounded-lg p-3 font-mono text-xs" style={{ background: "var(--surface-2)" }}>{sql}</pre>
            {mode === "sync" && (
              <p className="text-xs faint">
                Destructive changes (DROP table/column, type changes) are commented out — edit the diagram or copy the script to the SQL editor if you need them.
              </p>
            )}
          </>
        )}

        {isProd && (
          <div className="space-y-1.5 rounded-lg px-3 py-2" style={{ background: "var(--danger-soft)" }}>
            <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--danger)" }}>
              <IconWarning width={14} height={14} /> PRODUCTION connection — type CONFIRM to enable Run.
            </p>
            <input className="input !h-8 !w-40" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="CONFIRM" />
          </div>
        )}

        {error && <p className="alert-danger whitespace-pre-wrap">{error}</p>}
        {result && <p className="text-sm" style={{ color: "var(--success)" }}>{result}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          <button className="btn btn-primary" onClick={run} disabled={!canRun || !!conn?.read_only}>
            <IconBolt width={14} height={14} /> {running ? "Running…" : "Run DDL"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** First-save prompt: forces a real name so diagrams are findable later. */
function SaveNameModal({ initial, saving, onClose, onSave }: {
  initial: string; saving: boolean; onClose: () => void; onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const ok = value.trim().length > 0;
  return (
    <Modal title="Save diagram" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Diagram name</label>
          <input autoFocus className="input" value={value} placeholder="e.g. HRIS, CRM, Inventory…"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && ok) onSave(value.trim()); }} />
          <p className="mt-1.5 text-xs faint">You'll find it again under Open — searchable by this name.</p>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(value.trim())} disabled={!ok || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Pick a saved connection + schema, then pull its schema into the diagram. */
function ImportFromDbModal({ onClose, onImport }: {
  onClose: () => void;
  onImport: (conn: ConnectionProfile, schema: string) => void;
}) {
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [connId, setConnId] = useState("");
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { api.listConnections().then(setConnections).catch((e) => setError(String(e))); }, []);
  useEffect(() => {
    setSchemas([]); setSchema("");
    if (!connId) return;
    api.listSchemas(connId).then((s) => { setSchemas(s); if (s.length === 1) setSchema(s[0]); }).catch((e) => setError(String(e)));
  }, [connId]);

  const conn = connections.find((c) => c.id === connId);
  return (
    <Modal title="Import from live connection" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Connection</label>
          <Select className="w-full" value={connId} onValueChange={setConnId} placeholder="Select a connection…"
            options={connections.map((c) => ({ value: c.id, label: `${c.name} (${c.flavor})` }))} />
        </div>
        {schemas.length > 0 && (
          <div>
            <label className="label">Schema</label>
            <Select className="w-full" value={schema} onValueChange={setSchema} placeholder="Select schema…"
              options={schemas.map((s) => ({ value: s, label: s }))} />
          </div>
        )}
        {error && <p className="alert-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!conn || !schema} onClick={() => conn && onImport(conn, schema)}>
            Import schema
          </button>
        </div>
      </div>
    </Modal>
  );
}
