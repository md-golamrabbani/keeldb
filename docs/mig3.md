# Backfill `employees.department_id` from `tbl_office_info`

Flow: **CSV → `staging_office_info` → join `employees.employee_number` → match
`departments` → UPDATE `employees.department_id`**

The hard part is **not** the join — it's that `department_name` is free text with
multiple spellings per department. Never `=`-join it raw.

---

## Step 1 — Staging table + load

Both columns `TEXT` — the CSV has trailing-space IDs (`"02-0326                 "`,
`"02-0137 "`), short/malformed IDs (`004`, `0010`, `02-302`, `05-400-99-02`), and two
rows with an **empty** employee_id.

```sql
DROP TABLE IF EXISTS staging_office_info;

CREATE TABLE staging_office_info (
    employee_id     TEXT,
    department_name TEXT
);

\copy staging_office_info FROM 'tbl_office_info_202607151152.csv' WITH (FORMAT csv, HEADER true);
```

✅ `SELECT count(*) AS rows_loaded FROM staging_office_info;`

---

## Step 2 — Clean view

```sql
CREATE OR REPLACE VIEW v_office_clean AS
SELECT NULLIF(BTRIM(employee_id), '')     AS employee_id,
       NULLIF(BTRIM(department_name), '') AS department_name
FROM staging_office_info
WHERE NULLIF(BTRIM(employee_id), '') IS NOT NULL
  AND NULLIF(BTRIM(department_name), '') IS NOT NULL;
```

---

## Step 3 — The normalizer (this is what makes matching work)

Lowercase → `&` becomes `and` → collapse spaces → drop the standalone word `and` →
strip all non-alphanumerics. Word-boundary `\y` protects words like "Standard".

```sql
CREATE OR REPLACE FUNCTION norm_dept(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(lower(btrim(coalesce(t,''))), '&', ' and ', 'g'),
             '\s+', ' ', 'g'),
           '\yand\y', ' ', 'g'),
         '[^a-z0-9]', '', 'g')
$$;
```

What it collapses:

| Raw variants                               | `norm_dept()`     |
| ------------------------------------------ | ----------------- |
| `Marketing & Sales`, `Marketing and Sales` | `marketingsales`  |
| `Finance and Accounts`, `FinanceAccounts`  | `financeaccounts` |
| `IIG & ITC`, `IIG and ITC`                 | `iigitc`          |
| `HR`, `HR `                                | `hr`              |

And correctly keeps apart: `HR` ≠ `HRAdmin`, `Technology` ≠ `Technology and Operations`,
`Supply Chain` ≠ `Admin and Supply Chain`.

---

## Step 4 — Coverage report ⚠️ **do this before any UPDATE**

```sql
-- every distinct CSV name, with headcount, and whether it resolves
SELECT s.department_name,
       count(*) AS employees,
       d.department_name AS matched_department,
       CASE WHEN d.department_id IS NULL THEN '❌ UNMATCHED' ELSE '✅' END AS status
FROM v_office_clean s
LEFT JOIN departments d ON norm_dept(d.department_name) = norm_dept(s.department_name)
GROUP BY s.department_name, d.department_name, d.department_id
ORDER BY status DESC, employees DESC;
```

Every `❌ UNMATCHED` row is a decision: either the department is **missing** from
`departments` (create it) or it's an **alias** of an existing one (Step 5).

---

## Step 5 — Alias table for what normalization can't fix

```sql
CREATE TABLE IF NOT EXISTS department_name_alias (
    raw_name      TEXT PRIMARY KEY,
    department_id UUID REFERENCES departments(department_id) ON DELETE CASCADE,
    note          TEXT
);
```

Fill it from your Step 4 output. Template — **verify each against your real
`departments` rows before running; these are guesses from the CSV, not facts**:

```sql
INSERT INTO department_name_alias (raw_name, department_id, note)
SELECT v.raw_name, d.department_id, v.note
FROM (VALUES
    ('Supply Chain /Procurement Section', 'Supply Chain',        'punctuation variant'),
    ('Admin & Procurement',               'Admin and Supply Chain','abbrev variant'),
    ('Felicity Bigdata II',               'Felicity BigData II Limited', 'short form'),
    ('Fiber@Home Ltd',                    'Fiber@Home Global Ltd','short form — CONFIRM')
) AS v(raw_name, target_name, note)
JOIN departments d ON norm_dept(d.department_name) = norm_dept(v.target_name)
ON CONFLICT (raw_name) DO NOTHING;
```

**Missing departments** — create any that legitimately don't exist yet:

```sql
INSERT INTO departments (department_name, department_code)
SELECT DISTINCT s.department_name,
       'DEP-' || upper(left(norm_dept(s.department_name), 12))
FROM v_office_clean s
WHERE NOT EXISTS (SELECT 1 FROM departments d
                   WHERE norm_dept(d.department_name) = norm_dept(s.department_name))
  AND NOT EXISTS (SELECT 1 FROM department_name_alias a WHERE a.raw_name = s.department_name)
ON CONFLICT (department_code) DO NOTHING;
```

---

## Step 6 — Resolve every row to one department_id

```sql
CREATE OR REPLACE VIEW v_employee_department AS
SELECT s.employee_id,
       e.employee_id  AS emp_uuid,
       COALESCE(d.department_id, a.department_id) AS department_id
FROM v_office_clean s
JOIN employees e ON e.employee_number = s.employee_id
LEFT JOIN departments d ON norm_dept(d.department_name) = norm_dept(s.department_name)
LEFT JOIN department_name_alias a ON a.raw_name = s.department_name;
```

✅ **Preview before writing** (dry run):

```sql
SELECT count(*) AS will_update
FROM v_employee_department WHERE department_id IS NOT NULL;

-- rows that would still be NULL — must be empty (or knowingly accepted)
SELECT * FROM v_employee_department WHERE department_id IS NULL LIMIT 50;
```

---

## Step 7 — Apply

```sql
BEGIN;

UPDATE employees e
   SET department_id = m.department_id
  FROM v_employee_department m
 WHERE e.employee_id = m.emp_uuid
   AND m.department_id IS NOT NULL
   AND e.department_id IS DISTINCT FROM m.department_id;

-- inspect the count, then:
COMMIT;   -- or ROLLBACK;
```

---

## Step 8 — Verify

```sql
-- employees still without a department
SELECT count(*) AS employees_without_department
FROM employees WHERE department_id IS NULL;

-- headcount per department (sanity: no wild outliers)
SELECT d.department_name, count(e.employee_id) AS headcount
FROM departments d
LEFT JOIN employees e ON e.department_id = d.department_id
GROUP BY d.department_name ORDER BY headcount DESC;

-- CSV IDs that matched no employee (typos / legacy / test IDs)
SELECT s.employee_id, s.department_name
FROM v_office_clean s
LEFT JOIN employees e ON e.employee_number = s.employee_id
WHERE e.employee_id IS NULL
ORDER BY s.employee_id;
```

Expect that last query to return the junk IDs: `004`, `006`–`0010`, `0020`–`0028`,
`02-302`, `02-062`, `05-400-99-02`, `01-02599-03`. Decide per row: fix, or drop.

---

## ⚠️ Design flag: not everything here is a "department"

These CSV values are **not** departments in the org sense:

| Value                                                                                             | Really a…          |
| ------------------------------------------------------------------------------------------------- | ------------------ |
| `Fiber@Home Global Ltd`, `Bangladesh Technosity Ltd`, `Felicity IDC Limited`, `Pico Public Cloud` | **Company**        |
| `Barishal Division`, `Cumilla Zone`, `Greater Faridpur Region`                                    | **Region / Zone**  |
| `MD Office`, `Chairman Secretariat`                                                               | Office/secretariat |

If you shove them all into `departments`, your `org_units` tree (from the tier
migration) will have Companies and Regions sitting at `unit_type = 'Department'`.

**Recommendation:** land them in `departments` **now** to unblock `department_id`, but
when you build `org_units`, map these to the correct `unit_type` (`Company`, `Region`)
rather than `Department`. The two migrations meet here — worth deciding before cutover.
