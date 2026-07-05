"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SchemaGraph } from "@/lib/types";
import { IconDownload, IconRefresh } from "@/components/icons";

const BOX_W = 220;
const HEADER_H = 30;
const ROW_H = 20;
const GAP_X = 80;
const GAP_Y = 54;
const PAD = 30;

type Pos = { x: number; y: number; w: number; h: number };

function autoLayout(graph: SchemaGraph): Record<string, Pos> {
  const n = graph.tables.length;
  const perRow = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
  const pos: Record<string, Pos> = {};
  let x = PAD, y = PAD, col = 0, rowMaxH = 0;
  for (const t of graph.tables) {
    const h = HEADER_H + t.columns.length * ROW_H + 8;
    pos[t.name] = { x, y, w: BOX_W, h };
    rowMaxH = Math.max(rowMaxH, h);
    col++;
    if (col >= perRow) { col = 0; x = PAD; y += rowMaxH + GAP_Y; rowMaxH = 0; }
    else x += BOX_W + GAP_X;
  }
  return pos;
}

export default function DesignerView({ connId, schema }: { connId: string; schema: string }) {
  const [graph, setGraph] = useState<SchemaGraph | null>(null);
  const [error, setError] = useState("");
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const [scale, setScale] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [ddlTable, setDdlTable] = useState("");
  const [ddl, setDdl] = useState("");

  const svgRef = useRef<SVGSVGElement>(null);
  const scaleRef = useRef(1);
  scaleRef.current = scale;
  const dragRef = useRef<{ name: string; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const movedRef = useRef(false);

  const reload = () => {
    setError(""); setGraph(null);
    api.schemaGraph(connId, schema).then((g) => { setGraph(g); setPositions(autoLayout(g)); }).catch((e) => setError(String(e)));
  };
  useEffect(reload, [connId, schema]); // eslint-disable-line react-hooks/exhaustive-deps

  // stable global drag listeners
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      movedRef.current = true;
      const dx = (e.clientX - d.sx) / scaleRef.current;
      const dy = (e.clientY - d.sy) / scaleRef.current;
      setPositions((p) => (p[d.name] ? { ...p, [d.name]: { ...p[d.name], x: Math.max(8, d.ox + dx), y: Math.max(8, d.oy + dy) } } : p));
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  const bounds = useMemo(() => {
    let w = 400, h = 300;
    for (const p of Object.values(positions)) { w = Math.max(w, p.x + p.w + PAD); h = Math.max(h, p.y + p.h + PAD); }
    return { w, h };
  }, [positions]);

  const showDdl = async (t: string) => {
    setDdlTable(t); setDdl("Loading…");
    try { setDdl((await api.tableDdl(connId, schema, t)).ddl); } catch (e) { setDdl(String(e)); }
  };

  const onBoxDown = (e: React.MouseEvent, name: string) => {
    const p = positions[name]; if (!p) return;
    movedRef.current = false;
    dragRef.current = { name, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y };
  };

  const exportImage = (type: "png" | "jpeg") => {
    const svg = svgRef.current; if (!svg) return;
    const cs = getComputedStyle(document.documentElement);
    const K = 2; // 2x for crispness
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(bounds.w * K));
    clone.setAttribute("height", String(bounds.h * K));
    clone.setAttribute("viewBox", `0 0 ${bounds.w} ${bounds.h}`);
    let s = new XMLSerializer().serializeToString(clone);
    const vars = ["--surface", "--surface-2", "--border-strong", "--border", "--accent", "--accent-soft", "--accent-fg", "--text", "--text-faint", "--warning"];
    for (const v of vars) s = s.split(`var(${v})`).join((cs.getPropertyValue(v) || "#888").trim() || "#888");
    if (!/xmlns=/.test(s)) s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    const url = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = bounds.w * K; canvas.height = bounds.h * K;
      const ctx = canvas.getContext("2d")!;
      const bg = (cs.getPropertyValue("--surface") || "#ffffff").trim() || "#ffffff";
      ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => {
        if (!b) return;
        const u = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = u; a.download = `erd-${schema || "schema"}.${type === "jpeg" ? "jpg" : "png"}`; a.click();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
      }, type === "jpeg" ? "image/jpeg" : "image/png", 0.95);
    };
    img.onerror = () => { URL.revokeObjectURL(url); setError("Could not rasterize the diagram."); };
    img.src = url;
  };

  const center = (name: string) => { const p = positions[name]; return p ? { x: p.x + p.w / 2, y: p.y + p.h / 2 } : null; };
  const zoom = (dir: 1 | -1) => setScale((s) => Math.min(2.5, Math.max(0.3, +(s + dir * 0.15).toFixed(2))));

  if (error) return <p className="alert-danger">{error}</p>;
  if (!graph) return <p className="muted">Loading schema…</p>;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold">Schema diagram (ERD)</span>
      <span className="text-xs faint">{graph.tables.length} tables · {graph.relationships.length} FKs · drag to arrange</span>
      <div className="ml-auto flex items-center gap-1">
        <button className="btn btn-secondary btn-sm !h-8" onClick={() => zoom(-1)} aria-label="Zoom out">−</button>
        <span className="w-12 text-center text-xs muted">{Math.round(scale * 100)}%</span>
        <button className="btn btn-secondary btn-sm !h-8" onClick={() => zoom(1)} aria-label="Zoom in">+</button>
        <button className="btn btn-secondary btn-sm !h-8" onClick={() => { setScale(1); if (graph) setPositions(autoLayout(graph)); }}><IconRefresh width={13} height={13} /> Reset</button>
        <button className="btn btn-secondary btn-sm !h-8" onClick={() => setFullscreen((f) => !f)}>{fullscreen ? "Exit full screen" : "Full screen"}</button>
        <div className="flex h-8 items-center gap-1 rounded-lg border px-1.5" style={{ borderColor: "var(--border-strong)" }}>
          <IconDownload width={13} height={13} style={{ color: "var(--text-muted)" }} />
          <button className="btn btn-ghost btn-sm !h-7 !px-1.5" onClick={() => exportImage("png")}>PNG</button>
          <button className="btn btn-ghost btn-sm !h-7 !px-1.5" onClick={() => exportImage("jpeg")}>JPG</button>
        </div>
      </div>
    </div>
  );

  const diagram = (
    <div className="card overflow-auto p-0" style={{ height: fullscreen ? "calc(100vh - 7rem)" : "calc(100vh - 20rem)", minHeight: 300 }}>
      <svg ref={svgRef} width={bounds.w * scale} height={bounds.h * scale} viewBox={`0 0 ${bounds.w} ${bounds.h}`}
        style={{ display: "block", background: "var(--surface)" }}>
        <defs>
          <marker id="erdarrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L7,3 L0,6 Z" fill="var(--accent)" />
          </marker>
        </defs>
        {graph.relationships.map((rel, i) => {
          const a = center(rel.from_table), b = center(rel.to_table);
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeWidth={1.5} strokeOpacity={0.5} markerEnd="url(#erdarrow)" />;
        })}
        {graph.tables.map((t) => {
          const p = positions[t.name]; if (!p) return null;
          return (
            <g key={t.name} transform={`translate(${p.x},${p.y})`} style={{ cursor: "grab" }}
              onMouseDown={(e) => onBoxDown(e, t.name)}
              onClick={() => { if (!movedRef.current) showDdl(t.name); }}>
              <rect width={p.w} height={p.h} rx={8} fill="var(--surface)" stroke={ddlTable === t.name ? "var(--accent)" : "var(--border-strong)"} strokeWidth={ddlTable === t.name ? 2 : 1} />
              <rect width={p.w} height={HEADER_H} rx={8} fill="var(--accent-soft)" />
              <rect y={HEADER_H - 8} width={p.w} height={8} fill="var(--accent-soft)" />
              <text x={12} y={20} fontSize={13} fontWeight={600} fill="var(--accent)">{t.name}</text>
              {t.columns.map((c, ci) => {
                const ty = HEADER_H + 15 + ci * ROW_H;
                return (
                  <g key={c.name}>
                    {(c.pk || c.fk) && <circle cx={14} cy={ty - 4} r={3.5} fill={c.pk ? "var(--warning)" : "var(--accent)"} />}
                    <text x={c.pk || c.fk ? 24 : 12} y={ty} fontSize={11} fontFamily="monospace" fill="var(--text)">
                      {c.name}<tspan fill="var(--text-faint)"> {c.type.length > 12 ? c.type.slice(0, 12) : c.type}</tspan>
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col gap-3 p-4" style={{ background: "var(--bg)" }}>
        {toolbar}
        {diagram}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toolbar}
      {diagram}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Table DDL</h3>
          <select className="select !h-8 !w-auto !py-0" value={ddlTable} onChange={(e) => e.target.value && showDdl(e.target.value)}>
            <option value="">— pick a table —</option>
            {graph.tables.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
          <span className="text-xs faint">(or click a table in the diagram)</span>
        </div>
        {ddl && <pre className="card overflow-x-auto p-4 font-mono text-xs" style={{ color: "var(--text)" }}>{ddl}</pre>}
      </div>
    </div>
  );
}
