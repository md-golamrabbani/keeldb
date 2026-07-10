"use client";
import React, { useState, useCallback } from "react";
import { IconCopy, IconTrash } from "@/components/icons";
import { downloadFile } from "@/lib/toast";

export interface ToolContainerProps {
  title: string;
  description?: string;
  inputPlaceholder?: string;
  outputPlaceholder?: string;
  input?: string;
  output?: string;
  error?: string;
  options?: React.ReactNode;
  onInputChange?: (value: string) => void;
  onCopy?: (text: string) => void;
  onClear?: () => void;
  onDownload?: (filename: string, content: string) => void;
  children?: React.ReactNode;
}

export default function ToolContainer({
  title,
  description,
  inputPlaceholder = "Paste your data here...",
  outputPlaceholder = "Output will appear here...",
  input = "",
  output = "",
  error,
  options,
  onInputChange,
  onCopy,
  onClear,
  onDownload,
  children,
}: ToolContainerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (output) {
      navigator.clipboard.writeText(output);
      setCopied(true);
      onCopy?.(output);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [output, onCopy]);

  const handleClear = useCallback(() => {
    onInputChange?.("");
    onClear?.();
  }, [onClear, onInputChange]);

  const handleDownload = useCallback(() => {
    if (output) {
      const filename = `output-${Date.now()}.txt`;
      downloadFile(output, filename);
      onDownload?.(filename, output);
    }
  }, [output, onDownload]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm muted">{description}</p>}
      </div>

      {options && (
        <div className="card card-pad">
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Options</h3>
            <div className="grid gap-4 grid-cols-3">{options}</div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <label className="block text-sm font-medium">Input</label>
          <textarea
            value={input}
            onChange={(e) => onInputChange?.(e.target.value)}
            placeholder={inputPlaceholder}
            className="input flex-1 font-mono text-sm resize-none"
            style={{ minHeight: "200px" }}
          />
          <button
            onClick={handleClear}
            className="btn btn-ghost btn-sm w-fit"
            disabled={!input}
          >
            <IconTrash width={14} height={14} /> Clear
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="block text-sm font-medium">Output</label>
          <textarea
            value={output}
            readOnly
            placeholder={outputPlaceholder}
            className="input flex-1 font-mono text-sm resize-none"
            style={{ minHeight: "200px", background: "var(--surface-2)" }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className={`btn btn-sm flex-1 ${copied ? "btn-success" : "btn-primary"}`}
              disabled={!output}
            >
              <IconCopy width={14} height={14} /> {copied ? "Copied!" : "Copy"}
            </button>
            {onDownload && (
              <button
                onClick={handleDownload}
                className="btn btn-secondary btn-sm"
                disabled={!output}
              >
                Download
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <p className="alert-danger">{error}</p>}

      {children}
    </div>
  );
}
