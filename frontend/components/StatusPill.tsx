"use client";
import type { TestResult } from "@/lib/types";

export type PillState =
  | { status: "idle" }
  | { status: "testing" }
  | ({ status: "done" } & TestResult);

export default function StatusPill({ state }: { state: PillState }) {
  if (state.status === "idle") return null;
  if (state.status === "testing") {
    return (
      <span className="badge">
        <span className="mr-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--warning)" }} />
        testing…
      </span>
    );
  }
  return state.ok ? (
    <span className="badge badge-success" title={state.server_version}>
      <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--success)" }} />
      connected · {state.latency_ms} ms
    </span>
  ) : (
    <span className="badge badge-danger max-w-[16rem] truncate" title={state.error}>
      <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--danger)" }} />
      failed
    </span>
  );
}
