"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AiSettingsPublic } from "@/lib/types";
import Modal from "./Modal";
import ErrorBanner from "./ErrorBanner";
import Select from "@/components/ui/Select";

// Configure which LLM powers Ask-AI (Claude / ChatGPT / Groq) + API key.
export default function AiSettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<AiSettingsPublic | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [show, setShow] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Reveal the stored key: fetch it once (if the field is empty) and unmask it.
  const toggleShow = async () => {
    if (show) { setShow(false); return; }
    if (!apiKey && s?.has_key) {
      setRevealing(true);
      try { setApiKey((await api.revealAiKey()).api_key); }
      catch (e) { setError(String(e)); return; }
      finally { setRevealing(false); }
    }
    setShow(true);
  };

  useEffect(() => {
    api.aiSettings().then((r) => { setS(r); setProvider(r.provider); setModel(r.model); }).catch((e) => setError(String(e)));
  }, []);

  const defaultModel = s?.providers.find((p) => p.value === provider)?.default_model ?? "";

  const save = async () => {
    setBusy(true); setError("");
    try {
      await api.saveAiSettings({ provider, model, api_key: apiKey });
      onSaved(); onClose();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title="AI settings" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm muted">Ask-AI turns plain English into SQL. Choose a provider and paste an API key — the key is stored encrypted and never leaves your backend except to call that provider.</p>
        <ErrorBanner message={error} onClose={() => setError("")} />

        <div>
          <label className="label">Provider</label>
          <Select
            className="w-full"
            value={provider}
            onValueChange={(v) => { setProvider(v); setModel(""); }}
            options={(s?.providers ?? []).map((p) => ({ value: p.value, label: p.label }))}
          />
        </div>

        <div>
          <label className="label">Model <span className="faint normal-case">(blank = {defaultModel})</span></label>
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={defaultModel} />
        </div>

        <div>
          <label className="label">API key {s?.has_key && <span className="badge badge-success">saved</span>}</label>
          <div className="relative">
            <input type={show ? "text" : "password"} className="input font-mono !pr-16" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={s?.has_key ? "•••••••• — leave blank to keep the saved key" : "Paste your API key"} />
            {(apiKey || s?.has_key) && (
              <button type="button" onClick={toggleShow} disabled={revealing}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium"
                style={{ color: "var(--accent)" }}>
                {revealing ? "…" : show ? "Hide" : "Show"}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs faint">
            {provider === "anthropic" && "console.anthropic.com → API keys"}
            {provider === "openai" && "platform.openai.com → API keys"}
            {provider === "groq" && "console.groq.com → API keys"}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}
