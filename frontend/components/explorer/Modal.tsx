"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { IconClose } from "@/components/icons";

// shadcn-style dialog (Radix): centered, capped at 85vh with the *body*
// scrolling internally (the page never scrolls), focus-trapped, Esc/overlay to
// close. Same API as before — every modal in the app inherits this.
export default function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50" style={{ background: "rgba(3, 7, 18, 0.55)", backdropFilter: "blur(2px)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border"
          style={{
            maxWidth: wide ? "48rem" : "32rem",
            background: "var(--surface)",
            borderColor: "var(--border-strong)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-3">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 transition-colors hover:bg-[var(--surface-2)]" aria-label="Close">
              <IconClose width={16} height={16} style={{ color: "var(--text-muted)" }} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
