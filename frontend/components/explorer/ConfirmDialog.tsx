"use client";
import { useState } from "react";
import Modal from "./Modal";

export interface ConfirmState {
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

export default function ConfirmDialog({ state, onClose }: { state: ConfirmState | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!state) return null;

  const go = async () => {
    setBusy(true); setError("");
    try { await state.onConfirm(); onClose(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={state.title ?? "Please confirm"} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm" style={{ color: "var(--text)" }}>{state.message}</p>
        {error && <p className="alert-danger whitespace-pre-wrap">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={state.danger ? "btn btn-danger" : "btn btn-primary"} onClick={go} disabled={busy}>
            {busy ? "Working…" : state.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
