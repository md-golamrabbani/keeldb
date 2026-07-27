"use client";
import { useState } from "react";
import Modal from "@/components/explorer/Modal";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

// Change the app-unlock password from inside the app (you must know the current
// one). Opened from the lock button in the top nav. The security question is
// left unchanged — use "Forgot password?" on the lock screen for that flow.
export default function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!current) return setError("Enter your current password.");
    if (next.length < 4) return setError("New password: use at least 4 characters.");
    if (next !== confirm) return setError("New passwords don't match.");
    setBusy(true); setError("");
    try {
      await api.authChange(current, next);
      toast("Password changed.");
      onClose();
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Change password" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label">Current password</label>
          <input autoFocus type="password" className="input" value={current}
            onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label className="label">New password</label>
          <input type="password" className="input" value={next}
            onChange={(e) => setNext(e.target.value)} />
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input type="password" className="input" value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        </div>
        {error && <p className="alert-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !current || !next}>
            {busy ? "Saving…" : "Change password"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
