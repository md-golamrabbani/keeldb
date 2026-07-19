# Migration Studio — Product Roadmap & Feature Plan

> A **production‑safe database workbench**: migrate, explore, guard, and monitor
> MySQL / PostgreSQL / Supabase / Neon (and `.sql` dumps) from one professional app
> that runs on the web **and** as a native desktop app (Windows / macOS / Linux).

This document merges the current‑state audit, the missing‑feature analysis, the
accepted feature ideas, new proposals, the quality bar that makes it feel
"professional," and a responsive / cross‑platform design standard — into one
phased plan.

---

## 1. Product identity

Not "another SQL client." The unifying promise is **safety + clarity when touching
real data**, organized into four modules under one app:

| Module | Purpose |
| ------ | ------- |
| **Migrate** | Move & transform data between databases and `.sql` dumps. |
| **Explore** | Browse, edit, query, and understand a database. |
| **Guard**  | Prevent accidental production disasters. |
| **Health** | Observe performance, locks, growth, and problems. |

Everything below maps to one of these four modules, so the app reads as a serious
platform rather than a collection of scripts.

---

## 2. Current state (already built)

**Migrate** — connection profiles (MySQL/Postgres/Supabase/Neon + `.sql` import),
source/target picker, visual column‑mapping canvas (cast / date‑format / sandboxed
transform / default / conflict key), auto‑map, transform engine (safe AST‑whitelisted
expressions, deterministic `uuid5`, casts), preview + dry‑run, batched idempotent
runner with conflict strategy, streamed progress + reconciliation report, saved &
re‑runnable mapping profiles, output modes (push / download `.sql` `.csv` `.json`),
SSH‑tunnel connections, and MySQL→Postgres value sanitization (zero‑dates / empty→NULL).

**Explore** — multi‑tab workbench; data grid with rows‑per‑page, search,
phpMyAdmin‑style advanced filter, sort, sticky header + sticky key columns, inline
edit, add / bulk‑delete (by PK), FK badges with peek + jump‑to‑referenced‑table,
CSV import, CSV/JSON/SQL export; editable Structure (add / rename / drop / change
type, type dropdown); table Operations (rename / truncate / drop); Triggers list;
Designer ERD (draggable, zoom, fullscreen, PNG/JPG export, DDL); SQL editor
(syntax highlight, autocomplete for keywords/tables/columns, real‑time parser lint,
Workbench‑style row limit, results grid + CSV download); Database menu (create /
rename / drop database, create table, privileges view).

**Platform** — Next.js 15 + FastAPI; light/dark theme; Tauri v2 desktop packaging
(Python backend frozen as a PyInstaller sidecar), CI matrix for Win/macOS/Linux.

---

## 3. Gap analysis (original — historical)

> **Note:** this section captured the state *before* the phased build. Most items
> below are now shipped — see the ✅/🔨 markers in §4 and the phase status in §7 for
> what's actually current.

### Migrate
- **No "create target table from source"** — target must pre‑exist. Needs type
  translation (`tinyint(1)`→`boolean`, `datetime`→`timestamptz`, …) and `CREATE TABLE`.
- **One table per mapping** — no multi‑table / whole‑schema job, no FK‑aware load order.
- **No job history / checkpoint / resume** — reports are ephemeral; no offset resume.
- **No "staging first"** load and **no pre‑flight validation** (required/unique/regex).
- **Thin transform language** — no conditionals, date arithmetic, number formatting, regex.

### Explore
- **No index management**; **no constraint management** (add/drop FK, unique, check).
- **No views / stored procedures / functions** editing (triggers are read‑only).
- **No query history, saved snippets, or EXPLAIN / query‑plan** view.
- **SQL results capped at 1000, no paging**; export is CSV‑only.
- **No JSON/blob cell viewer**, whole‑row edit form, copy‑as‑INSERT/CSV, column freeze/reorder/hide.
- **No reverse‑FK** ("which rows reference this one").
- **Privileges/users read‑only** — no grant/revoke or user management.

### Connections & engines
- **MySQL/Postgres family only** — no native SQLite, SQL Server, Oracle, Mongo.
- No connection grouping/tags/search, no read‑only mode, no per‑connection timeout,
  no client‑cert / custom‑CA SSL.
- Secrets in a **local Fernet key file**, not the OS keychain.

### Safety & security
- **Backend has no auth** — in web mode anyone reaching `:8000` has full DB access.
- Migration WHERE filter is **raw text** (not parameterized).

### Quality & infra
- **No automated test suite / no web CI.**
- **No auto‑update** for desktop; AppImage not built; installers unsigned.
- Data grid is **not virtualized** — struggles past ~50k rows.

---

## 4. Feature catalog (by module)

Legend: ⭐ flagship / differentiator · ✅ already built · 🔨 to build

### 4.1 Guard — production safety (build first)
- ✅ ⭐ **Safe Production Query Assistant** — block `DELETE`/`UPDATE` without `WHERE`;
  warn on full‑table scans; **preview the actual rows** a write will change (run the
  equivalent `SELECT` first) with an **estimated affected‑row count** before commit.
- ✅ ⭐ **Environment tagging** — mark each connection `prod / staging / dev`; color the
  entire UI (red on prod); auto‑enforce stricter guardrails on prod.
- ✅ ⭐ **Read‑only mode** — default on; writes require explicit opt‑in per session.
- 🔨 **Transaction sandbox** — run any write inside a transaction, inspect results,
  then **Commit or Rollback** with a button. *(reads/writes already run in a rolled‑back
  preview txn; explicit commit/rollback UI still to build.)*
- 🔨 **Auto‑snapshot before destructive ops** — copy affected rows aside → real undo.
- 🔨 **Audit log** — every statement (who / when / SQL / rowcount), exportable.
  *(query history captures SQL + rowcount; full audit export still to build.)*
- 🔨 **Kill switch** — per‑query statement timeout + max‑affected‑rows abort.

### 4.2 Migrate — completeness
- ✅ ⭐ **Auto‑generate target schema** from source (dialect‑aware DDL translation).
- ✅ ⭐ **Migration projects** — group table mappings, FK‑ordered, run‑all + combined report.
- ✅ **Migration Rollback Simulator** — before applying, report: rollback possibility,
  potential data loss, estimated downtime / lock risk, tables affected.
- ✅ **Post‑migration verification** — row‑count reconcile + FK‑orphan scan.
  *(per‑table checksums + sample‑row diff still to build.)*
- 🔨 **Migration changelog** — track applied migrations with up/down scripts (Flyway‑lite).
- 🔨 **Pre‑migration gate** — check locks, long‑running transactions, disk, replication lag.
- 🔨 **Staging‑first** load option; **checkpoint/resume** for large jobs.
- ✅ **Data masking / anonymization** transforms (fake email/name/phone, mask, hash, redact) for prod→dev.
- 🔨 Richer transform language: `if/else`, date math, number/format, regex, lookups.

### 4.3 Explore — deeper client + quality tools
- ✅ ⭐ **Query Performance Analyzer** — run `EXPLAIN`, flag full scans / temp sorts, suggest indexes.
- ✅ ⭐ **Foreign‑Key Dependency Visualizer / Relational Debugger** — select a row and see all
  dependent rows in child tables, delete/cascade impact. Reverse‑FK ("who references me").
- ✅ ⭐ **Duplicate Record Detector** — find duplicates by one or more columns (email/phone,
  SKU/name, external ID), drill into a group. *(fuzzy match + merge actions still to build.)*
- ✅ **Data profiler** — per‑column null %, distinct count, min/max/avg, pattern detection
  (email/uuid/url/phone); one‑click on any table.
- ✅ **Orphaned‑row / referential‑integrity checker** (great post‑migration).
- 🔨 **Constraint pre‑validator** — show rows that would violate a proposed constraint.
- ✅ **Index management** (create/drop, duplicate/redundant/unused‑index advisor) and
  **constraint management** (add/drop FK & unique, list).
- ✅ **Query history + saved snippets/favorites**. *(multiple result tabs w/ paging: 🔨)*
- 🔨 **Result‑set diff**; **multi‑DB query** (run once across shards, merge results).
- 🔨 **JSON/blob viewer**, whole‑row edit form, copy‑as‑INSERT/CSV/JSON, column freeze/hide.
- ✅ Export results to CSV / JSON / SQL. *(Excel + SQL formatter/beautifier: 🔨)*

### 4.4 Health — monitoring dashboard
- ✅ ⭐ **DB Health Dashboard** — storage & size overview, top tables by size/rows, live server
  metrics (connections, cache‑hit, deadlocks…), active sessions — one screen. *(slow‑query &
  replication‑lag panels: 🔨.)*
- ✅ **Index advisor** (duplicate/redundant/unused); **kill query/session** button in the live view.
  *(bloat / vacuum advisor: 🔨.)*
- ✅ **Alerts** — a saved query / threshold that fires on demand ("Check now").
  *(scheduled cron + email/Slack delivery is a deploy‑time concern: 🔨.)*

### 4.5 Cross‑cutting
- ✅ **AI assist** ⭐ — natural‑language → SQL (optional; needs `ANTHROPIC_API_KEY`).
  *(AI auto‑mapping + "explain/fix this SQL error": 🔨.)*
- ✅ **Command palette (⌘/Ctrl‑K)** — jump to any page / action.
- ✅ **Portable project files** — export/import connections (no secrets) + mappings/projects/snippets/alerts.
- ✅ **Result charts** — quick bar/line on any query result. *(pie: 🔨.)*
- ✅ **Backup / restore** a table (schema + data as `.sql`). *(whole‑database backup: 🔨.)*
- 🔨 **More engines** — native SQLite, SQL Server, Oracle, MongoDB. *(deferred: each needs its own
  driver + a live server to verify; Mongo doesn't fit the SQLAlchemy‑Core core.)*

---

## 5. Non‑functional bar ("very professional")

These separate a hobby tool from one people trust with production data:

1. **Never lose data** — transactional everything, auto‑backup before destructive ops,
   real undo. The #1 trust signal for a DB tool.
2. **Virtualized data grid** — row/column virtualization for 100k+ rows.
3. **Test suite + CI** — unit + integration + e2e; typecheck/lint on every PR.
4. **AuthN/Z** — backend API token/session; **secrets in the OS keychain**; read‑only enforcement.
5. **Signed, auto‑updating installers** (Tauri updater) for all three OSes.
6. **Complete component states** — loading / empty / error / success everywhere; inline help.
7. **Self‑observability** — structured logs, opt‑in telemetry, crash reporting.
8. **Accessibility** — WCAG 2.1 AA: full keyboard nav, ARIA roles, visible focus,
   `prefers-reduced-motion`, color‑contrast in both themes.

---

## 6. Responsive & cross‑platform design standard

The UI must look and work **professionally on every screen and platform** — phone,
tablet, laptop, large desktop, and inside the Tauri desktop shell.

### 6.1 Breakpoints & layout
| Tier | Width | Layout behavior |
| ---- | ----- | --------------- |
| Mobile | `< 640px` | Top nav collapses to a hamburger/drawer; single column; tabs become a dropdown/segmented control; modals go full‑screen; toolbars wrap or move into an overflow "⋯" menu. |
| Tablet | `640–1024px` | Two‑pane where it fits; table list becomes a collapsible drawer; condensed toolbars. |
| Desktop | `1024–1600px` | Full multi‑pane workbench (sidebars + tabs + content). |
| Wide | `> 1600px` | Centered max‑width container; optional split views. |

- **Data grid**: horizontal scroll inside its own container (never the page); sticky
  header + sticky key/action columns; a **card/stacked view** fallback on very narrow
  screens; virtualized rows regardless of tier.
- **ERD / Designer**: pinch‑zoom + drag‑pan on touch; fit‑to‑screen; fullscreen.
- **SQL editor**: resizable; on mobile, results collapse below the editor with a toggle.
- **Dialogs**: centered on desktop, full‑screen sheets on mobile; ESC / swipe‑to‑close.

### 6.2 Design system (already partly in place)
- **Tokens** — CSS custom properties for color / spacing / radius / shadow, driving
  **light + dark** (and a future high‑contrast) themes; theme set before first paint.
- **Type scale** — fluid (`clamp()`) so headings/body scale with viewport.
- **Spacing** — 4px base grid; consistent component paddings across tiers.
- **Touch targets** — ≥ 44×44px on touch; larger hit areas for icon buttons on mobile.
- **Density toggle** — comfortable / compact for power users on large screens.
- **Motion** — subtle, GPU‑friendly transitions; disabled under `prefers-reduced-motion`.

### 6.3 Cross‑platform
- **Web** — all modern browsers; consider a **PWA** (installable, offline shell).
- **Desktop (Tauri)** — identical UI; native window chrome, app menu, OS keychain,
  file dialogs for import/export, auto‑update.
- **Behavioral parity** — the same components render in browser and desktop; the only
  difference is the backend transport (proxy in web, local sidecar in desktop).
- **Testing matrix** — Chrome/Safari/Firefox + Tauri (WebKitGTK/WebView2/WKWebView),
  at mobile / tablet / desktop widths, in light & dark.

### 6.4 Definition of "responsive done" (per screen)
- No horizontal page scroll at any width; only designated scroll containers scroll.
- Every interactive element reachable by keyboard and ≥ 44px on touch.
- Light & dark both pass AA contrast.
- Loading / empty / error states present.
- Works in the Tauri desktop shell identically to the browser.

---

## 7. Phased roadmap

Status: **Phases 1–5 shipped** (except the deploy/driver items called out below).
The backend carries **132 passing tests**; `tsc --noEmit` and `next build` are clean on
every commit.

**Phase 0 — Harden the foundation** — 🟡 *mostly done*
✅ Test suite + web CI · ✅ backend read‑only mode · ✅ loading/empty/error states ·
✅ responsive pass. 🔨 virtualized data grid · 🔨 secrets → OS keychain · 🔨 backend auth.

**Phase 1 — Guard (flagship safety layer)** — 🟢 *core done*
✅ Environment tagging + prod coloring · ✅ Safe Query Assistant (no‑WHERE block, affected‑row
preview). 🔨 transaction sandbox (commit/rollback UI) · 🔨 auto‑snapshot/undo · 🔨 audit‑log
export · 🔨 statement timeout.

**Phase 2 — Migrate completeness** — ✅ *complete*
✅ Auto‑generate target schema (DDL translation) · ✅ migration projects (FK‑ordered
multi‑table) · ✅ post‑migration verification (reconcile + orphan scan) · ✅ rollback simulator ·
✅ data masking. 🔨 checkpoint/resume.

**Phase 3 — Explore + Performance** — ✅ *complete*
✅ Query Performance Analyzer (EXPLAIN + index hints) · ✅ FK/relational debugger + reverse‑FK ·
✅ duplicate detector · ✅ data profiler · ✅ index/constraint management · ✅ query
history/snippets · ✅ CSV/JSON/SQL exports.

**Phase 4 — Health** — ✅ *complete*
✅ Monitoring dashboard (storage, top tables, server metrics, sessions) · ✅ index advisor ·
✅ kill session · ✅ alerts (on‑demand). 🔨 bloat/vacuum advisor · 🔨 scheduled cron+email/Slack delivery.

**Phase 5 — Elevate** — 🟢 *core done*
✅ AI assist (NL→SQL) · ✅ command palette · ✅ portable projects · ✅ result charts ·
✅ backup/restore (table). 🔨 more engines (SQLite/MSSQL/Oracle/Mongo — needs drivers + live
servers) · 🔨 signed auto‑updating installers (needs code‑signing certs + update host).

*(Cross‑cutting: the responsive/design standard and accessibility apply to every phase,
not a separate step.)*

### Deferred — need external resources, not code
- **More engines (SQL Server / Oracle / MongoDB):** each needs its own driver
  (`pyodbc` / `oracledb` / `pymongo`) **and** a live server to verify against; MongoDB
  doesn't fit the SQLAlchemy‑Core foundation the app is built on.
- **Signed, auto‑updating installers:** Apple/Windows code‑signing certificates,
  notarization, and an update‑feed host — CI/deploy infrastructure and secrets.
- **Backend auth + OS‑keychain secrets:** the backend binds to localhost only; hardening
  these matters for a hosted/multi‑user deployment.

---

## 8. Suggested next step

The phased build is essentially delivered (see §7). The highest‑value remaining work,
in order:

1. **Finish Guard** — transaction sandbox (commit/rollback UI), auto‑snapshot/undo, and
   audit‑log export. These raise the production‑safety bar the whole product promises.
2. **Scheduler + delivery for alerts** — a background cron plus email/Slack notifiers so
   the existing alert rules fire automatically, not just on "Check now".
3. **Virtualized data grid** — row/column virtualization for 100k+ rows (the last big
   non‑functional gap for large tables).
4. **Deployment hardening** — backend auth + OS‑keychain secrets, then signed
   auto‑updating installers, when the app moves beyond localhost use.
5. **More engines** — add SQL Server / Oracle behind driver checks when a real instance
   is available to test against.
