# Universal DB Migration Studio — Project Spec

> **How to use this file:** This is a self-contained spec for a _new, standalone project_ (a GUI database
> migration tool). Create a fresh directory, drop this file in as `PLAN.md`, open it in VS Code / Claude Code,
> and a fresh agent can build the whole thing from this document alone. The first real-world job this tool
> must accomplish is migrating a legacy MySQL HRIS into a Supabase/Postgres schema (details in the last section).

---

## 1. What we're building

A **standalone, GUI-driven database migration tool** — MySQL Workbench "import wizard" style, but for **both
ends at once**. The user:

1. Configures reusable **connection profiles** (source + target), each of type **MySQL / PostgreSQL / Supabase / Neon**.
2. Picks a **source table** and a **target table**.
3. Sees **both column lists side by side**, with types.
4. **Checks the columns** to migrate and **maps** each source column → target column, with an optional
   type-cast / transform / default.
5. Runs the migration (with preview, dry-run, batching, upsert, and a reconciliation report).
6. **Saves the mapping as a reusable profile** so the same migration can be re-run or shared.

Connection profiles and mapping profiles are reusable **across every migration** the user does.

### Non-goals (v1)

- Not a scheduler / CDC / real-time replication (one-shot + re-runnable is enough).
- Not a full schema-DDL migrator (it moves **data** into existing target tables; it does not create target tables — though a "generate CREATE TABLE from source" helper is a nice-to-have in v2).
- No cloud hosting — runs **locally** on the user's machine.

---

## 2. Tech stack

Chosen to match the user's existing skills (Next.js + FastAPI) and Python's excellent DB-driver ecosystem.

| Layer                    | Choice                                                             | Why                                                       |
| ------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------- |
| Backend                  | **Python + FastAPI**                                               | Best DB introspection/driver story; async; user knows it  |
| DB access                | **SQLAlchemy Core 2.x** (+ `pymysql`, `psycopg[binary]`/`asyncpg`) | One uniform API for MySQL & Postgres; reflection built in |
| Frontend                 | **Next.js 15 (App Router) + React 18 + TypeScript + Tailwind**     | User's stack; can reuse shadcn/ui patterns                |
| State                    | Zustand                                                            | Lightweight, matches user's other project                 |
| Packaging (v2, optional) | **Tauri** (or Electron) wrapping the local web app                 | Ship as a desktop app later                               |
| Local run (v1)           | `uvicorn` backend on :8000 + `next dev` on :3000                   | Simplest to build/iterate                                 |

> **Key simplification:** Supabase and Neon are **just Postgres**. So there are only **two real engine
> drivers — MySQL and Postgres** — and Supabase/Neon are _presets_ over the Postgres connector (connection
> string + optional service-role note). Design the connector layer around engine = `mysql | postgres`, with a
> `flavor` tag (`mysql | postgresql | supabase | neon`) for presets and UI labeling.

---

## 3. Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────────────┐
│  Frontend (Next.js)         │  HTTP  │  Backend (FastAPI)                     │
│  - Connections manager      │ <────> │  /connections   CRUD + test            │
│  - Schema/table browser     │        │  /introspect    schemas/tables/columns │
│  - Column mapping canvas     │        │  /preview       sample rows            │
│  - Run + progress + report   │        │  /migrate       run job (streamed)     │
│                             │        │  /mappings      save/load profiles     │
└─────────────────────────────┘        └───────────────┬────────────────────────┘
                                                        │ SQLAlchemy engines
                                          ┌─────────────┴──────────────┐
                                          │  Connector layer            │
                                          │  MySQLConnector             │
                                          │  PostgresConnector (SB/Neon)│
                                          └─────────────┬──────────────┘
                                              source DB ─┴─ target DB
```

### Connector interface (backend)

A single abstract `Connector` with two implementations. Methods:

- `test_connection() -> {ok, server_version, latency_ms}`
- `list_schemas() -> [str]`
- `list_tables(schema) -> [{name, row_estimate}]`
- `list_columns(schema, table) -> [{name, data_type, nullable, is_pk, is_fk, fk_target, default, char_len, numeric_precision}]` ← via SQLAlchemy `inspect()` reflection
- `sample_rows(schema, table, limit) -> [dict]`
- `count_rows(schema, table, where=None) -> int`
- `read_batches(schema, table, columns, batch_size, order_by) -> Iterator[list[dict]]` (keyset/offset pagination)
- `write_batch(schema, table, rows, conflict_strategy, conflict_keys) -> {inserted, updated, skipped, errors}`
  - Postgres: `INSERT ... ON CONFLICT (keys) DO NOTHING|UPDATE`; MySQL: `INSERT ... ON DUPLICATE KEY UPDATE`.

### Data model (persisted locally as JSON files, or SQLite)

- **ConnectionProfile**: `{ id, name, flavor: mysql|postgresql|supabase|neon, host, port, database, user, password(encrypted), ssl, extra_params, service_role_key? }`
  - Store secrets encrypted at rest (OS keyring or a local key); never log passwords.
- **MappingProfile**: `{ id, name, source_conn_id, target_conn_id, source_table, target_table, column_maps: [{ source_col, target_col, enabled, cast_type, transform_expr, default_value, is_conflict_key }], conflict_strategy, batch_size, filters }`

---

## 4. UI flow (the Workbench-style wizard)

**Screen 1 — Connections.** List of saved connections. "New connection" form: flavor dropdown
(MySQL / PostgreSQL / Supabase / Neon) → fields adapt (Supabase/Neon show a "paste connection string" +
optional service-role key; MySQL/Postgres show host/port/db/user/pass). **Test Connection** button with a live
status pill. Connections are reusable everywhere.

**Screen 2 — Pick source & target.** Two panels. Choose a source connection → schema → table. Choose a target
connection → schema → table. Show row-count estimate for each.

**Screen 3 — Column mapping (the core).** Two-column layout:

- Left: source columns (name + type + PK/FK/nullable badges) with a **checkbox** each.
- Right: target columns.
- Middle: for each **checked** source column, a mapping row: `source_col → [target_col dropdown] [cast type] [transform expr] [default]` and a "conflict key?" toggle.
- **Auto-map** button: match by exact/normalized name (snake/camel-insensitive) and flag type mismatches in amber.
- Unmapped required (NOT NULL, no default) target columns are flagged red before run.
- Global controls: **conflict strategy** (insert / upsert / skip-duplicates), **batch size**, optional **WHERE filter** on source.

**Screen 4 — Preview & dry-run.** Show first N transformed rows exactly as they'll be written (post-cast/transform).
"Dry run" validates types + counts without writing.

**Screen 5 — Run & report.** Streamed progress bar (rows read / written / skipped / errored), live error log,
and a final **reconciliation report** (source count vs inserted+skipped, FK/null violations). Save as MappingProfile.

---

## 5. Transform & type-casting rules

- Built-in casts: text→int/numeric/bool/date/timestamp/uuid, with a configurable **date format string** (legacy
  systems store dates as varchar — this is essential).
- `transform_expr`: a **safe, sandboxed** mini-expression per column (whitelist only — e.g. `trim`, `lower`,
  `upper`, `split_part`, `coalesce`, `map({...})`, `to_bool('yes','no')`, `parse_date(fmt)`). **No arbitrary
  `eval`.** Implement as a tiny interpreter or a restricted function registry.
- `default_value` when source is null/empty.
- **Deterministic UUID** helper (`uuid5(namespace, source_key)`) — critical for idempotent re-runs and for
  linking rows across multiple related migrations (e.g. person → employee).
- Row-level validation: collect errors per row, continue or abort based on a "stop on error" toggle.

---

## 6. Safety & correctness (must-haves)

- Introspection and preview are **read-only**.
- Every write runs in **batched transactions**; failed batch → rollback that batch, log, continue/stop per setting.
- **Idempotent by design:** upsert/`ON CONFLICT` + deterministic keys so re-running converges (no duplicates).
- **Never** write to a target table the user didn't explicitly select; no implicit DDL.
- Secrets encrypted at rest; passwords redacted in all logs/exports.
- A **"staging first"** option: load into a `staging.<table>` copy for inspection before promoting.

---

## 7. Build milestones

1. **M1 — Connector core.** FastAPI skeleton + `Connector` abstraction + MySQL/Postgres impls; `/connections`
   (CRUD, encrypted store) + `/test`. CLI-testable.
2. **M2 — Introspection API.** `/introspect` (schemas/tables/columns via SQLAlchemy reflection) + `/preview`.
3. **M3 — Frontend shell.** Next.js app; Connections screen; source/target picker; live "Test connection".
4. **M4 — Mapping canvas.** Two-column mapping UI, auto-map, type-mismatch flags, required-column validation.
5. **M5 — Transform engine.** Cast/transform/default registry + deterministic UUID + sandboxed expressions; dry-run + preview of transformed rows.
6. **M6 — Migration runner.** Batched read→transform→write with conflict strategy; streamed progress; error log; reconciliation report.
7. **M7 — Profiles.** Save/load MappingProfiles (JSON); re-run a saved migration in one click.
8. **M8 (optional) — Tauri/Electron packaging** + "generate CREATE TABLE from source" helper.

Deliver M1–M7 for a usable v1.

---

## 8. First real job to validate the tool (acceptance test)

The tool's first production use is migrating a **legacy MySQL HRIS** into a **Supabase/Postgres** schema. Use it
as the end-to-end acceptance scenario for M6/M7.

**Source (MySQL)** three tables: `tbl_personal_info`, `tbl_office_info`, `admin_user_info`.

**Target (Supabase/Postgres)** hub-and-spoke identity model — load order matters:

```
auth.users   ← admin_user_info        (login; legacy password hashes are unusable → temp password + force-change)
people        ← tbl_personal_info      (identity + demographics + present/permanent addresses)   ★ anchor
employees     ← tbl_office_info        (employment; join on employee_id; employee_number = legacy id)
user_roles    ← admin_user_info.user_type
```

Representative column-mapping challenges this tool must handle (proves the transform engine):

- **varchar → date** parsing (`date_of_birth`, `joining_date`, `confirmation_date`) with a configurable format.
- **One field → two** (`employee_name` → `first_name` + `last_name`, split on last space) via transform expr.
- **Free-text FK resolution** (`department_name` → `department_id` UUID) via a lookup/`map({...})` transform.
- **yes/no → boolean** (`record_of_police_case` → `has_police_record`).
- **Deterministic UUIDs** from legacy `employee_id` so `people`/`employees`/`auth.users` rows link and re-runs are idempotent.
- **Split address** (`present_address`,`city_1`,`country_1`,`postal_code_1`,`police_station_1` → `present_street/city/country/postcode/state`).

> The detailed HRIS field-by-field mapping already exists in the production repo context; when this tool is
> ready, that mapping becomes the first saved **MappingProfile** set (one per target table). Success =
> reconciliation report shows source row count == loaded people/employees, zero FK orphans, and a migrated
> user can log in with the temp password.

---

## 9. Suggested repo layout for the new project

```
db-migration-studio/
├── PLAN.md                      # this file
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── connectors/          # base.py, mysql.py, postgres.py
│   │   ├── api/                 # connections.py, introspect.py, preview.py, migrate.py, mappings.py
│   │   ├── transform/           # registry.py (casts), expr.py (sandboxed), uuidgen.py
│   │   ├── store/               # encrypted connection + mapping profile storage (SQLite or JSON+keyring)
│   │   └── models.py            # pydantic schemas
│   └── requirements.txt         # fastapi, uvicorn, sqlalchemy, pymysql, psycopg[binary], cryptography
├── frontend/                    # Next.js app (connections, picker, mapping canvas, runner)
└── README.md                    # how to run both locally
```

---

## 10. First steps for the executing agent

1. Scaffold `backend/` (FastAPI) and `frontend/` (Next.js) per §9.
2. Implement the `Connector` base + MySQL/Postgres connectors (§3) — get `/test` and `/introspect` working against a real MySQL and a real Postgres/Supabase.
3. Build the Connections + source/target picker UI (M3), then the mapping canvas (M4).
4. Add the transform engine (M5), then the batched runner + reconciliation (M6).
5. Validate against the HRIS scenario in §8.
