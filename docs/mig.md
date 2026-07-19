# Tier Migration — Sandbox DDL

DDL for standing up a **test project** to migrate the legacy `tbl_tier` table into
the new position-based org model. Two parts:

1. **Legacy staging table** — load the old CSV as-is (dirty data preserved), plus a
   cleaned view.
2. **Target core schema** — the new-model tables the migration writes into
   (faithful to `Backend/app/domains/org/models.py`).

> ⚠️ The resolver functions (`fn_resolve_line_manager`, `fn_resolve_approval_chain`,
> `fn_resolve_unit_head`) used for the **replay-diff** acceptance test are **not**
> tables — they come from `database/migration_sql/migration_040*`/`175*`. For a full
> end-to-end test, apply those migration files too (or `pg_dump --schema-only` prod).

---

## 0. Prerequisites

```sql
-- gen_random_uuid() lives in pgcrypto (bundled with Supabase/modern Postgres)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

---

## 1. Legacy staging table (load the CSV as-is)

All columns are `TEXT` on purpose — the CSV has whitespace-corrupted IDs
(`"02-0892Â Â "`), typo IDs (`"02-047"`), empty/blank tiers (` , , , ,`), self-refs
(`tr1 = own id`) and test rows (`02-50000`). Typed columns would reject them; we
clean **after** loading.

```sql
DROP TABLE IF EXISTS staging_tbl_tier;

CREATE TABLE staging_tbl_tier (
    tier_row_id              TEXT,   -- CSV "id" (integer PK in old system)
    employee_id              TEXT,   -- the employee this chain belongs to
    tr1                      TEXT,   -- Line Manager / Supervisor
    tr2                      TEXT,   -- Subfunction head
    tr3                      TEXT,   -- Function head (HOF)
    tr4                      TEXT,   -- Department head (HOD)
    tr5                      TEXT,   -- MD
    status                   TEXT,   -- 0/1 flag (meaning TBD)
    created_by               TEXT,   -- CSV "user" (reserved word — renamed)
    record_date              TEXT,   -- CSV "date" (reserved word — renamed)
    active                   TEXT,   -- Yes/No
    level                    TEXT,   -- 0/5/10/80/100 seniority rank
    delegation               TEXT,   -- CSV "deligation" (empty in data)
    kpi_eligible             TEXT,   -- 0/1
    job_completion_eligible  TEXT,   -- 0/1
    attendance_status        TEXT,   -- 0/1
    tr6                      TEXT,   -- Chairman
    eportal_eligibility      TEXT,   -- Yes/No
    kpi_effective_date       TEXT    -- date or empty
);
```

### Load the CSV

CSV column order matches the table above. Run from `psql` (client-side `\copy`, so
the file path is local):

```sql
\copy staging_tbl_tier FROM 'tbl_tier_202607141721.csv' WITH (FORMAT csv, HEADER true);
```

> A handful of rows are malformed (extra trailing field / stray quotes). If `\copy`
> aborts on one, either delete that line or pre-clean the CSV; the all-TEXT layout
> tolerates everything else.

### Cleaned / typed view

Normalises whitespace, nulls out blanks, and flags bad rows so you can profile
coverage before migrating.

```sql
CREATE OR REPLACE VIEW v_tier_clean AS
SELECT
    NULLIF(BTRIM(tier_row_id), '')                       AS tier_row_id,
    NULLIF(BTRIM(employee_id), '')                       AS employee_id,
    NULLIF(BTRIM(tr1), '')                               AS tr1,
    NULLIF(BTRIM(tr2), '')                               AS tr2,
    NULLIF(BTRIM(tr3), '')                               AS tr3,
    NULLIF(BTRIM(tr4), '')                               AS tr4,
    NULLIF(BTRIM(tr5), '')                               AS tr5,
    NULLIF(BTRIM(tr6), '')                               AS tr6,
    (BTRIM(active) ILIKE 'yes')                          AS is_active,
    NULLIF(BTRIM(level), '')::int                        AS level,
    (BTRIM(kpi_eligible) = '1')                          AS kpi_eligible,
    (BTRIM(job_completion_eligible) = '1')               AS job_completion_eligible,
    (BTRIM(attendance_status) = '1')                     AS attendance_status,
    (BTRIM(eportal_eligibility) ILIKE 'yes')             AS eportal_eligibility,
    NULLIF(BTRIM(created_by), '')                        AS created_by,
    -- record_date can be '0000-00-00 ...' in legacy data — guard the cast
    CASE WHEN BTRIM(record_date) ~ '^\d{4}-\d{2}-\d{2}'
              AND BTRIM(record_date) NOT LIKE '0000-%'
         THEN BTRIM(record_date)::timestamptz END        AS record_date,
    CASE WHEN BTRIM(kpi_effective_date) ~ '^\d{4}-\d{2}-\d{2}'
         THEN BTRIM(kpi_effective_date)::date END        AS kpi_effective_date,
    -- data-quality flags
    (NULLIF(BTRIM(employee_id), '') IS NULL)             AS flag_no_employee_id,
    (BTRIM(tr1) = BTRIM(employee_id))                    AS flag_self_manager
FROM staging_tbl_tier;
```

### Quick profiling queries

```sql
-- total vs active vs unusable
SELECT count(*)                                    AS total_rows,
       count(*) FILTER (WHERE is_active)           AS active_rows,
       count(*) FILTER (WHERE flag_no_employee_id) AS missing_id,
       count(*) FILTER (WHERE flag_self_manager)   AS self_manager
FROM v_tier_clean;

-- ID reconciliation: which legacy IDs match a real employee_number?
SELECT count(*)                       AS active_ids,
       count(e.employee_id)           AS matched
FROM v_tier_clean t
LEFT JOIN employees e ON e.employee_number = t.employee_id
WHERE t.is_active;
```

---

## 2. Target core schema (new position-based model)

Faithful to `models.py`. Peripheral tables (`teams`, `shifts`, `employee_types`) are
minimal stubs so the `employees` FKs resolve — replace with the real DDL (or a
`pg_dump --schema-only`) if you need their full columns.

```sql
-- ---------- identity ----------
CREATE TABLE IF NOT EXISTS people (
    person_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_type   VARCHAR(50)  NOT NULL,
    first_name    VARCHAR(100),
    last_name     VARCHAR(100),
    email         VARCHAR(255) UNIQUE,
    phone_number  VARCHAR(20),
    status        VARCHAR(20)  DEFAULT 'Active',
    auth_user_id  UUID,                       -- FK to auth.users (Supabase) — enforced via migration
    created_at    TIMESTAMPTZ  DEFAULT now(),
    updated_at    TIMESTAMPTZ  DEFAULT now()
    -- demographic columns omitted for the sandbox; add from prod dump if needed
);

-- ---------- org bridges (stubs — replace with real DDL if needed) ----------
CREATE TABLE IF NOT EXISTS departments (
    department_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_name   VARCHAR(255) NOT NULL,
    department_code   VARCHAR(50) UNIQUE,
    cost_center       VARCHAR(50),
    budget_allocation NUMERIC(15,2),
    location_id       UUID,
    -- referenced by hierarchy_migration._backfill_department_heads:
    department_head_id UUID,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
    team_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_name    VARCHAR(255) NOT NULL,
    department_id UUID REFERENCES departments(department_id),
    team_lead_id UUID,          -- optional; used by _backfill_team_leads
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shifts (
    shift_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_name VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS employee_types (
    employee_type_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type_name        VARCHAR(100)
);

-- ---------- employees (manager_id REMOVED — hierarchy is derived) ----------
CREATE TABLE IF NOT EXISTS employees (
    employee_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id         UUID UNIQUE REFERENCES people(person_id) ON DELETE CASCADE,
    employee_number   VARCHAR(50) UNIQUE,   -- ← join key for legacy tier IDs
    position_title    VARCHAR(100),
    employment_type   VARCHAR(50),
    hire_date         TIMESTAMPTZ,
    department_id     UUID REFERENCES departments(department_id),
    team_id           UUID REFERENCES teams(team_id),
    salary            NUMERIC(15,2),
    pay_grade         VARCHAR(20),
    designation       VARCHAR(100),
    function          VARCHAR(100),
    resignation_date  DATE,
    shift_id          UUID REFERENCES shifts(shift_id),
    employee_type_id  UUID REFERENCES employee_types(employee_type_id)
);

-- ---------- RBAC ----------
CREATE TABLE IF NOT EXISTS roles (
    role_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name     VARCHAR(255) NOT NULL,
    role_code     VARCHAR(50),
    role_type     VARCHAR(50),
    description   TEXT,
    department_id UUID REFERENCES departments(department_id) ON DELETE SET NULL,
    team_id       UUID REFERENCES teams(team_id) ON DELETE SET NULL,
    is_active     BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ---------- org tree ----------
CREATE TABLE IF NOT EXISTS org_units (
    org_unit_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_name     VARCHAR(255) NOT NULL,
    unit_code     VARCHAR(50) UNIQUE,
    unit_type     VARCHAR(50) NOT NULL,     -- Group/Company/Department/Function/Subfunction/Team...
    parent_id     UUID REFERENCES org_units(org_unit_id) ON DELETE SET NULL,
    department_id UUID REFERENCES departments(department_id) ON DELETE SET NULL,
    team_id       UUID REFERENCES teams(team_id) ON DELETE SET NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'Active',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    level         INTEGER NOT NULL DEFAULT 0,
    path          TEXT,
    description   TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);
-- NOTE: models.py drops org_units.head_id (head = Position.is_head), but
-- hierarchy_migration._backfill_org_unit_heads still SELECTs ou.head_id. If you run
-- that method, add:  ALTER TABLE org_units ADD COLUMN head_id UUID;  — otherwise skip it.

-- ---------- positions (seats) ----------
CREATE TABLE IF NOT EXISTS positions (
    position_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_unit_id            UUID NOT NULL REFERENCES org_units(org_unit_id) ON DELETE CASCADE,
    title                  VARCHAR(255) NOT NULL,
    role_id                UUID REFERENCES roles(role_id) ON DELETE SET NULL,
    is_head                BOOLEAN NOT NULL DEFAULT false,
    reports_to_position_id UUID REFERENCES positions(position_id) ON DELETE SET NULL,
    max_headcount          INTEGER NOT NULL DEFAULT 1,
    sort_order             INTEGER NOT NULL DEFAULT 0,
    is_active              BOOLEAN NOT NULL DEFAULT true,
    description            TEXT,
    created_at             TIMESTAMPTZ DEFAULT now(),
    updated_at             TIMESTAMPTZ DEFAULT now()
);

-- ---------- position_assignments (who holds a seat, with history) ----------
CREATE TABLE IF NOT EXISTS position_assignments (
    assignment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id     UUID NOT NULL REFERENCES positions(position_id) ON DELETE CASCADE,
    employee_id     UUID NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    is_primary      BOOLEAN NOT NULL DEFAULT true,
    start_date      DATE NOT NULL DEFAULT current_date,
    end_date        DATE,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    assignment_type VARCHAR(30) NOT NULL DEFAULT 'permanent',
    notes           TEXT,
    created_by      UUID REFERENCES people(person_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- helpful indexes for the resolver's hot paths
CREATE INDEX IF NOT EXISTS idx_pa_employee_active
    ON position_assignments (employee_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_pa_position_active
    ON position_assignments (position_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_positions_org_unit ON positions (org_unit_id);
CREATE INDEX IF NOT EXISTS idx_org_units_parent   ON org_units (parent_id);
```

---

## 3. What this DDL does / doesn't cover

| Included                                                  | Not included (bring via `pg_dump --schema-only` or migration files)      |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Legacy staging table + cleaned view                       | `auth.users` schema (Supabase)                                           |
| `people`, `employees` (core cols)                         | Full demographic columns on `people`                                     |
| `departments`/`teams`/`shifts`/`employee_types` **stubs** | Their real column sets                                                   |
| `roles`, `org_units`, `positions`, `position_assignments` | `permissions`, `*_permissions`, `user_roles`, `delegations`, `sod_rules` |
| Hot-path indexes                                          | **Resolver functions** `fn_resolve_*` (needed for replay-diff)           |

**Fastest path to a faithful sandbox:** instead of this hand-written schema, run
`pg_dump "$PROD_URL" --schema-only --no-owner --no-privileges > schema.sql` and apply
that — then add only Section 1 (the staging table) on top. Use the tables above when
you want a **minimal, standalone** target without cloning all of prod.
