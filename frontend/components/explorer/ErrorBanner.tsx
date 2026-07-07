"use client";

// A dismissible error alert — every error surface should let the user close it.
export default function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="alert-danger flex items-start gap-2">
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{message}</span>
      <button onClick={onClose} aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 leading-none opacity-70 transition-opacity hover:opacity-100"
        style={{ color: "inherit" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
