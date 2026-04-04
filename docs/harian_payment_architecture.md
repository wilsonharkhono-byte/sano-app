# SANO — Harian (Daily) Payment Architecture
**Version:** 1.0
**Status:** Design specification — pre-implementation
**Scope:** Worker attendance tracking, daily payment calculation, overtime, and weekly settlement for harian and campuran mandor contracts

---

## 1. Design Principles

### What this system does
The company pays the **mandor**, not individual workers directly. The mandor pays their workers from that sum, taking a margin. SANO tracks individual workers in order to:
1. Validate the mandor's claimed headcount and hours (prevent ghost workers, inflated rates)
2. Calculate how much the company owes the mandor each week
3. Provide an audit trail for disputes

### What the attendance app will do (future)
A separate facial-recognition attendance app will validate worker authenticity. It is currently out of scope. Design SANO to accept data from that app as a **verification layer** — app data can confirm or override manual entry, but does not replace SANO as the source of truth for payment.

### Campuran means week-by-week, not simultaneous
A `campuran` contract does not mean the same week has both borongan and harian components. It means the payment mode can **switch per week**. Week 7 might be harian, week 8 back to borongan. Each `opname_headers` record carries its own `payment_type`.

### No retention on harian
Borongan has a retention holdback (typically 10%). Harian payments are settled in full each week — no retention.

---

## 2. Data Model

### 2.1 `mandor_workers`
Named workers enrolled under a mandor contract.

```sql
CREATE TABLE mandor_workers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worker_name     TEXT NOT NULL,
  skill_level     TEXT NOT NULL
    CHECK (skill_level IN ('wakil_mandor', 'tukang', 'kenek', 'operator', 'lainnya')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- future: attendance_app_worker_id UUID (link to external app)
  UNIQUE (contract_id, worker_name)
);
```

**Design notes:**
- Workers are tied to a contract, not a project directly. If the same person works under two different mandors, they appear in both contracts as separate rows.
- `skill_level` is informational and used for rate defaults but not enforced — the actual rate is in `worker_rates`.
- `attendance_app_worker_id` reserved for future app integration.

---

### 2.2 `worker_rates`
Rate history for each worker. Supports rate changes over time and location-based renegotiation.

```sql
CREATE TABLE worker_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id       UUID NOT NULL REFERENCES mandor_workers(id) ON DELETE CASCADE,
  contract_id     UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  daily_rate      NUMERIC NOT NULL CHECK (daily_rate > 0),
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,  -- NULL means currently active
  notes           TEXT,
  set_by          UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Only one active rate per worker per contract at a time
  CONSTRAINT worker_rates_no_overlap EXCLUDE USING gist (
    worker_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);
```

**Active rate lookup:**
```sql
SELECT daily_rate
FROM worker_rates
WHERE worker_id = $1
  AND effective_from <= $2          -- attendance_date
  AND (effective_to IS NULL OR effective_to > $2)
LIMIT 1;
```

**Excel import:** Admin uploads a file with columns `[Nama Pekerja, Jabatan, Tarif Harian, Berlaku Mulai]`. System upserts into `mandor_workers` + closes existing rate (`effective_to = effective_from - 1`) and inserts new rate row.

---

### 2.3 `mandor_overtime_rules`
Overtime thresholds and rates per contract. One active rule set per contract.

```sql
CREATE TABLE mandor_overtime_rules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id             UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  normal_hours            NUMERIC NOT NULL DEFAULT 7,
    -- net hours per day covered by daily_rate (8am–4pm minus 1hr lunch = 7 hours)
  tier1_threshold_hours   NUMERIC NOT NULL DEFAULT 7,
    -- overtime starts when total hours exceed this (equals normal_hours)
  tier1_hourly_rate       NUMERIC NOT NULL DEFAULT 0,
    -- flat Rp per overtime hour in tier 1
  tier2_threshold_hours   NUMERIC NOT NULL DEFAULT 10,
    -- second tier starts when total hours exceed this
  tier2_hourly_rate       NUMERIC NOT NULL DEFAULT 0,
    -- flat Rp per overtime hour in tier 2
  effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by              UUID REFERENCES profiles(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, effective_from)
);
```

**Example values:**
| Field | Example |
|---|---|
| normal_hours | 7 |
| tier1_threshold_hours | 7 |
| tier1_hourly_rate | Rp 12.500/hr |
| tier2_threshold_hours | 10 |
| tier2_hourly_rate | Rp 18.750/hr |

**Overtime pay formula per worker per day:**
```
total_hours       = normal_hours + overtime_hours_recorded
tier1_hours       = MIN(MAX(total_hours - tier1_threshold, 0), tier2_threshold - tier1_threshold)
tier2_hours       = MAX(total_hours - tier2_threshold, 0)
overtime_pay      = (tier1_hours × tier1_hourly_rate) + (tier2_hours × tier2_hourly_rate)
day_total         = daily_rate + overtime_pay
```

If worker is absent: `day_total = 0`.

---

### 2.4 `worker_attendance_entries`
One row per worker per day. Replaces the old flat `mandor_attendance` table.

```sql
CREATE TABLE worker_attendance_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worker_id           UUID NOT NULL REFERENCES mandor_workers(id) ON DELETE CASCADE,
  attendance_date     DATE NOT NULL,

  -- Presence
  is_present          BOOLEAN NOT NULL DEFAULT true,
  overtime_hours      NUMERIC NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
    -- hours beyond normal_hours threshold; 0 if no overtime

  -- Snapshot of rates at time of entry (frozen for audit)
  daily_rate_snapshot     NUMERIC NOT NULL DEFAULT 0,
  tier1_rate_snapshot     NUMERIC NOT NULL DEFAULT 0,
  tier2_rate_snapshot     NUMERIC NOT NULL DEFAULT 0,
  tier1_threshold_snapshot NUMERIC NOT NULL DEFAULT 7,
  tier2_threshold_snapshot NUMERIC NOT NULL DEFAULT 10,

  -- Computed pay (recalculated on save, frozen at settlement)
  regular_pay         NUMERIC GENERATED ALWAYS AS (
    CASE WHEN is_present THEN daily_rate_snapshot ELSE 0 END
  ) STORED,
  tier1_pay           NUMERIC GENERATED ALWAYS AS (
    CASE WHEN is_present
      THEN LEAST(GREATEST(overtime_hours - 0, 0),
                 tier2_threshold_snapshot - tier1_threshold_snapshot)
           * tier1_rate_snapshot
      ELSE 0
    END
  ) STORED,
  tier2_pay           NUMERIC GENERATED ALWAYS AS (
    CASE WHEN is_present
      THEN GREATEST(overtime_hours - (tier2_threshold_snapshot - tier1_threshold_snapshot), 0)
           * tier2_rate_snapshot
      ELSE 0
    END
  ) STORED,
  day_total           NUMERIC GENERATED ALWAYS AS (
    CASE WHEN is_present
      THEN daily_rate_snapshot
         + LEAST(GREATEST(overtime_hours, 0),
                 tier2_threshold_snapshot - tier1_threshold_snapshot)
           * tier1_rate_snapshot
         + GREATEST(overtime_hours - (tier2_threshold_snapshot - tier1_threshold_snapshot), 0)
           * tier2_rate_snapshot
      ELSE 0
    END
  ) STORED,

  -- Workflow
  status              TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'SUPERVISOR_CONFIRMED', 'ADMIN_OVERRIDDEN', 'SETTLED')),
  work_description    TEXT,

  -- Who did what
  recorded_by         UUID NOT NULL REFERENCES profiles(id),
  supervisor_confirmed_by UUID REFERENCES profiles(id),
  supervisor_confirmed_at TIMESTAMPTZ,
  admin_override_by   UUID REFERENCES profiles(id),
  admin_override_at   TIMESTAMPTZ,
  admin_override_note TEXT,
  settled_in_opname_id UUID REFERENCES opname_headers(id),
  settled_at          TIMESTAMPTZ,

  -- Attendance app integration
  source              TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'attendance_app')),
  app_validated       BOOLEAN NOT NULL DEFAULT false,
  app_validated_at    TIMESTAMPTZ,
  -- Manual entry is locked once app has validated (prevents post-hoc falsification)
  is_locked           BOOLEAN NOT NULL DEFAULT false,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, attendance_date)
);
```

**Design notes:**
- Rate snapshots are frozen at time of entry. If a worker's rate is updated mid-week, existing entries for that week are not retroactively changed.
- `overtime_hours` = hours worked beyond the normal threshold. If normal day = 8 hours and worker left at 6pm, `overtime_hours = 2`.
- Absent workers: either not entered at all (simpler) or entered with `is_present = false` (allows tracking of absence patterns). **Recommend: record absent entries** for workers who were expected but didn't show — this supports the attendance app validation later.
- `is_locked`: once the attendance app validates an entry, manual editing is blocked. Admin override still possible with `admin_override_note`.

---

### 2.5 Changes to `opname_headers`

Add two columns:

```sql
ALTER TABLE opname_headers
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'borongan'
    CHECK (payment_type IN ('borongan', 'harian')),
  ADD COLUMN IF NOT EXISTS harian_total NUMERIC NOT NULL DEFAULT 0;
    -- sum of all worker_attendance_entries.day_total for this opname's week range
```

**Payment waterfall by type:**

| Field | Borongan | Harian |
|---|---|---|
| `gross_total` | SUM of opname_lines cumulative_amount | SUM of worker day_total for week |
| `retention_amount` | gross × retention_pct | **0 always** |
| `net_to_date` | gross − retention | = gross (full amount) |
| `prior_paid` | SUM of prior approved net_to_date | SUM of prior harian weeks net_to_date |
| `kasbon` | Admin-entered or auto-settled | Same — rare but possible |
| `net_this_week` | net_to_date − prior_paid − kasbon | gross − kasbon |
| `harian_total` | 0 | = gross_total (for clarity in reports) |

---

### 2.6 Changes to `mandor_contracts`

`payment_mode` and `daily_rate` columns were added in migration 015. Add them to the TypeScript `MandorContract` interface:

```typescript
export interface MandorContract {
  // ... existing fields ...
  payment_mode: 'borongan' | 'harian' | 'campuran';
  daily_rate: number; // default/fallback rate — individual workers override this
}
```

---

## 3. Workflow by Role

### 3.1 Setup (Estimator / Admin) — done once per contract

```
Estimator creates mandor contract
  └─ Sets payment_mode: harian | campuran | borongan
  └─ Sets retention_pct (0 for harian/campuran)

Admin adds workers to contract
  └─ Manually, or via Excel upload
  └─ Sets skill_level, daily_rate, effective_from

Admin configures overtime rules
  └─ normal_hours, tier1/tier2 thresholds and rates
  └─ Can update per project (re-negotiated each project)
```

### 3.2 Daily recording (Supervisor)

```
Supervisor opens AttendanceScreen
  └─ Selects contract (only harian/campuran contracts shown)
  └─ Selects date (today or yesterday only)
  └─ Sees worker list for contract

For each worker:
  └─ Toggle: present / absent
  └─ If present: enter overtime_hours (0 if none)
  └─ system shows preview: "Rp 150.000 + Rp 25.000 OT = Rp 175.000"

Save → status = DRAFT
```

**Absent workers:** System pre-populates the list with all active workers. Supervisor taps each one. Absent = `is_present = false`, saved with `day_total = 0`. This matters for audit — if a worker is never recorded absent or present on a given day, it raises a flag.

### 3.3 Weekly submission (Supervisor, end of week)

```
Supervisor opens weekly attendance summary (Mon–Sat)
  └─ Reviews all entries for the week
  └─ Confirms total: "12 workers, 6 days, Rp X total"
  └─ Taps "Konfirmasi Minggu Ini"
  └─ All DRAFT entries for that week → SUBMITTED

This triggers notification to Admin/Estimator
```

### 3.4 Admin / Estimator review and override

```
Admin opens harian opname for the week
  └─ Sees breakdown: per worker, per day, hours, pay
  └─ Each entry shows: regular pay + tier1 OT + tier2 OT + total

If dispute on any entry:
  └─ Admin/Estimator taps entry
  └─ Edits overtime_hours
  └─ Enters admin_override_note (required for audit)
  └─ Entry status → ADMIN_OVERRIDDEN (preserves original values)
  └─ Recalculates day_total from new overtime_hours

Admin enters kasbon deduction (rare, if any)
Admin taps "Setujui Pembayaran"
  └─ All SUBMITTED / ADMIN_OVERRIDDEN entries → SETTLED
  └─ settled_in_opname_id = opname_headers.id
  └─ opname_headers.status → APPROVED
```

### 3.5 Campuran week switching

```
When creating opname for a campuran contract:
  └─ Estimator picks payment_type for this week:
     ○ "Borongan" → normal opname lines flow
     ○ "Harian"   → attendance-based flow

The opname header stores payment_type
  └─ Borongan opname: has opname_lines, no attendance settlement
  └─ Harian opname: no opname_lines, settles attendance for date range
```

**Rule:** You cannot create a borongan and harian opname for the same contract in the same week.

---

## 4. Harian Opname Payment Calculation

The DB function `recompute_opname_header_totals` needs a branch for harian:

```sql
IF v_payment_type = 'harian' THEN
  -- Sum all settled/to-be-settled attendance for this opname's week range
  SELECT COALESCE(SUM(wae.day_total), 0)
  INTO v_gross_total
  FROM worker_attendance_entries wae
  WHERE wae.contract_id = v_contract_id
    AND wae.attendance_date BETWEEN v_week_start AND v_week_end
    AND wae.status IN ('SUBMITTED', 'ADMIN_OVERRIDDEN', 'SETTLED');

  v_retention_amount := 0;  -- no retention for harian
  v_net_to_date      := v_gross_total;

  -- prior_paid = sum of net_this_week from prior APPROVED/PAID harian opnames
  -- (borongan prior_paid is separate — they do not cross-contaminate)
  SELECT COALESCE(SUM(net_this_week), 0)
  INTO v_prior_paid
  FROM opname_headers
  WHERE contract_id = v_contract_id
    AND payment_type = 'harian'
    AND week_number < v_week_number
    AND status IN ('APPROVED', 'PAID');

ELSE
  -- existing borongan logic unchanged
END IF;
```

**Prior paid isolation:** Borongan and harian prior_paid calculations are kept separate. A mandor that switches modes mid-project does not have borongan cumulative payments deducted from harian weeks and vice versa. Each mode has its own payment history.

---

## 5. Attendance App Integration Layer

### Current state: verification layer
The attendance app is a separate system. SANO does not depend on it. Manual entry is always possible.

### Integration design (ready for future)

**When app pushes data:**
1. App calls a SANO API endpoint (or Supabase Edge Function) with validated attendance records
2. System matches by `worker_id` (future: `attendance_app_worker_id`) + `attendance_date`
3. If manual entry exists: update `app_validated = true`, `app_validated_at = now()`, `is_locked = true`, `source = 'attendance_app'`
4. If no manual entry: create new entry with `source = 'attendance_app'`, `is_present = true/false` based on app data
5. If app data conflicts with manual entry (e.g., app says absent, manual says present): create conflict flag — do not auto-override, require admin resolution

**Conflict resolution:**
```
worker_attendance_entries → add columns:
  app_conflict        BOOLEAN DEFAULT false,
  app_conflict_reason TEXT,
  app_conflict_resolved_by UUID,
  app_conflict_resolved_at TIMESTAMPTZ
```

**Locking rule:**
Once `is_locked = true`, the UI disables editing the entry. Admin can still override (via `admin_override` which creates audit log and bypasses lock). This prevents the scenario where a supervisor retrospectively changes an attendance record after the app has validated it.

---

## 6. Excel Import for Workers

### File format expected
| Nama Pekerja | Jabatan | Tarif Harian | Berlaku Mulai |
|---|---|---|---|
| Budi Santoso | tukang | 175000 | 2026-04-01 |
| Anto Wijaya | kenek | 130000 | 2026-04-01 |

### Import logic
```
For each row:
  1. Find existing worker: match by (contract_id, worker_name) case-insensitive
  2. If not found: INSERT into mandor_workers
  3. Check current active rate:
     - If same rate: skip (no change)
     - If different rate:
       UPDATE worker_rates SET effective_to = effective_from - 1 (close current)
       INSERT new worker_rates row with new daily_rate + effective_from
  4. Return summary: X inserted, Y rate-updated, Z unchanged
```

### Skill level defaults
If admin uploads a worker without specifying jabatan, system defaults to `lainnya`. Admin can correct in UI.

---

## 7. Reporting

### Weekly per-mandor (sufficient for operations)
```
Mandor: Pak Darto (Beton)
Week: 24 Mar – 29 Mar 2026 (Harian)
─────────────────────────────────────
Worker          Days  OT hrs  Total
Budi (tukang)    6     4      Rp 1.100.000
Anto (kenek)     5     0      Rp   650.000
Slamet (kenek)   6     2      Rp   830.000
─────────────────────────────────────
Gross                          Rp 2.580.000
Kasbon                        -Rp   200.000
NET BAYAR                      Rp 2.380.000
```

### Monthly per-worker (aggregated)
Same data grouped by worker across 4–5 weeks. Easy query from `worker_attendance_entries` with date range filter.

### Principal dashboard
- Total harian cost per project per month
- Breakdown: regular pay vs overtime pay (flag if OT cost > 20% of regular = potential abuse)
- Workers with most overtime (anomaly detection)

---

## 8. Migration from Current `mandor_attendance`

The existing `mandor_attendance` table (flat headcount model) needs to be superseded. Migration path:

1. Keep `mandor_attendance` intact — do not drop it
2. Create new tables (`mandor_workers`, `worker_rates`, `worker_attendance_entries`, `mandor_overtime_rules`)
3. New opnames on harian/campuran contracts use the new tables
4. Old `mandor_attendance` data is read-only historical records
5. `AttendanceScreen.tsx` is refactored to use new tables
6. After stable period (1–2 months), deprecate `mandor_attendance`

---

## 9. Open Questions (to resolve before implementation)

| # | Question | Impact |
|---|---|---|
| 1 | ~~Is the workday exactly 7 net hours (8am–4pm minus 1hr lunch) or 8 hours?~~ **Resolved: 7 hours.** 8am–4pm minus 1hr lunch = 7 net working hours. All OT thresholds use 7. | Resolved |
| 2 | If a worker is absent for part of the day (arrives late, leaves early), is there a half-day rate, or is it binary present/absent? | Medium |
| 3 | Can a worker have overtime on a day they are `is_present = false`? (Should be blocked.) | Low |
| 4 | For campuran contracts: does borongan and harian prior_paid fully isolate, or does the company track cumulative total payment regardless of mode? | High |
| 5 | Who has permission to enroll new workers to a contract — admin only, or estimator too? | Low |
| 6 | Should the system enforce a maximum overtime hours cap per day (e.g., cannot record more than 4 OT hours)? | Medium |

---

## 10. Implementation Order

```
Phase 1 — Data layer (migrations)
  016_mandor_workers.sql
    - mandor_workers table
    - worker_rates table
    - mandor_overtime_rules table
    - worker_attendance_entries table (replaces mandor_attendance)
    - RPC: record_worker_attendance
    - RPC: confirm_weekly_attendance (supervisor)
    - RPC: override_attendance_entry (admin)
    - RPC: settle_worker_attendance_for_opname

  017_opname_harian_extension.sql
    - ADD payment_type to opname_headers
    - ADD harian_total to opname_headers
    - MODIFY recompute_opname_header_totals (branch on payment_type)
    - MODIFY approve_opname (call settle_worker_attendance_for_opname when harian)

Phase 2 — Tools layer (TypeScript)
  tools/workerRoster.ts       — CRUD for mandor_workers, worker_rates, overtime_rules
  tools/workerAttendance.ts   — CRUD for worker_attendance_entries
  tools/excelWorkerImport.ts  — parse Excel, upsert workers + rates

Phase 3 — UI layer
  Extend MandorSetupScreen    — worker roster tab, rate management, overtime rules
  Rewrite AttendanceScreen    — per-worker daily entry with OT, weekly confirmation
  Extend OpnameScreen         — harian opname view (attendance-based waterfall)
  Extend OfficeReportsScreen  — weekly/monthly worker cost reports
```
