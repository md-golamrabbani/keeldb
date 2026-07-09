"use client";
import { useState, useMemo } from "react";
import ToolContainer from "../ToolContainer";
import { useToolkitStore } from "@/lib/toolkitStore";

function decodeBase64Url(str: string): string {
  let output = str.replace(/-/g, "+").replace(/_/g, "/");
  switch (output.length % 4) {
    case 0:
      break;
    case 2:
      output += "==";
      break;
    case 3:
      output += "=";
      break;
    default:
      throw new Error("Invalid base64url");
  }
  return decodeURIComponent(atob(output).split("").map((c) => "%"+ ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join(""));
}

export default function JwtInspectorTool() {
  const selectedTool = "jwt-inspector";
  const input = useToolkitStore((s) => s.toolInputs[selectedTool] ?? "");
  const updateInput = useToolkitStore((s) => s.updateInput);
  const addToHistory = useToolkitStore((s) => s.addToHistory);

  const output = useMemo(() => {
    try {
      if (!input.trim()) return "";

      const parts = input.trim().split(".");
      if (parts.length !== 3) return "Invalid JWT format (expected 3 parts separated by dots)";

      const [headerB64, payloadB64, signatureB64] = parts;

      const header = JSON.parse(decodeBase64Url(headerB64));
      const payload = JSON.parse(decodeBase64Url(payloadB64));

      let result = "=== HEADER ===\n";
      result += JSON.stringify(header, null, 2);
      result += "\n\n=== PAYLOAD ===\n";
      result += JSON.stringify(payload, null, 2);
      result += "\n\n=== SIGNATURE ===\n";
      result += signatureB64.substring(0, 50) + "...";

      // Show expiry if exists
      if (payload.exp) {
        const expDate = new Date(payload.exp * 1000);
        result += `\n\n=== EXPIRY ===\n`;
        result += `Unix: ${payload.exp}\n`;
        result += `Date: ${expDate.toISOString()}\n`;
        result += `Expires in: ${Math.floor((payload.exp * 1000 - Date.now()) / 1000)} seconds`;
      }

      // Show issued at if exists
      if (payload.iat) {
        const iatDate = new Date(payload.iat * 1000);
        result += `\n\n=== ISSUED AT ===\n`;
        result += `Unix: ${payload.iat}\n`;
        result += `Date: ${iatDate.toISOString()}`;
      }

      return result;
    } catch (e) {
      return `Error: ${(e as any).message}`;
    }
  }, [input]);

  const handleInputChange = (value: string) => {
    updateInput(selectedTool, value);
  };

  const handleCopy = (text: string) => {
    addToHistory(selectedTool, input, text);
  };

  return (
    <ToolContainer
      title="JWT / Token Inspector"
      description="Decode and inspect JWT tokens. Shows header, payload, expiry, and claims."
      inputPlaceholder="Paste your JWT token here..."
      outputPlaceholder="Decoded JWT will appear here..."
      input={input}
      output={output}
      onInputChange={handleInputChange}
      onClear={() => updateInput(selectedTool, "")}
      onCopy={handleCopy}
    />
  );
}
