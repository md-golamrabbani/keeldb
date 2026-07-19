# Changelog

All notable changes to KeelDB are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/md-golamrabbani/keeldb/releases/tag/v0.1.1
[0.1.0]: https://github.com/md-golamrabbani/keeldb/releases/tag/v0.1.0
