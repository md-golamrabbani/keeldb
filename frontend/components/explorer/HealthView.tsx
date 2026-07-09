"use client";
import { useCallback, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { BloatReport, HealthReport, IndexAdvice, ServerMetrics } from "@/lib/types";
import ActivityPanel from "./ActivityPanel";
import AlertsPanel from "./AlertsPanel";
import {
  IconActivity,
  IconBell,
  IconBolt,
  IconColumns,
  IconGauge,
  IconHardDrive,
  IconLayers,
  IconLink,
  IconLock,
  IconRefresh,
  IconRows,
  IconTable,
  IconWarning,
} from "@/components/icons";

type IconType = LucideIcon;

function fmtBytes(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

const TABS: { id: string; label: string; Icon: IconType }[] = [
  { id: "overview", label: "Overview", Icon: IconGauge },
  { id: "tables", label: "Tables", Icon: IconTable },
  { id: "indexes", label: "Indexes", Icon: IconColumns },
  { id: "bloat", label: "Bloat", Icon: IconHardDrive },
  { id: "sessions", label: "Sessions", Icon: IconActivity },
  { id: "alerts", label: "Alerts", Icon: IconBell },
];

// Icon + tone for a server-metric tile, keyed by metric name (falls back to accent).
function metricStyle(key: string): { Icon: IconType; tone: string } {
  const map: Record<string, { Icon: IconType; tone: string }> = {
    connections: { Icon: IconLink, tone: "var(--accent)" },
    active: { Icon: IconBolt, tone: "var(--warning)" },
    running: { Icon: IconBolt, tone: "var(--warning)" },
    idle: { Icon: IconLayers, tone: "var(--text-muted)" },
    cache_hit: { Icon: IconGauge, tone: "var(--success)" },
    deadlocks: { Icon: IconLock, tone: "var(--danger)" },
    db_size: { Icon: IconHardDrive, tone: "var(--warning)" },
    uptime: { Icon: IconRefresh, tone: "var(--text-muted)" },
    slow_queries: { Icon: IconWarning, tone: "var(--danger)" },
  };
  return map[key] ?? { Icon: IconBolt, tone: "var(--accent)" };
}

export default function HealthView({
  connId,
  schema,
}: {
  connId: string;
  schema: string;
}) {
  const [tab, setTab] = useState("overview");
  const [rep, setRep] = useState<HealthReport | null>(null);
  const [advice, setAdvice] = useState<IndexAdvice | null>(null);
  const [server, setServer] = useState<ServerMetrics | null>(null);
  const [bloatRep, setBloatRep] = useState<BloatReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .health(connId, schema)
      .then(setRep)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    api
      .indexAdvice(connId, schema)
      .then(setAdvice)
      .catch(() => setAdvice(null));
    api
      .serverMetrics(connId)
      .then(setServer)
      .catch(() => setServer(null));
    api
      .bloatReport(connId, schema)
      .then(setBloatRep)
      .catch(() => setBloatRep(null));
  }, [connId, schema]);
  useEffect(load, [load]);

  const fmtMetric = (v: number | null, unit: string) =>
    v === null
      ? "—"
      : unit === "bytes"
        ? fmtBytes(v)
        : `${v.toLocaleString()}${unit === "%" ? "%" : unit === "s" ? "s" : ""}`;

  const bySize = !!rep && rep.tables.some((t) => t.size_bytes !== null);
  const maxMetric = rep
    ? Math.max(
        1,
        ...rep.tables.map((t) => (bySize ? (t.size_bytes ?? 0) : t.rows)),
      )
    : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-title">Database health</h3>
        {tab !== "sessions" && tab !== "alerts" && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={load}
            disabled={loading}
          >
            <IconRefresh width={13} height={13} />{" "}
            {loading ? "Loading…" : "Refresh"}
          </button>
        )}
      </div>

      {/* tab bar */}
      <div
        className="flex items-center gap-1 overflow-x-auto border-b"
        style={{ borderColor: "var(--border)" }}
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors"
            style={
              tab === id
                ? { borderColor: "var(--accent)", color: "var(--accent)" }
                : { borderColor: "transparent", color: "var(--text-muted)" }
            }
          >
            <Icon width={15} height={15} /> {label}
          </button>
        ))}
      </div>

      {error && <p className="alert-danger">{error}</p>}

      {tab === "overview" && (
        <div className="space-y-4">
          {rep && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <StatCard
                Icon={IconTable}
                tone="var(--accent)"
                label="Tables"
                value={rep.overview.table_count.toLocaleString()}
              />
              <StatCard
                Icon={IconRows}
                tone="var(--success)"
                label="Total rows"
                value={rep.overview.total_rows.toLocaleString()}
              />
              <StatCard
                Icon={IconHardDrive}
                tone="var(--warning)"
                label="Total size"
                value={fmtBytes(rep.overview.total_size_bytes)}
              />
            </div>
          )}
          {server && server.supported && server.metrics.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold muted">Server metrics</h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {server.metrics.map((m) => {
                  const st = metricStyle(m.key);
                  return (
                    <StatCard
                      key={m.key}
                      Icon={st.Icon}
                      tone={st.tone}
                      label={m.label}
                      value={fmtMetric(m.value, m.unit)}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs faint">
              Live server metrics (connections, cache-hit, deadlocks…) are
              available on PostgreSQL and MySQL.
            </p>
          )}
        </div>
      )}

      {tab === "tables" && rep && (
        <div className="space-y-2">
          {!bySize && rep.dialect === "sqlite" && (
            <p className="text-xs muted">
              SQLite reports no per-table byte size — showing live row counts.
            </p>
          )}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  style={{ background: "var(--surface-2)" }}
                  className="text-left text-xs uppercase tracking-wide muted"
                >
                  <th className="px-3 py-2">Table</th>
                  <th className="w-1/2 px-3 py-2">
                    {bySize ? "Size" : "Rows"}
                  </th>
                  <th className="px-3 py-2 text-right">Rows</th>
                  {bySize && <th className="px-3 py-2 text-right">Size</th>}
                  {bySize && <th className="px-3 py-2 text-right">Indexes</th>}
                </tr>
              </thead>
              <tbody>
                {rep.tables.map((t) => {
                  const metric = bySize ? (t.size_bytes ?? 0) : t.rows;
                  return (
                    <tr key={t.name} className="border-t">
                      <td className="px-3 py-1.5 font-mono font-medium">
                        {t.name}
                      </td>
                      <td className="px-3 py-1.5">
                        <div
                          className="h-2 overflow-hidden rounded-full"
                          style={{ background: "var(--surface-2)" }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(metric / maxMetric) * 100}%`,
                              background: "var(--accent)",
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {t.rows.toLocaleString()}
                      </td>
                      {bySize && (
                        <td className="px-3 py-1.5 text-right font-mono">
                          {fmtBytes(t.size_bytes)}
                        </td>
                      )}
                      {bySize && (
                        <td className="px-3 py-1.5 text-right font-mono faint">
                          {fmtBytes(t.index_bytes)}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {rep.tables.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center muted">
                      No tables.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "indexes" && advice && (
        <div className="space-y-2">
          {advice.findings.length === 0 ? (
            <div
              className="rounded-lg px-3 py-2 text-sm font-semibold"
              style={{
                background: "var(--success-soft)",
                color: "var(--success)",
              }}
            >
              ✅ No index or primary-key issues found.
            </div>
          ) : (
            <div
              className="card divide-y"
              style={{ borderColor: "var(--border)" }}
            >
              {advice.findings.map((f, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 px-3 py-2 text-sm"
                >
                  <IconWarning
                    width={15}
                    height={15}
                    style={{
                      color:
                        f.level === "warn"
                          ? "var(--warning)"
                          : "var(--text-faint)",
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  />
                  <span className="badge">{f.kind.replace(/_/g, " ")}</span>
                  <span className="font-mono text-xs muted">{f.table}</span>
                  <span className="flex-1">{f.message}</span>
                </div>
              ))}
            </div>
          )}
          {!advice.usage_available && (
            <p className="text-xs faint">
              Unused-index detection needs query statistics — available on
              PostgreSQL and MySQL.
            </p>
          )}
        </div>
      )}

      {tab === "bloat" && (
        <div className="space-y-3">
          {!bloatRep || !bloatRep.supported ? (
            <p className="text-xs faint">
              {bloatRep?.message ??
                "Bloat analysis (dead tuples / reclaimable space) is available for PostgreSQL and MySQL connections."}
            </p>
          ) : (
            <>
              {bloatRep.advice.length === 0 ? (
                <div
                  className="rounded-lg px-3 py-2 text-sm font-semibold"
                  style={{ background: "var(--success-soft)", color: "var(--success)" }}
                >
                  ✅ No table needs a vacuum / optimize right now.
                </div>
              ) : (
                <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
                  {bloatRep.advice.map((a, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <IconWarning
                        width={15}
                        height={15}
                        style={{
                          color: a.severity === "high" ? "var(--danger)" : "var(--warning)",
                          flexShrink: 0,
                        }}
                      />
                      <span className="font-mono text-xs muted">{a.table}</span>
                      <span className="flex-1">{a.message}</span>
                      <code
                        className="rounded px-2 py-0.5 text-xs"
                        style={{ background: "var(--surface-2)" }}
                      >
                        {a.action}
                      </code>
                    </div>
                  ))}
                </div>
              )}
              {bloatRep.tables.length > 0 && (
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr
                        style={{ background: "var(--surface-2)" }}
                        className="text-left text-xs uppercase tracking-wide muted"
                      >
                        <th className="px-3 py-2">Table</th>
                        {bloatRep.dialect === "postgresql" ? (
                          <>
                            <th className="px-3 py-2 text-right">Live rows</th>
                            <th className="px-3 py-2 text-right">Dead rows</th>
                            <th className="px-3 py-2 text-right">Dead %</th>
                            <th className="px-3 py-2">Last vacuum</th>
                          </>
                        ) : (
                          <>
                            <th className="px-3 py-2 text-right">Rows (est.)</th>
                            <th className="px-3 py-2 text-right">Size</th>
                            <th className="px-3 py-2 text-right">Reclaimable</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {bloatRep.tables.map((t) => (
                        <tr key={t.table} className="border-t">
                          <td className="px-3 py-1.5 font-mono font-medium">{t.table}</td>
                          {bloatRep.dialect === "postgresql" ? (
                            <>
                              <td className="px-3 py-1.5 text-right font-mono">{(t.live_rows ?? 0).toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{(t.dead_rows ?? 0).toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{((t.dead_ratio ?? 0) * 100).toFixed(1)}%</td>
                              <td className="px-3 py-1.5 text-xs muted">{t.last_vacuum ?? "never"}</td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-1.5 text-right font-mono">{(t.rows_est ?? 0).toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{fmtBytes(t.size_bytes ?? 0)}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{fmtBytes(t.reclaimable_bytes ?? 0)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "sessions" && <ActivityPanel connId={connId} />}
      {tab === "alerts" && <AlertsPanel connId={connId} schema={schema} />}
    </div>
  );
}

function StatCard({
  Icon,
  tone,
  label,
  value,
}: {
  Icon: IconType;
  tone: string;
  label: string;
  value: string;
}) {
  return (
    <div className="card card-hover flex items-center gap-3 p-4">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: `color-mix(in srgb, ${tone} 14%, transparent)`,
          color: tone,
        }}
      >
        <Icon width={18} height={18} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xl font-semibold">{value}</div>
        <div className="truncate text-xs muted">{label}</div>
      </div>
    </div>
  );
}
