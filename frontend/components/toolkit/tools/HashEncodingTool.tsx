"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";
import { OptionLabel } from "../OptionField";
import Select from "@/components/ui/Select";

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

  const recompute = useCallback(async (value: string, type: typeof hashType) => {
    try {
      let result = "";
      if (type === "base64-encode") {
        result = btoa_(value);
      } else if (type === "base64-decode") {
        result = atob_(value);
      } else if (type === "url-encode") {
        result = encodeURIComponent(value);
      } else if (type === "url-decode") {
        result = decodeURIComponent(value);
      } else if (type === "hex-encode") {
        result = Array.from(value)
          .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join("");
      } else if (type === "sha256") {
        result = await sha256(value);
      }
      setOutput(result);
    } catch (e) {
      setOutput("");
    }
  }, []);

  useEffect(() => {
    recompute(input, hashType);
  }, [input, hashType, recompute]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
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
          <OptionLabel>Operation</OptionLabel>
          <Select
            value={hashType}
            onValueChange={(e) => setHashType(e as any)}
            className="w-full"
            options={[
              { value: "base64-encode", label: "Base64 Encode" },
              { value: "base64-decode", label: "Base64 Decode" },
              { value: "url-encode", label: "URL Encode" },
              { value: "url-decode", label: "URL Decode" },
              { value: "hex-encode", label: "Hex Encode" },
              { value: "sha256", label: "SHA-256 Hash" },
            ]}
          />
        </div>
      }
    />
  );
}
