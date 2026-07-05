# Universal DB Migration Studio

GUI-driven database migration tool — MySQL Workbench "import wizard" style, but for **both ends at once**.
Move data between **MySQL / PostgreSQL / Supabase / Neon** (or from an imported **`.sql` dump**) with a
visual column-mapping canvas, safe per-column transforms, dry-runs, batched idempotent writes, and reusable
connection + mapping profiles.

Sources can be a live database **or a `.sql` dump file** (mysqldump / pg_dump). Output is your choice:
**push into the target database, or download the transformed rows as `.sql`, `.csv`, or `.json`.** Connections
can reach databases **through an SSH tunnel** (bastion host).

Built from the spec in [PLAN.md](PLAN.md).

## Run locally

Two processes: FastAPI backend on **:8000**, Next.js frontend on **:3000**.

### 1. Backend

```bash
cd backend
python3 -m venv .venv          # first time only
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000 --reload
```

API docs: http://127.0.0.1:8000/docs

> Port 8000 busy? Run on another port and point the frontend at it:
> `BACKEND_URL=http://127.0.0.1:8010 npm run dev`

### 2. Frontend

```bash
cd frontend
npm install                    # first time only
npm run dev
```

Open http://localhost:3000

## Using it

1. **Connections** — create source + target profiles. Toggle **Live database** vs **Import .sql file**:
   - *Live database*: MySQL/Postgres take host/port/db/user/pass; Supabase/Neon take a pasted connection
     string (`sslmode=require` added automatically). Optionally enable an **SSH tunnel** (bastion host/user
     + password or pasted private key) — the DB host/port are then reached *through* the tunnel.
     **Test connection** verifies before saving.
   - *Import .sql file*: upload a mysqldump / pg_dump `.sql`; it's parsed into a local read-only SQLite
     source you can map from like any connection.
2. **Migrate → Source & Target** — pick source connection/schema/table and target connection/schema/table
   (row estimates shown; a single-schema source auto-selects).
3. **Column Mapping** — check the source columns to migrate, map each to a target column
   (**Auto-map** matches by normalized name). Per column: optional **cast**
   (`int/numeric/bool/date/timestamp/uuid/text`, with a date format string), a **transform expression**,
   a **default** for null/empty, and a **conflict key** toggle. Type mismatches flag amber; unmapped
   NOT-NULL target columns flag red. Global: conflict strategy (insert / upsert / skip duplicates),
   batch size, optional WHERE filter, stop-on-error.
4. **Preview & Dry-run** — first 20 rows exactly as they'll be written; dry-run validates every row
   without writing.
5. **Run & Report** — choose the **output destination**: push into the target DB, or download the
   transformed rows as **`.sql`** (INSERTs, with optional `CREATE TABLE`), **`.csv`**, or **`.json`**.
   Streamed progress, live error log, reconciliation report (source count vs written + skipped + errored,
   target count after). **Save profile** stores the whole mapping (including output mode); re-run it any
   time from **Saved Migrations**.

> The target table is selected in every mode — for downloads it defines the output column names (and, for
> `.sql`, the `CREATE TABLE` types). Point at the table whose shape you want the export to match.

## Transform expressions

Safe, sandboxed (AST-whitelist — no arbitrary eval). Available: `trim, lower, upper, split_part,
split_before, coalesce, map, to_bool, parse_date, parse_timestamp, uuid5, concat, replace, substr,
zfill, nullif`. `value` is the current cell, `row['col']` reads any source column.

```python
split_part(value, ' ', -1)                    # last name from full name
split_before(value, ' ')                      # first name(s)
to_bool(value, 'yes', 'no')                   # yes/no → boolean
parse_date(value, '%d/%m/%Y')                 # varchar → date
map({'Human Resources': 'a1b2-…'}, trim(value))   # free-text FK → uuid
uuid5('people', row['employee_id'])           # deterministic id — idempotent re-runs,
                                              # and links related migrations (people ↔ employees)
```

## Safety properties

- Introspection & preview are read-only; writes go only to the table you explicitly selected — no DDL
  against the target. (`.sql` *exports* may contain a `CREATE TABLE` for you to run yourself.)
- Every batch is a transaction; failed batches roll back and are logged.
- Upsert + deterministic `uuid5` keys ⇒ re-running a migration converges (verified: 1200-row re-run
  produced zero duplicates).
- Imported `.sql` sources are parsed into a local SQLite file and are strictly read-only.
- Secrets (DB passwords, connection strings, SSH passwords/keys) are Fernet-encrypted at rest in `data/`
  (key file `data/key.bin`, mode 0600), never returned by the API, never logged. Keep `data/` out of
  version control.

## Layout

```
backend/app/
  connectors/    # base.py (reflection, keyset reads, SSH tunnel), mysql.py, postgres.py, sqlfile.py
  sqlimport/     # parser.py (tolerant SQL-dump parser), loader.py (dump -> SQLite)
  transform/     # registry.py (casts), expr.py (sandboxed expressions), uuidgen.py
  sinks.py       # output destinations: DBSink, SQLFileSink, CSVSink, JSONSink
  api/           # connections (+ upload-sql), introspect, preview, migrate (NDJSON + export), mappings
  store/         # encrypted JSON persistence (connections + mapping profiles)
  runner.py      # batched read → transform → write to a sink, progress events, reconciliation
  models.py      # pydantic schemas
frontend/
  app/           # / (connections), /migrate (4-step wizard), /profiles (saved migrations)
  components/    # SideNav, ThemeToggle, ConnectionForm, SourceTargetPicker, MappingCanvas,
                 # PreviewPanel, RunPanel, StatusPill, icons
  lib/           # api client (NDJSON stream + upload/export), zustand store, auto-map
```

The UI is a professional two-pane app (sidebar + content) with a light/dark theme toggle.
