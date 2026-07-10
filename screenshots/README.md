# Store-listing screenshots

App Center / GNOME Software loads screenshots from the URLs in
`frontend/src-tauri/metainfo/net.fiberathome.keeldb.metainfo.xml`, which point
at this folder on GitHub (`main` branch, raw URLs).

**Drop three PNGs here with exactly these names, then commit & push:**

| File | Shown as |
|---|---|
| `explorer.png` | Default screenshot — the data explorer |
| `diagrams.png` | ER diagram designer |
| `migrate.png` | Migration wizard |

Recommended: 16:9, at least 1280×720, PNG, light theme, no personal data.
After pushing, rebuild the .deb/.rpm (the URLs are baked into the metainfo)
and run `sudo appstreamcli refresh --force` (or wait for the daily refresh)
for App Center to pick them up.
