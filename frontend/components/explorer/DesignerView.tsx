"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  getRectOfNodes,
  getTransformForBounds,
} from "reactflow";
import "reactflow/dist/style.css";
import { toPng, toJpeg } from "html-to-image";
import { api } from "@/lib/api";
import type { SchemaGraph, SchemaGraphTable } from "@/lib/types";
import { IconDownload, IconRefresh } from "@/components/icons";
import { toast } from "@/lib/toast";

const NODE_W = 230;
const HEADER_H = 34;
const ROW_H = 22;

// ---- custom table node -----------------------------------------------------
function TableNode({ data }: NodeProps<{ table: SchemaGraphTable }>) {
  const t = data.table;
  return (
    <div
      className="overflow-hidden rounded-lg border text-xs"
      style={{ width: NODE_W, background: "var(--surface)", borderColor: "var(--border-strong)", boxShadow: "var(--shadow)" }}
    >
      <div
        className="px-3 py-2 font-semibold"
        style={{ background: "var(--accent-soft)", color: "var(--accent)", height: HEADER_H }}
      >
        {t.name}
      </div>
      <div>
        {t.columns.map((c) => (
          <div
            key={c.name}
            className="relative flex items-center gap-1.5 border-t px-3 font-mono"
            style={{ height: ROW_H, borderColor: "var(--border)" }}
          >
            {/* per-column connection points so FK edges anchor at the right row */}
            <Handle type="target" position={Position.Left} id={`t-${c.name}`}
              style={{ opacity: 0, left: 0 }} isConnectable={false} />
            <Handle type="source" position={Position.Right} id={`s-${c.name}`}
              style={{ opacity: 0, right: 0 }} isConnectable={false} />
            {(c.pk || c.fk) && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                title={c.pk ? "Primary key" : `FK → ${c.fk}`}
                style={{ background: c.pk ? "var(--warning)" : "var(--accent)" }}
              />
            )}
            <span className="truncate" style={{ color: "var(--text)" }}>{c.name}</span>
            <span className="ml-auto truncate pl-2" style={{ color: "var(--text-faint)" }}>
              {c.type.length > 14 ? c.type.slice(0, 14) : c.type}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { table: TableNode };

function buildFlow(graph: SchemaGraph): { nodes: Node[]; edges: Edge[] } {
  const perRow = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(graph.tables.length))));
  const GAP_X = 90, GAP_Y = 70, PAD = 20;
  let x = PAD, y = PAD, col = 0, rowMaxH = 0;
  const nodes: Node[] = graph.tables.map((t) => {
    const h = HEADER_H + t.columns.length * ROW_H;
    const node: Node = { id: t.name, type: "table", position: { x, y }, data: { table: t } };
    rowMaxH = Math.max(rowMaxH, h);
    col++;
    if (col >= perRow) { col = 0; x = PAD; y += rowMaxH + GAP_Y; rowMaxH = 0; }
    else x += NODE_W + GAP_X;
    return node;
  });
  // Distinct color per relationship (cycled palette) so edges stay tellable
  // apart when several FKs cross each other.
  const EDGE_COLORS = [
    "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
    "#8b5cf6", "#14b8a6", "#f97316", "#ec4899", "#84cc16",
  ];
  const edges: Edge[] = graph.relationships.map((r, i) => {
    const color = EDGE_COLORS[i % EDGE_COLORS.length];
    return {
      id: `e${i}`,
      source: r.from_table,
      sourceHandle: `s-${r.from_column}`,
      target: r.to_table,
      targetHandle: `t-${r.to_column}`,
      type: "smoothstep",
      animated: true,
      label: `${r.from_column} → ${r.to_column}`,
      labelStyle: { fontSize: 10, fill: color },
      labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.85 },
      style: { stroke: color, strokeWidth: 1.6, opacity: 0.85 },
    };
  });
  return { nodes, edges };
}

export default function DesignerView({ connId, schema }: { connId: string; schema: string }) {
  const [graph, setGraph] = useState<SchemaGraph | null>(null);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const flowRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    setError(""); setGraph(null);
    api.schemaGraph(connId, schema)
      .then((g) => {
        setGraph(g);
        const { nodes: n, edges: e } = buildFlow(g);
        setNodes(n); setEdges(e);
      })
      .catch((e) => setError(String(e)));
  }, [connId, schema, setNodes, setEdges]);
  useEffect(reload, [reload]);

  const exportImage = async (type: "png" | "jpeg") => {
    const el = flowRef.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!el) return;
    const rect = getRectOfNodes(nodes);
    const W = Math.min(4096, Math.max(800, Math.ceil(rect.width + 80)));
    const H = Math.min(4096, Math.max(600, Math.ceil(rect.height + 80)));
    const [tx, ty, zoom] = getTransformForBounds(rect, W, H, 0.2, 2);
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
    const opts = {
      width: W, height: H, backgroundColor: bg,
      style: { width: `${W}px`, height: `${H}px`, transform: `translate(${tx}px, ${ty}px) scale(${zoom})` },
    };
    try {
      const url = type === "png" ? await toPng(el, opts) : await toJpeg(el, { ...opts, quality: 0.95 });
      const a = document.createElement("a");
      a.href = url;
      a.download = `erd-${schema || "schema"}.${type === "jpeg" ? "jpg" : "png"}`;
      a.click();
      toast(`Downloaded ${a.download}`);
    } catch {
      setError("Could not export the diagram image.");
    }
  };

  const flow = useMemo(
    () => (
      <div
        ref={flowRef}
        className="card overflow-hidden p-0"
        style={{ height: fullscreen ? "calc(100vh - 7rem)" : "calc(100vh - 20rem)", minHeight: 320 }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.15}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
        >
          <Background gap={18} size={1} color="var(--border)" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={() => "var(--accent-soft)"}
            maskColor="color-mix(in srgb, var(--surface-2) 70%, transparent)"
            style={{ background: "var(--surface)" }}
          />
        </ReactFlow>
      </div>
    ),
    [nodes, edges, onNodesChange, onEdgesChange, fullscreen],
  );

  if (error) return <p className="alert-danger">{error}</p>;
  if (!graph) return <p className="muted">Loading schema…</p>;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold">Schema diagram (ERD)</span>
      <span className="text-xs faint">
        {graph.tables.length} tables · {graph.relationships.length} FKs · drag tables, scroll to zoom
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button className="btn btn-secondary btn-sm !h-8" onClick={reload}>
          <IconRefresh width={13} height={13} /> Reset layout
        </button>
        <button className="btn btn-secondary btn-sm !h-8" onClick={() => setFullscreen((f) => !f)}>
          {fullscreen ? "Exit full screen" : "Full screen"}
        </button>
        <div className="flex h-8 items-center gap-1 rounded-lg border px-1.5" style={{ borderColor: "var(--border-strong)" }}>
          <IconDownload width={13} height={13} style={{ color: "var(--text-muted)" }} />
          <button className="btn btn-ghost btn-sm !h-7 !px-1.5" onClick={() => exportImage("png")}>PNG</button>
          <button className="btn btn-ghost btn-sm !h-7 !px-1.5" onClick={() => exportImage("jpeg")}>JPG</button>
        </div>
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col gap-3 p-4" style={{ background: "var(--bg)" }}>
        {toolbar}
        {flow}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toolbar}
      {flow}
    </div>
  );
}
