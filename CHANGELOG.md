# Changelog

All notable changes to KeelDB are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3]

### Added
- **Paste rows as editable drafts** — Copy rows, then Paste creates pre-filled, editable draft rows (auto-
  increment PKs dropped); edit them (e.g. a unique slug), Add another, then Insert all. Failures keep the
  remaining drafts to fix and retry.
- **Custom date/time picker** — month + year navigation and hour/minute/second fields, replacing the
  unreliable native pickers that could block the page.
- **Right-click a column header** for quick actions: copy name, copy values, copy DISTINCT, copy as a SQL
  `IN (…)` list, and sort.
- **Show & copy the grid's SQL** — a `SQL` button shows the `SELECT *` query for the current
  filters/sort/search/page, ready to copy and share.
- **Resizable table list** with tooltips for truncated names.

### Changed
- Row selection is now clearable — the header checkbox toggles select-all/clear, plus a **Clear** button.
- The shown query uses `SELECT *` (not the full column list) and unqualified columns for readability.

## [0.1.2]

### Added
- **Editable SQL results** — a simple single-table `SELECT` with a primary key can now be edited right in the
  results grid (double-click → stage → Save by PK), using the same datatype-aware editors as the Data tab.
- **Copy / paste rows** and **inline in-grid row adding** in the Explorer data grid.
- **Right-click column headers** (Data tab + SQL results) for quick actions: copy name, copy values, copy
  DISTINCT, copy as a SQL `IN (…)` list, and sort.
- **Reveal saved secrets** on demand — AI provider API key, and DB connection password / connection string /
  SSH credentials.
- **Searchable saved queries** in the SQL sidebar.

### Changed
- **SQL editor** redesigned Supabase-style: action toolbar on top, **Results / Chart tabs**, independent
  scrolling for the sidebar and results, a shorter default editor height, and a compact results bar.
- **Tighter layout density** across the app for more data area.
- **Toasts** moved to top-center, larger, and last 5s.
- Full-width layout; large tables load instantly; SQL editor gains run-the-selection and a resize handle.

### Fixed
- AI over HTTPS `CERTIFICATE_VERIFY_FAILED` on packaged/corporate networks (OS trust store + certifi).
- Second scrollbar in the Data tab; add-row errors now stay in the dialog without losing input.

## [0.1.1]

### Added
- **Workbench-style grid editing** — cell edits are staged and highlighted, then applied via **Save** or
  discarded via **Revert**; navigation is locked while there are unsaved edits (no more silent auto-writes).
- **Per-schema tab memory** — open tabs are keyed by connection + schema and persisted, so switching schema
  or reopening the app restores exactly the tabs you had open.
- **Run-the-selection** in the SQL editor (Ctrl/⌘+Enter runs only the highlighted statement).
- Response field `total_estimated` so the data grid can show `~N rows` for estimated counts.

### Changed
- **Faster large tables** — unfiltered reads skip the full-table `COUNT(*)` and use the catalog row estimate
  (`pg_class.reltuples` / `information_schema`), so 50k+ row tables open instantly. Exact counts are kept when
  filtered or small.
- **Full-width layout** across the app, including the Supabase Auth page.
- SQL editor gets a reliable drag handle for resizing.
- The Database menu is reachable with only a connection; schema-scoped actions are disabled until a schema is
  chosen (create/rename/drop database need no schema).
- Toolkit pins the Sample Data Generator to the top of the sidebar.

### Fixed
- **AI over HTTPS `CERTIFICATE_VERIFY_FAILED`** on packaged builds and corporate/AV-proxied networks — the
  backend now layers the OS-native trust store (`truststore`) with a bundled `certifi` fallback. Verification
  stays on.
- Removed a second scrollbar in the Data tab; the grid now fills its container and only the grid scrolls.

## [0.1.0]

### Added
- Initial release: GUI database migration (MySQL / PostgreSQL / Supabase / Neon and `.sql` dumps) with a
  visual column-mapping canvas, casts, sandboxed transforms, dry-runs, and batched idempotent writes.
- Database Explorer (tabbed browser, data grid, SQL editor, structure editor, ERD/Designer).
- Developer Toolkit with 25+ SQL/data-prep utilities.
- Native desktop builds for Windows, macOS, and Linux (Tauri + PyInstaller sidecar).

[0.1.3]: https://github.com/md-golamrabbani/keeldb/releases/tag/v0.1.3
[0.1.2]: https://github.com/md-golamrabbani/keeldb/releases/tag/v0.1.2
[0.1.1]: https://github.com/md-golamrabbani/keeldb/releases/tag/v0.1.1
[0.1.0]: https://github.com/md-golamrabbani/keeldb/releases/tag/v0.1.0
