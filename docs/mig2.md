# Splitting `staging_tbl_tier` into the new org model

Run these **in order**. Each step has a ✅ verification query — do not proceed until it
looks right. Everything is idempotent (safe to re-run).

## The core idea

Anyone appearing in `tr1…tr6` is a **head of a unit**. Give each such person one unit
at their **highest observed tier**, then parent units by walking each employee's chain.
Tier → unit type:

| Tier | Meaning      | unit_type     | depth |
| ---- | ------------ | ------------- | ----- |
| tr6  | Chairman     | `Group`       | 0     |
| tr5  | MD           | `Company`     | 1     |
| tr4  | HOD          | `Department`  | 2     |
| tr3  | HOF          | `Function`    | 3     |
| tr2  | Subfunction  | `Subfunction` | 4     |
| tr1  | Line Manager | `Team`        | 5     |

Treating **tr1 supervisors as `Team` heads** (rather than `reports_to` overrides) is what
makes this work cleanly: the tree-walk then resolves LM = tr1, then tr2, tr3 … exactly
reproducing the old chain. No overrides needed.

`unit_code = 'TIER-<legacy_id>'` is the **natural key** that lets every later step join
back to the person who heads that unit.

---

## Step 1 — Unpivot the chains

```sql
-- every (employee, tier_level, head) triple. Levels 1..6 only = "is a head".
CREATE OR REPLACE VIEW v_tier_chain AS
SELECT employee_id, 1 AS tier_level, tr1 AS head_id FROM v_tier_clean WHERE is_active AND tr1 IS NOT NULL
UNION ALL SELECT employee_id, 2, tr2 FROM v_tier_clean WHERE is_active AND tr2 IS NOT NULL
UNION ALL SELECT employee_id, 3, tr3 FROM v_tier_clean WHERE is_active AND tr3 IS NOT NULL
UNION ALL SELECT employee_id, 4, tr4 FROM v_tier_clean WHERE is_active AND tr4 IS NOT NULL
UNION ALL SELECT employee_id, 5, tr5 FROM v_tier_clean WHERE is_active AND tr5 IS NOT NULL
UNION ALL SELECT employee_id, 6, tr6 FROM v_tier_clean WHERE is_active AND tr6 IS NOT NULL;

-- a person's head level = the HIGHEST tier they ever occupy
CREATE OR REPLACE VIEW v_head_level AS
SELECT head_id AS legacy_id, MAX(tier_level) AS head_level
FROM v_tier_chain
GROUP BY head_id;

-- full chain INCLUDING the employee themself at level 0
CREATE OR REPLACE VIEW v_chain_nodes AS
SELECT employee_id, 0 AS tier_level, employee_id AS node_id
  FROM v_tier_clean WHERE is_active AND employee_id IS NOT NULL
UNION ALL
SELECT employee_id, tier_level, head_id FROM v_tier_chain;
```

✅ **Verify** — how many units will you get per level?

```sql
SELECT head_level, count(*) AS units_to_create
FROM v_head_level GROUP BY head_level ORDER BY head_level DESC;
-- expect: level 6 ≈ 1 (chairman), level 5 small (MD), then widening downward
```

---

## Step 2 — Reconcile IDs / bootstrap people

```sql
CREATE OR REPLACE VIEW v_person_universe AS
SELECT DISTINCT employee_id AS legacy_id FROM v_tier_clean WHERE employee_id IS NOT NULL
UNION
SELECT DISTINCT head_id FROM v_tier_chain;
```

✅ **Verify coverage first:**

```sql
SELECT count(*) AS total_ids,
       count(e.employee_id) AS matched,
       count(*) - count(e.employee_id) AS unmatched
FROM v_person_universe u
LEFT JOIN employees e ON e.employee_number = u.legacy_id;
```

**If `employees` is empty in the sandbox**, bootstrap it (skip if you imported real
employee data):

```sql
DO $$
DECLARE r record; pid uuid;
BEGIN
  FOR r IN SELECT legacy_id FROM v_person_universe WHERE legacy_id IS NOT NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM employees WHERE employee_number = r.legacy_id) THEN
      INSERT INTO people (person_type, first_name, last_name)
      VALUES ('Employee', 'Legacy', r.legacy_id)
      RETURNING person_id INTO pid;
      INSERT INTO employees (person_id, employee_number) VALUES (pid, r.legacy_id);
    END IF;
  END LOOP;
END $$;
```

---

## Step 3 — Create the org_units

```sql
INSERT INTO org_units (unit_name, unit_code, unit_type, level, status)
SELECT 'Unit ' || h.legacy_id,
       'TIER-' || h.legacy_id,
       CASE h.head_level
         WHEN 6 THEN 'Group'   WHEN 5 THEN 'Company'     WHEN 4 THEN 'Department'
         WHEN 3 THEN 'Function' WHEN 2 THEN 'Subfunction' WHEN 1 THEN 'Team'
       END,
       6 - h.head_level,          -- depth
       'Active'
FROM v_head_level h
ON CONFLICT (unit_code) DO NOTHING;
```

> `unit_name` is provisional (`Unit 02-0458`) — the tier table has no unit names.
> Rename later from a department/function name lookup.

✅ `SELECT unit_type, count(*) FROM org_units WHERE unit_code LIKE 'TIER-%' GROUP BY 1;`

---

## Step 4 — Derive parent edges (majority vote)

Per employee, keep only head nodes, dedupe (min level wins — this also neutralises
self-references like `tr1 = own id`), order by level, and link each to the next one up.

```sql
CREATE OR REPLACE VIEW v_unit_edges AS
WITH heads AS (   -- chain nodes that are heads, deduped per employee
    SELECT n.employee_id, n.node_id, MIN(n.tier_level) AS lvl
    FROM v_chain_nodes n
    JOIN v_head_level h ON h.legacy_id = n.node_id
    GROUP BY n.employee_id, n.node_id
),
linked AS (
    SELECT employee_id, node_id AS child_head,
           LEAD(node_id) OVER (PARTITION BY employee_id ORDER BY lvl) AS parent_head
    FROM heads
)
SELECT child_head, parent_head, count(*) AS votes
FROM linked
WHERE parent_head IS NOT NULL AND parent_head <> child_head
GROUP BY child_head, parent_head;
```

✅ **Check for ambiguity** (a unit claimed by two different parents):

```sql
SELECT child_head, count(*) AS n_parents, array_agg(parent_head ORDER BY votes DESC)
FROM v_unit_edges GROUP BY child_head HAVING count(*) > 1 ORDER BY 2 DESC;
```

Review these. The apply step below picks the **most-voted** parent.

**Apply:**

```sql
WITH winner AS (
    SELECT DISTINCT ON (child_head) child_head, parent_head
    FROM v_unit_edges ORDER BY child_head, votes DESC, parent_head
)
UPDATE org_units cu
   SET parent_id = pu.org_unit_id
  FROM winner w
  JOIN org_units pu ON pu.unit_code = 'TIER-' || w.parent_head
 WHERE cu.unit_code = 'TIER-' || w.child_head;
```

✅ **Roots + cycle check** (cycles would break the resolver's tree-walk):

```sql
-- roots: should be ~1 (the chairman's Group)
SELECT unit_code, unit_type FROM org_units
WHERE unit_code LIKE 'TIER-%' AND parent_id IS NULL;

-- cycle detection: must return 0 rows
WITH RECURSIVE walk AS (
    SELECT org_unit_id, parent_id, 1 AS depth, ARRAY[org_unit_id] AS seen
      FROM org_units WHERE unit_code LIKE 'TIER-%'
    UNION ALL
    SELECT o.org_unit_id, o.parent_id, w.depth + 1, w.seen || o.org_unit_id
      FROM walk w JOIN org_units o ON o.org_unit_id = w.parent_id
     WHERE NOT o.org_unit_id = ANY(w.seen) AND w.depth < 25
)
SELECT * FROM walk WHERE depth >= 25;
```

---

## Step 5 — Head positions + head assignments

```sql
-- one is_head seat per unit
INSERT INTO positions (org_unit_id, title, is_head, max_headcount, is_active)
SELECT ou.org_unit_id, ou.unit_type || ' Head', true, 1, true
FROM org_units ou
WHERE ou.unit_code LIKE 'TIER-%'
  AND NOT EXISTS (SELECT 1 FROM positions p
                   WHERE p.org_unit_id = ou.org_unit_id AND p.is_head);

-- seat the head = the person the unit is named after
INSERT INTO position_assignments (position_id, employee_id, is_primary, start_date, is_active, assignment_type, notes)
SELECT p.position_id, e.employee_id, true, CURRENT_DATE, true, 'permanent', 'tier migration: head seat'
FROM org_units ou
JOIN positions p ON p.org_unit_id = ou.org_unit_id AND p.is_head
JOIN employees e ON e.employee_number = replace(ou.unit_code, 'TIER-', '')
WHERE ou.unit_code LIKE 'TIER-%'
  AND NOT EXISTS (SELECT 1 FROM position_assignments pa
                   WHERE pa.position_id = p.position_id AND pa.employee_id = e.employee_id);
```

✅ `SELECT count(*) FROM positions WHERE is_head;` should equal your unit count, and
every head seat should have exactly one holder.

---

## Step 6 — Member seats for everyone else

An employee's home unit = the unit of the **lowest** head in their chain (normally tr1's
Team). Employees who are themselves heads already hold their head seat — skip them.

```sql
CREATE OR REPLACE VIEW v_home_unit AS
SELECT DISTINCT ON (c.employee_id) c.employee_id, c.head_id AS home_head
FROM v_tier_chain c
JOIN v_head_level h ON h.legacy_id = c.head_id
ORDER BY c.employee_id, c.tier_level ASC;

-- generic member seat per unit
INSERT INTO positions (org_unit_id, title, is_head, max_headcount, is_active)
SELECT DISTINCT ou.org_unit_id, 'Employee', false, 999, true
FROM v_home_unit hu
JOIN org_units ou ON ou.unit_code = 'TIER-' || hu.home_head
WHERE NOT EXISTS (SELECT 1 FROM positions p
                   WHERE p.org_unit_id = ou.org_unit_id AND p.title = 'Employee' AND NOT p.is_head);

-- assign non-head employees to their home unit's member seat
INSERT INTO position_assignments (position_id, employee_id, is_primary, start_date, is_active, assignment_type, notes)
SELECT p.position_id, e.employee_id, true, CURRENT_DATE, true, 'permanent', 'tier migration: member seat'
FROM v_home_unit hu
JOIN org_units ou ON ou.unit_code = 'TIER-' || hu.home_head
JOIN positions p  ON p.org_unit_id = ou.org_unit_id AND p.title = 'Employee' AND NOT p.is_head
JOIN employees e  ON e.employee_number = hu.employee_id
WHERE NOT EXISTS (SELECT 1 FROM v_head_level h WHERE h.legacy_id = hu.employee_id)  -- skip heads
  AND NOT EXISTS (SELECT 1 FROM position_assignments pa
                   WHERE pa.employee_id = e.employee_id AND pa.is_primary AND pa.is_active);
```

✅ **Nobody left behind:**

```sql
SELECT count(*) AS employees_without_primary_seat
FROM employees e
WHERE EXISTS (SELECT 1 FROM v_tier_clean t WHERE t.employee_id = e.employee_number AND t.is_active)
  AND NOT EXISTS (SELECT 1 FROM position_assignments pa
                   WHERE pa.employee_id = e.employee_id AND pa.is_primary AND pa.is_active);
```

---

## Step 7 — Replay-diff: the acceptance test

**This is the whole point.** Ask the new resolver to rebuild each chain and diff it
against the old tiers. Requires `fn_resolve_approval_chain` (from the migration SQL).

```sql
WITH expected AS (
    SELECT employee_id,
           ARRAY(SELECT DISTINCT ON (tier_level) head_id
                   FROM v_tier_chain c
                  WHERE c.employee_id = t.employee_id
                  ORDER BY tier_level) AS old_chain
    FROM v_tier_clean t WHERE t.is_active
),
actual AS (
    SELECT e.employee_number AS employee_id,
           ARRAY(SELECT emp.employee_number
                   FROM fn_resolve_approval_chain(e.employee_id, 6, CURRENT_DATE) f
                   JOIN employees emp ON emp.employee_id = f.approver_employee_id
                  ORDER BY f.chain_level) AS new_chain
    FROM employees e
)
SELECT x.employee_id, x.old_chain, a.new_chain
FROM expected x JOIN actual a USING (employee_id)
WHERE x.old_chain IS DISTINCT FROM a.new_chain
LIMIT 100;
```

Aim for a small, **explainable** diff (dedup/collapse effects), not zero. Every remaining
row is a data-quality case to adjudicate.

---

## Step 8 — Side attributes (not org structure)

`level`, `kpi_eligible`, `job_completion_eligible`, `attendance_status`,
`eportal_eligibility`, `kpi_effective_date` are **HR/PMS attributes**, not hierarchy.
Migrate them separately, e.g.:

```sql
UPDATE employees e
   SET pay_grade = t.level::text
  FROM v_tier_clean t
 WHERE t.employee_id = e.employee_number AND t.is_active AND t.level IS NOT NULL;
```

The eligibility flags need target columns/side tables — decide their home first.

---

## Rollback (sandbox reset)

```sql
DELETE FROM position_assignments WHERE notes LIKE 'tier migration:%';
DELETE FROM positions WHERE org_unit_id IN (SELECT org_unit_id FROM org_units WHERE unit_code LIKE 'TIER-%');
DELETE FROM org_units WHERE unit_code LIKE 'TIER-%';
```

## Order of operations (cheat sheet)

```
v_tier_chain / v_head_level / v_chain_nodes   →  Step 1
employees bootstrapped + ID coverage checked  →  Step 2
org_units created                             →  Step 3
parent_id set, roots=1, no cycles             →  Step 4
head positions + head assignments             →  Step 5
member positions + member assignments         →  Step 6
replay-diff acceptable                        →  Step 7
side attributes                               →  Step 8
```
