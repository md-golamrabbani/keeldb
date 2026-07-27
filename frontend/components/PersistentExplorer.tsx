"use client";
import { usePathname } from "next/navigation";
import ExplorerView from "./explorer/ExplorerView";

// The Explorer is mounted ONCE here (in the persistent layout) and kept alive
// across route changes — hidden, never unmounted — so all of its live state
// survives navigating to other pages: loaded rows, filters/sort, scroll
// position, active sub-tab and unsaved edits. Workbench-style full persistence.
// (A route page unmounts on navigation, which is why /explorer only keeps tab
// metadata; this keeps the whole thing.)
export default function PersistentExplorer() {
  const active = usePathname() === "/explorer";
  return (
    <div className={active ? "h-full" : "hidden"} aria-hidden={!active}>
      <ExplorerView />
    </div>
  );
}
