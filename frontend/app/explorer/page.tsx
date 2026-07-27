// The Explorer UI is rendered by <PersistentExplorer /> in the root layout so
// it stays mounted across navigation (full state persistence). This route only
// needs to exist so /explorer is navigable — the layout shows the Explorer when
// the pathname is /explorer.
export default function ExplorerPage() {
  return null;
}
