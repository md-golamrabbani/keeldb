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

## 3. Gap analysis (what's missing today)

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
- ⭐ **Safe Production Query Assistant** — block `DELETE`/`UPDATE` without `WHERE`;
  warn on full‑table scans; **preview the actual rows** a write will change (run the
  equivalent `SELECT` first) with an **estimated affected‑row count** before commit.
- ⭐ **Environment tagging** — mark each connection `prod / staging / dev`; color the
  entire UI (red on prod); auto‑enforce stricter guardrails on prod.
- ⭐ **Read‑only mode** — default on; writes require explicit opt‑in per session.
- **Transaction sandbox** — run any write inside a transaction, inspect results,
  then **Commit or Rollback** with a button.
- **Auto‑snapshot before destructive ops** — copy affected rows aside → real undo.
- **Audit log** — every statement (who / when / SQL / rowcount), exportable.
- **Kill switch** — per‑query statement timeout + max‑affected‑rows abort.

### 4.2 Migrate — completeness
- ⭐ **Auto‑generate target schema** from source (dialect‑aware DDL translation).
- ⭐ **Migration projects** — group table mappings, FK‑ordered, run‑all + combined report.
- **Migration Rollback Simulator** — before applying, report: rollback possibility,
  potential data loss, estimated downtime / lock risk, tables affected.
- **Post‑migration verification** — row counts + per‑table checksums + FK‑orphan scan
  + sample‑row diff (source vs target).
- **Migration changelog** — track applied migrations with up/down scripts (Flyway‑lite).
- **Pre‑migration gate** — check locks, long‑running transactions, disk, replication lag.
- **Staging‑first** load option; **checkpoint/resume** for large jobs.
- **Data masking / anonymization** transforms (fake email/name/phone) for prod→dev.
- Richer transform language: `if/else`, date math, number/format, regex, lookups.

### 4.3 Explore — deeper client + quality tools
- ⭐ **Query Performance Analyzer** — run `EXPLAIN`, highlight slow joins / missing
  indexes, suggest optimizations, and compare before/after a change.
- ⭐ **Foreign‑Key Dependency Visualizer / Relational Debugger** (merge the two) —
  select a row or table and see all dependent rows in child tables, delete/cascade
  impact, and hidden schema dependencies. Reverse‑FK navigation ("who references me").
- ⭐ **Duplicate Record Detector** — find duplicates by email/phone, SKU/name, external
  ID, or **fuzzy match** (configurable), with merge/cleanup actions.
- **Data profiler** — per‑column null %, distinct count, min/max, pattern detection
  (email/phone/UUID), value histograms; one‑click on any table.
- **Orphaned‑row / referential‑integrity checker** (great post‑migration).
- **Constraint pre‑validator** — show rows that would violate a proposed constraint.
- **Index management** (create/drop, unused‑index detector) and **constraint management**.
- **Query history + saved snippets/favorites**; multiple result tabs with paging.
- **Result‑set diff**; **multi‑DB query** (run once across shards, merge results).
- **JSON/blob viewer**, whole‑row edit form, copy‑as‑INSERT/CSV/JSON, column freeze/hide.
- Export results to CSV / JSON / Excel; SQL formatter/beautifier.

### 4.4 Health — monitoring dashboard
- ⭐ **DB Health Dashboard** — slow queries, lock waits, connection‑pool usage,
  deadlocks, replication lag, storage growth, top tables by size — one screen.
- **Index / bloat / vacuum advisor**; **kill query/session** button in the live view.
- **Scheduled reports / alerts** (email/Slack when a metric crosses a threshold or a
  saved query returns rows).

### 4.5 Cross‑cutting
- **AI assist** ⭐ — natural‑language → SQL, AI auto‑mapping (semantic column match +
  transform suggestions for messy legacy data), and "explain/fix this SQL error."
- **Command palette (⌘/Ctrl‑K)** — jump to any table / connection / action.
- **Portable project files** — export/import connections + mappings to share setups.
- **Result charts** — quick bar/line/pie on any query result.
- **Backup / restore** a table or database.
- **More engines** — native SQLite, SQL Server, Oracle, MongoDB.

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

**Phase 0 — Harden the foundation**
Test suite + web CI · virtualized data grid · backend auth + read‑only mode ·
secrets → OS keychain · complete loading/empty/error states · responsive pass +
mobile nav/drawer. *Goal: trustworthy, maintainable base.*

**Phase 1 — Guard (flagship safety layer)**
Environment tagging + prod coloring · Safe Query Assistant (no‑WHERE block, affected‑row
preview) · transaction sandbox · auto‑snapshot/undo · audit log · statement timeout.
*Goal: safe to point at production.*

**Phase 2 — Migrate completeness**
Auto‑generate target schema (DDL translation) · migration projects (FK‑ordered
multi‑table) · post‑migration verification · rollback simulator · checkpoint/resume ·
data masking. *Goal: real end‑to‑end MySQL→Postgres in one flow.*

**Phase 3 — Explore + Performance**
Query Performance Analyzer (EXPLAIN + index hints) · FK/relational debugger + reverse‑FK ·
duplicate detector · data profiler · index/constraint management · query history/snippets ·
richer exports. *Goal: deep understanding + cleanup.*

**Phase 4 — Health**
Monitoring dashboard · index/bloat advisors · kill session · scheduled alerts.
*Goal: daily operations without other dashboards.*

**Phase 5 — Elevate**
AI assist (NL→SQL, auto‑mapping) · command palette · portable projects · result charts ·
backup/restore · more engines (SQLite/MSSQL/Oracle/Mongo) · signed auto‑updating installers.

*(Cross‑cutting: the responsive/design standard and accessibility apply to every phase,
not a separate step.)*

---

## 8. Suggested next step

Build **Phase 1 (Guard)** first — environment tagging + the affected‑rows preview +
transaction sandbox + auto‑snapshot/undo. It's the smallest change with the largest
trust payoff, and it makes every other module safe to use against production. In
parallel, land **Phase 0** basics (tests/CI, virtualized grid, read‑only + auth) so
nothing regresses as the surface area grows.
