"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";

// Simple crypto functions (note: for production, use a proper crypto library)
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function btoa_(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function atob_(text: string): string {
  return decodeURIComponent(escape(atob(text)));
}

const EMPTY_OPTIONS = {};

export default function HashEncodingTool() {
  const selectedTool = "hash-encoding";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const options = useToolkitStore((s) => s.toolOptions[selectedTool] ?? EMPTY_OPTIONS);
  const updateOptions = useToolkitStore((s) => s.updateOptions);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const [hashType, setHashType] = useState<"base64-encode" | "base64-decode" | "url-encode" | "url-decode" | "hex-encode" | "sha256">(options.hashType || "base64-encode");
  const [output, setOutput] = useState("");

  const handleInputChange = async (value: string) => {
    updateInput(selectedTool, value);

    try {
      let result = "";
      if (hashType === "base64-encode") {
        result = btoa_(value);
      } else if (hashType === "base64-decode") {
        result = atob_(value);
      } else if (hashType === "url-encode") {
        result = encodeURIComponent(value);
      } else if (hashType === "url-decode") {
        result = decodeURIComponent(value);
      } else if (hashType === "hex-encode") {
        result = Array.from(value)
          .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join("");
      } else if (hashType === "sha256") {
        result = await sha256(value);
      }
      setOutput(result);
    } catch (e) {
      setOutput("");
    }
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
    updateOptions(selectedTool, { hashType });
  };

  return (
    <ToolContainer
      title="Hash / Encoding Utility"
      description="Encode/decode: Base64, URL encoding, hex, and SHA-256 hashing."
      inputPlaceholder="Paste text to encode or decode..."
      outputPlaceholder="Encoded/decoded output will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => {
        updateInput(selectedTool, "");
        setOutput("");
      }}
      onCopy={handleCopy}
      options={
        <div>
          <label className="text-sm font-medium block mb-2">Operation</label>
          <select
            value={hashType}
            onChange={(e) => setHashType(e.target.value as any)}
            className="w-full rounded border p-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <option value="base64-encode">Base64 Encode</option>
            <option value="base64-decode">Base64 Decode</option>
            <option value="url-encode">URL Encode</option>
            <option value="url-decode">URL Decode</option>
            <option value="hex-encode">Hex Encode</option>
            <option value="sha256">SHA-256 Hash</option>
          </select>
        </div>
      }
    />
  );
}
