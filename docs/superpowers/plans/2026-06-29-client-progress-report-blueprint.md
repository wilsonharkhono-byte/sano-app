# Client Progress Report (Blueprint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate the SANO "Laporan Harian / Mingguan — Blueprint Precision" A4 client report from the Report tab, fed by a new Daily Site Log capture surface in the Progress tab, using a curated-draft model.

**Architecture:** A new Daily Site Log (3 tables) captures narrative site data in the Progress tab. `tools/clientReport.ts` aggregates logs + existing quantitative data into a curated draft; `tools/clientReportHtml.ts` renders the verbatim blueprint HTML/CSS and prints it to PDF on web. Fully separate from the existing `pdf-lib`/`generateReport` pipeline.

**Tech Stack:** TypeScript, React Native (Expo, web-first via Vercel), Supabase (Postgres + RLS), Jest + ts-jest. Space Grotesk font. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-28-client-progress-report-blueprint-design.md`

## Global Constraints

Every task's requirements implicitly include these (verbatim from the spec):

- **A4 fidelity (§1.2):** the rendered HTML MUST be exactly A4 (`@page { size:A4; margin:0 }`, `.sheet` 210mm×297mm) and match `daily_blueprint.pdf` pixel-for-pixel. The template HTML/CSS is **ported verbatim** from `assets/Client Progress Report Template/SANO_Laporan_Harian-Mingguan_Blueprint.html` — **CSS values are NOT re-authored**. Only the screen-only `.toolbar` is removed and placeholders substituted.
- **Truth-correctness (§1.1):** every field is derived from real data or typed by the user; nothing fabricated. On issue, freeze the rendered content as a `snapshot`.
- **Number-free report:** no numeric % renders anywhere. Weekly progress delta is an internal input that backs the qualitative Status label only. Daily reports skip it.
- **Narrative-first:** daily-log highlights are free narrative; `boq_item_id` is optional and never required to save.
- **Separation:** `'client_progress_report'` stays OUT of the `ReportType` union. Do NOT route through `generateReport()` or `exportReportToPdf()`. Do NOT edit `tools/reports.ts`, `tools/pdf.ts`, `tools/pdf-layout.ts`.
- **Migrations:** idempotent (`create table if not exists`, `drop policy if exists`/`create policy`, `do $$` guards); pasted into the Dashboard SQL Editor (remote history is divergent — do not rely on `supabase db push`). RLS enabled on every new table; scope via the existing `is_project_member(project_id)` helper. Test RLS under the authenticated role, not just service role.
- **Roles:** `supervisor | estimator | admin | principal` (no "mandor" profile role). Daily log: supervisor+ ; client report: supervisor/estimator/admin/principal.
- **Confirmed columns:** `projects.name`, `projects.client_name` (nullable). `projects` has NO subtitle column → subtitle is curator-typed.

---

## File Structure

| File | New? | Responsibility |
|---|---|---|
| `supabase/migrations/050_client_progress_report.sql` | new | 3 daily-log tables + `client_progress_reports`, RLS, indexes, updated_at trigger. |
| `tools/dailySiteLogs.ts` | new | Daily-log types + CRUD + `aggregatePeriod`. |
| `tools/__tests__/dailySiteLogs.test.ts` | new | Unit tests for the above. |
| `tools/clientReport.ts` | new | Status mapping, weekly delta, numbering, draft assembly, freeze/issue, audit helper. |
| `tools/__tests__/clientReport.test.ts` | new | Unit tests for the above. |
| `tools/clientReportHtml.ts` | new | `renderClientReportHtml` (pure) + `exportClientReportPdf` (web print). |
| `tools/__tests__/clientReportHtml.test.ts` | new | Fidelity + escaping tests for the render. |
| `workflows/screens/DailyLogScreen.tsx` | new | Daily Site Log form. |
| `workflows/screens/ClientReportBuilderScreen.tsx` | new | Curated-draft editor + export trigger. |
| `workflows/screens/ProgresScreen.tsx` | modify | "Log Harian Hari Ini" card + submodule route + cross-prompt. |
| `workflows/screens/LaporanScreen.tsx` | modify | Export Center row + builder takeover. |

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/050_client_progress_report.sql`

**Interfaces:**
- Produces (tables consumed by later tasks): `daily_site_logs(id, project_id, log_date, weather, crew_total, crew_breakdown, safety_incidents, author_id, created_at, updated_at)`, `daily_log_highlights(id, log_id, area, note, boq_item_id, sort_order)`, `daily_log_photos(id, log_id, storage_path, caption, is_featured, captured_at)`, `client_progress_reports(id, project_id, report_no, revision, kind, period_start, period_end, status_label, weather, crew_total, crew_breakdown, safety_incidents, next_plan, snapshot, issued_at, issued_by, created_at)`.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/050_client_progress_report.sql`:

```sql
-- SANO — Client Progress Report (Blueprint)
-- Daily Site Log capture tables + issued client_progress_reports table.
-- Idempotent: safe to re-run (pasted into the Dashboard SQL Editor).
-- Depends on: 001_core_tables (projects, profiles, project_assignments, is_project_member),
--             002_baseline_tables (boq_items).

-- 1. daily_site_logs ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_site_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_date          DATE NOT NULL,
  weather           TEXT,
  crew_total        INTEGER,
  crew_breakdown    TEXT,
  safety_incidents  INTEGER NOT NULL DEFAULT 0,
  author_id         UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_site_logs_project_date ON daily_site_logs (project_id, log_date);

-- 2. daily_log_highlights ----------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_log_highlights (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id       UUID NOT NULL REFERENCES daily_site_logs(id) ON DELETE CASCADE,
  area         TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  boq_item_id  UUID REFERENCES boq_items(id) ON DELETE SET NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_daily_log_highlights_log ON daily_log_highlights (log_id);

-- 3. daily_log_photos --------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_log_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id        UUID NOT NULL REFERENCES daily_site_logs(id) ON DELETE CASCADE,
  storage_path  TEXT NOT NULL,
  caption       TEXT,
  is_featured   BOOLEAN NOT NULL DEFAULT false,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_log_photos_log ON daily_log_photos (log_id);

-- 4. client_progress_reports -------------------------------------------------
CREATE TABLE IF NOT EXISTS client_progress_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_no        INTEGER NOT NULL,
  revision         INTEGER NOT NULL DEFAULT 1,
  kind             TEXT NOT NULL CHECK (kind IN ('harian','mingguan')),
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  status_label     TEXT,
  weather          TEXT,
  crew_total       INTEGER,
  crew_breakdown   TEXT,
  safety_incidents INTEGER NOT NULL DEFAULT 0,
  next_plan        TEXT,
  snapshot         JSONB,
  issued_at        TIMESTAMPTZ,
  issued_by        UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_progress_reports_project ON client_progress_reports (project_id, report_no);

-- 5. updated_at trigger for daily_site_logs ----------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $fn$
      CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN NEW.updated_at = now(); RETURN NEW; END; $body$;
    $fn$;
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_daily_site_logs_updated ON daily_site_logs;
CREATE TRIGGER trg_daily_site_logs_updated BEFORE UPDATE ON daily_site_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6. RLS ---------------------------------------------------------------------
ALTER TABLE daily_site_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log_highlights    ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log_photos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_progress_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_site_logs_member_read ON daily_site_logs;
CREATE POLICY daily_site_logs_member_read ON daily_site_logs
  FOR SELECT USING (is_project_member(project_id));
DROP POLICY IF EXISTS daily_site_logs_member_write ON daily_site_logs;
CREATE POLICY daily_site_logs_member_write ON daily_site_logs
  FOR ALL USING (is_project_member(project_id)) WITH CHECK (is_project_member(project_id));

DROP POLICY IF EXISTS daily_log_highlights_member ON daily_log_highlights;
CREATE POLICY daily_log_highlights_member ON daily_log_highlights
  FOR ALL
  USING (EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)));

DROP POLICY IF EXISTS daily_log_photos_member ON daily_log_photos;
CREATE POLICY daily_log_photos_member ON daily_log_photos
  FOR ALL
  USING (EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)));

DROP POLICY IF EXISTS client_progress_reports_member_read ON client_progress_reports;
CREATE POLICY client_progress_reports_member_read ON client_progress_reports
  FOR SELECT USING (is_project_member(project_id));
DROP POLICY IF EXISTS client_progress_reports_write ON client_progress_reports;
CREATE POLICY client_progress_reports_write ON client_progress_reports
  FOR ALL USING (is_project_member(project_id)) WITH CHECK (is_project_member(project_id));
```

- [ ] **Step 2: Verify SQL parses locally (dry check)**

Run: `grep -c "CREATE TABLE IF NOT EXISTS" supabase/migrations/050_client_progress_report.sql`
Expected: `4`

- [ ] **Step 3: Apply in the Supabase Dashboard SQL Editor**

Paste the file contents into the Dashboard SQL Editor and run. Expected: "Success. No rows returned."

- [ ] **Step 4: Verify idempotency**

Run the same SQL a second time in the Dashboard. Expected: "Success" again (no errors) — every statement is guarded.

- [ ] **Step 5: Verify tables + RLS exist**

Run in the SQL Editor:
```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename IN ('daily_site_logs','daily_log_highlights','daily_log_photos','client_progress_reports');
```
Expected: 4 rows, `rowsecurity = true` for all.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/050_client_progress_report.sql
git commit -m "feat(db): daily site log + client progress report tables (050)"
```

---

## Task 2: Daily Site Log CRUD (`tools/dailySiteLogs.ts`)

**Files:**
- Create: `tools/dailySiteLogs.ts`
- Test: `tools/__tests__/dailySiteLogs.test.ts`

**Interfaces:**
- Consumes: `supabase` from `tools/supabase`.
- Produces:
  - types `DailyLogHighlight`, `DailyLogPhoto`, `DailySiteLog`, `PeriodAggregate` (shapes below).
  - `getDailyLog(projectId: string, isoDate: string): Promise<DailySiteLog | null>`
  - `upsertDailyLog(input: DailySiteLogInput): Promise<string>` — returns log id; replaces child rows.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/dailySiteLogs.test.ts`:

```typescript
import { getDailyLog, upsertDailyLog } from '../dailySiteLogs';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockSupabase = supabase as jest.Mocked<typeof supabase>;

describe('dailySiteLogs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getDailyLog returns null when no log exists for the date', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);

    const result = await getDailyLog('proj-1', '2026-06-29');

    expect(result).toBeNull();
    expect(mockSupabase.from).toHaveBeenCalledWith('daily_site_logs');
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'proj-1');
    expect(chain.eq).toHaveBeenCalledWith('log_date', '2026-06-29');
  });

  it('getDailyLog assembles the log with its highlights and photos', async () => {
    const logRow = {
      id: 'log-1', project_id: 'proj-1', log_date: '2026-06-29', weather: 'Cerah',
      crew_total: 8, crew_breakdown: '3 tukang', safety_incidents: 0, author_id: 'u-1',
    };
    const logChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: logRow, error: null }),
    };
    const hlChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [{ id: 'h1', log_id: 'log-1', area: 'Tangga', note: 'Finishing', boq_item_id: null, sort_order: 0 }],
        error: null,
      }),
    };
    const phChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [{ id: 'p1', log_id: 'log-1', storage_path: 'daily-log/x.jpg', caption: 'Foto', is_featured: true, captured_at: null }],
        error: null,
      }),
    };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(logChain)   // daily_site_logs
      .mockReturnValueOnce(hlChain)    // daily_log_highlights
      .mockReturnValueOnce(phChain);   // daily_log_photos

    const result = await getDailyLog('proj-1', '2026-06-29');

    expect(result?.id).toBe('log-1');
    expect(result?.highlights).toHaveLength(1);
    expect(result?.highlights[0].area).toBe('Tangga');
    expect(result?.photos[0].is_featured).toBe(true);
  });

  it('upsertDailyLog upserts the log then replaces highlights and photos', async () => {
    const upsertChain = {
      upsert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'log-9' }, error: null }),
    };
    const delChain = { delete: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ error: null }) };
    const insChain = { insert: jest.fn().mockResolvedValue({ error: null }) };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(upsertChain)  // upsert daily_site_logs
      .mockReturnValueOnce(delChain)     // delete highlights
      .mockReturnValueOnce(insChain)     // insert highlights
      .mockReturnValueOnce(delChain)     // delete photos
      .mockReturnValueOnce(insChain);    // insert photos

    const id = await upsertDailyLog({
      project_id: 'proj-1', log_date: '2026-06-29', weather: 'Cerah',
      crew_total: 8, crew_breakdown: '3 tukang', safety_incidents: 0, author_id: 'u-1',
      highlights: [{ area: 'Tangga', note: 'Finishing', boq_item_id: null, sort_order: 0 }],
      photos: [{ storage_path: 'daily-log/x.jpg', caption: 'Foto', is_featured: true, captured_at: null }],
    });

    expect(id).toBe('log-9');
    expect(upsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'proj-1', log_date: '2026-06-29' }),
      { onConflict: 'project_id,log_date' },
    );
    expect(insChain.insert).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tools/__tests__/dailySiteLogs.test.ts`
Expected: FAIL — "Cannot find module '../dailySiteLogs'".

- [ ] **Step 3: Write the implementation**

Create `tools/dailySiteLogs.ts`:

```typescript
// SANO — Daily Site Log
// A once-a-day narrative site diary (weather, crew, highlights, photos) that
// feeds the client progress report. Separate from the quantitative
// progress_entries stream; linked optionally via highlight.boq_item_id.

import { supabase } from './supabase';

export interface DailyLogHighlight {
  id?: string;
  area: string;
  note: string;
  boq_item_id: string | null;
  sort_order: number;
}

export interface DailyLogPhoto {
  id?: string;
  storage_path: string;
  caption: string | null;
  is_featured: boolean;
  captured_at: string | null;
}

export interface DailySiteLog {
  id: string;
  project_id: string;
  log_date: string;              // YYYY-MM-DD
  weather: string | null;
  crew_total: number | null;
  crew_breakdown: string | null;
  safety_incidents: number;
  author_id: string | null;
  highlights: DailyLogHighlight[];
  photos: DailyLogPhoto[];
}

export interface DailySiteLogInput {
  project_id: string;
  log_date: string;
  weather: string | null;
  crew_total: number | null;
  crew_breakdown: string | null;
  safety_incidents: number;
  author_id: string | null;
  highlights: DailyLogHighlight[];
  photos: DailyLogPhoto[];
}

export interface PeriodAggregate {
  highlights: Array<DailyLogHighlight & { log_date: string }>;
  featuredPhotos: Array<DailyLogPhoto & { log_date: string }>;
  weather: string | null;
  crewTotal: number | null;
  crewBreakdown: string | null;
  safetyIncidents: number;
}

export async function getDailyLog(projectId: string, isoDate: string): Promise<DailySiteLog | null> {
  const { data: log, error } = await supabase
    .from('daily_site_logs')
    .select('id, project_id, log_date, weather, crew_total, crew_breakdown, safety_incidents, author_id')
    .eq('project_id', projectId)
    .eq('log_date', isoDate)
    .maybeSingle();
  if (error) throw error;
  if (!log) return null;

  const { data: highlights, error: hlErr } = await supabase
    .from('daily_log_highlights')
    .select('id, log_id, area, note, boq_item_id, sort_order')
    .eq('log_id', log.id)
    .order('sort_order', { ascending: true });
  if (hlErr) throw hlErr;

  const { data: photos, error: phErr } = await supabase
    .from('daily_log_photos')
    .select('id, log_id, storage_path, caption, is_featured, captured_at')
    .eq('log_id', log.id);
  if (phErr) throw phErr;

  return {
    ...log,
    highlights: (highlights ?? []) as DailyLogHighlight[],
    photos: (photos ?? []) as DailyLogPhoto[],
  } as DailySiteLog;
}

export async function upsertDailyLog(input: DailySiteLogInput): Promise<string> {
  const { data: log, error } = await supabase
    .from('daily_site_logs')
    .upsert(
      {
        project_id: input.project_id,
        log_date: input.log_date,
        weather: input.weather,
        crew_total: input.crew_total,
        crew_breakdown: input.crew_breakdown,
        safety_incidents: input.safety_incidents,
        author_id: input.author_id,
      },
      { onConflict: 'project_id,log_date' },
    )
    .select('id')
    .single();
  if (error || !log) throw error ?? new Error('Daily log upsert failed');

  // Replace-then-insert children (idempotent per save).
  await supabase.from('daily_log_highlights').delete().eq('log_id', log.id);
  await supabase.from('daily_log_highlights').insert(
    input.highlights.map((h, i) => ({
      log_id: log.id, area: h.area, note: h.note,
      boq_item_id: h.boq_item_id, sort_order: h.sort_order ?? i,
    })),
  );

  await supabase.from('daily_log_photos').delete().eq('log_id', log.id);
  await supabase.from('daily_log_photos').insert(
    input.photos.map((p) => ({
      log_id: log.id, storage_path: p.storage_path, caption: p.caption,
      is_featured: p.is_featured, captured_at: p.captured_at,
    })),
  );

  return log.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tools/__tests__/dailySiteLogs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/dailySiteLogs.ts tools/__tests__/dailySiteLogs.test.ts
git commit -m "feat: daily site log CRUD (getDailyLog, upsertDailyLog)"
```

---

## Task 3: Period aggregation (`aggregatePeriod`)

**Files:**
- Modify: `tools/dailySiteLogs.ts`
- Test: `tools/__tests__/dailySiteLogs.test.ts` (add cases)

**Interfaces:**
- Produces: `aggregatePeriod(projectId: string, startIso: string, endIso: string): Promise<PeriodAggregate>` — highlights (ordered by log_date then sort_order), featured photos, most-recent weather/crew in range, summed safety incidents.

- [ ] **Step 1: Write the failing test (append to the describe block)**

```typescript
  it('aggregatePeriod merges logs: highlights ordered, featured photos, latest weather, summed safety', async () => {
    const logsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          { id: 'l1', log_date: '2026-06-08', weather: 'Cerah', crew_total: 6, crew_breakdown: 'a', safety_incidents: 0 },
          { id: 'l2', log_date: '2026-06-14', weather: 'Hujan', crew_total: 8, crew_breakdown: 'b', safety_incidents: 1 },
        ],
        error: null,
      }),
    };
    const hlChain = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          { id: 'h2', log_id: 'l2', area: 'Tangga', note: 'n2', boq_item_id: null, sort_order: 0 },
          { id: 'h1', log_id: 'l1', area: 'Listrik', note: 'n1', boq_item_id: null, sort_order: 0 },
        ],
        error: null,
      }),
    };
    const phChain = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [{ id: 'p1', log_id: 'l2', storage_path: 'x.jpg', caption: 'c', is_featured: true, captured_at: null }],
        error: null,
      }),
    };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(logsChain)
      .mockReturnValueOnce(hlChain)
      .mockReturnValueOnce(phChain);

    const agg = await aggregatePeriod('proj-1', '2026-06-08', '2026-06-14');

    expect(agg.weather).toBe('Hujan');           // most recent in range (l2)
    expect(agg.crewTotal).toBe(8);
    expect(agg.safetyIncidents).toBe(1);          // summed
    expect(agg.highlights.map(h => h.area)).toEqual(['Listrik', 'Tangga']); // by log_date asc
    expect(agg.highlights[0].log_date).toBe('2026-06-08');
    expect(agg.featuredPhotos).toHaveLength(1);
  });
```

Add `aggregatePeriod` to the import at the top of the test file:
```typescript
import { getDailyLog, upsertDailyLog, aggregatePeriod } from '../dailySiteLogs';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tools/__tests__/dailySiteLogs.test.ts -t aggregatePeriod`
Expected: FAIL — "aggregatePeriod is not a function".

- [ ] **Step 3: Implement `aggregatePeriod` (append to `tools/dailySiteLogs.ts`)**

```typescript
export async function aggregatePeriod(
  projectId: string,
  startIso: string,
  endIso: string,
): Promise<PeriodAggregate> {
  const { data: logs, error } = await supabase
    .from('daily_site_logs')
    .select('id, log_date, weather, crew_total, crew_breakdown, safety_incidents')
    .eq('project_id', projectId)
    .gte('log_date', startIso)
    .lte('log_date', endIso)
    .order('log_date', { ascending: true });
  if (error) throw error;

  const rows = logs ?? [];
  if (rows.length === 0) {
    return { highlights: [], featuredPhotos: [], weather: null, crewTotal: null, crewBreakdown: null, safetyIncidents: 0 };
  }

  const logIds = rows.map((r: any) => r.id);
  const dateById = new Map<string, string>(rows.map((r: any) => [r.id, r.log_date]));
  const orderIndex = new Map<string, number>(rows.map((r: any, i: number) => [r.id, i])); // by log_date asc
  const latest = rows[rows.length - 1]; // most recent in range

  const { data: highlights, error: hlErr } = await supabase
    .from('daily_log_highlights')
    .select('id, log_id, area, note, boq_item_id, sort_order')
    .in('log_id', logIds)
    .order('sort_order', { ascending: true });
  if (hlErr) throw hlErr;

  const { data: photos, error: phErr } = await supabase
    .from('daily_log_photos')
    .select('id, log_id, storage_path, caption, is_featured, captured_at')
    .in('log_id', logIds)
    .eq('is_featured', true);
  if (phErr) throw phErr;

  const sortedHighlights = (highlights ?? [])
    .map((h: any) => ({ ...h, log_date: dateById.get(h.log_id) ?? '' }))
    .sort((a: any, b: any) => {
      const oa = orderIndex.get(a.log_id) ?? 0;
      const ob = orderIndex.get(b.log_id) ?? 0;
      return oa !== ob ? oa - ob : (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });

  const featuredPhotos = (photos ?? [])
    .map((p: any) => ({ ...p, log_date: dateById.get(p.log_id) ?? '' }))
    .sort((a: any, b: any) => (orderIndex.get(b.log_id) ?? 0) - (orderIndex.get(a.log_id) ?? 0)); // newest first

  return {
    highlights: sortedHighlights,
    featuredPhotos,
    weather: latest.weather ?? null,
    crewTotal: latest.crew_total ?? null,
    crewBreakdown: latest.crew_breakdown ?? null,
    safetyIncidents: rows.reduce((s: number, r: any) => s + (r.safety_incidents ?? 0), 0),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tools/__tests__/dailySiteLogs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/dailySiteLogs.ts tools/__tests__/dailySiteLogs.test.ts
git commit -m "feat: aggregatePeriod for daily site logs"
```

---

## Task 4: Status mapping (`tools/clientReport.ts` — pure functions)

**Files:**
- Create: `tools/clientReport.ts`
- Test: `tools/__tests__/clientReport.test.ts`

**Interfaces:**
- Consumes: `MilestoneStatus` type from `tools/types` (`'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'AHEAD' | 'COMPLETE'`).
- Produces:
  - `mapMilestoneStatusToLabel(status: MilestoneStatus): string`
  - `deriveProjectStatusLabel(statuses: MilestoneStatus[]): string` — worst-of; defaults to `'Sesuai Jadwal'` when empty.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/clientReport.test.ts`:

```typescript
import { mapMilestoneStatusToLabel, deriveProjectStatusLabel } from '../clientReport';

describe('clientReport status mapping', () => {
  it('maps each milestone status to an Indonesian label', () => {
    expect(mapMilestoneStatusToLabel('ON_TRACK')).toBe('Sesuai Jadwal');
    expect(mapMilestoneStatusToLabel('AHEAD')).toBe('Lebih Cepat');
    expect(mapMilestoneStatusToLabel('AT_RISK')).toBe('Perlu Perhatian');
    expect(mapMilestoneStatusToLabel('DELAYED')).toBe('Terlambat');
    expect(mapMilestoneStatusToLabel('COMPLETE')).toBe('Selesai');
  });

  it('deriveProjectStatusLabel returns the worst status across milestones', () => {
    expect(deriveProjectStatusLabel(['ON_TRACK', 'AHEAD'])).toBe('Sesuai Jadwal');
    expect(deriveProjectStatusLabel(['ON_TRACK', 'AT_RISK'])).toBe('Perlu Perhatian');
    expect(deriveProjectStatusLabel(['AT_RISK', 'DELAYED'])).toBe('Terlambat');
  });

  it('deriveProjectStatusLabel defaults to Sesuai Jadwal when empty', () => {
    expect(deriveProjectStatusLabel([])).toBe('Sesuai Jadwal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tools/__tests__/clientReport.test.ts`
Expected: FAIL — "Cannot find module '../clientReport'".

- [ ] **Step 3: Write the implementation**

Create `tools/clientReport.ts`:

```typescript
// SANO — Client Progress Report assembly
// Aggregates the Daily Site Log + existing quantitative data into a curated
// draft, renders numbering, and freezes a snapshot on issue.
// NOTE: 'client_progress_report' is intentionally NOT a ReportType — this path
// never routes through generateReport()/exportReportToPdf().

import { supabase } from './supabase';
import type { MilestoneStatus } from './types';

const STATUS_LABELS: Record<MilestoneStatus, string> = {
  ON_TRACK: 'Sesuai Jadwal',
  AHEAD: 'Lebih Cepat',
  AT_RISK: 'Perlu Perhatian',
  DELAYED: 'Terlambat',
  COMPLETE: 'Selesai',
};

// Worst-first severity for rolling many milestone statuses into one label.
const SEVERITY: MilestoneStatus[] = ['DELAYED', 'AT_RISK', 'ON_TRACK', 'AHEAD', 'COMPLETE'];

export function mapMilestoneStatusToLabel(status: MilestoneStatus): string {
  return STATUS_LABELS[status] ?? 'Sesuai Jadwal';
}

export function deriveProjectStatusLabel(statuses: MilestoneStatus[]): string {
  if (statuses.length === 0) return 'Sesuai Jadwal';
  for (const s of SEVERITY) {
    if (statuses.includes(s)) return mapMilestoneStatusToLabel(s);
  }
  return 'Sesuai Jadwal';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tools/__tests__/clientReport.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/clientReport.ts tools/__tests__/clientReport.test.ts
git commit -m "feat: milestone status -> Indonesian label mapping"
```

---

## Task 5: Weekly progress delta (`installedAsOf`, `computeWeeklyProgressDelta`)

**Files:**
- Modify: `tools/clientReport.ts`
- Test: `tools/__tests__/clientReport.test.ts` (add cases)

**Interfaces:**
- Consumes: `progress_entries(boq_item_id, quantity, created_at)`.
- Produces:
  - `installedAsOf(projectId: string, isoDateEnd: string): Promise<Map<string, number>>` — boq_item_id → summed installed qty for entries with `created_at <= isoDateEnd`.
  - `computeWeeklyProgressDelta(projectId, boqItems, startIso, endIso): Promise<number>` — overall % at end minus overall % at start (0–100, internal-only, never rendered). `boqItems: Array<{ id: string; planned: number }>`.

- [ ] **Step 1: Write the failing test (append)**

```typescript
import { installedAsOf, computeWeeklyProgressDelta } from '../clientReport';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
const mockSupabase = supabase as jest.Mocked<typeof supabase>;

describe('clientReport weekly delta', () => {
  beforeEach(() => jest.clearAllMocks());

  it('installedAsOf sums quantities per boq item up to the cutoff date', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lte: jest.fn().mockResolvedValue({
        data: [
          { boq_item_id: 'a', quantity: 4, created_at: '2026-06-10' },
          { boq_item_id: 'a', quantity: 6, created_at: '2026-06-11' },
          { boq_item_id: 'b', quantity: 2, created_at: '2026-06-12' },
        ],
        error: null,
      }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);

    const map = await installedAsOf('proj-1', '2026-06-14T23:59:59');

    expect(map.get('a')).toBe(10);
    expect(map.get('b')).toBe(2);
    expect(chain.lte).toHaveBeenCalledWith('created_at', '2026-06-14T23:59:59');
  });

  it('computeWeeklyProgressDelta = overall% at end minus overall% at start', async () => {
    // start: a=0/10, b=0/10 -> 0% ; end: a=10/10, b=5/10 -> (100+50)/2 = 75%
    const startChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), lte: jest.fn().mockResolvedValue({ data: [], error: null }) };
    const endChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), lte: jest.fn().mockResolvedValue({
      data: [
        { boq_item_id: 'a', quantity: 10, created_at: '2026-06-13' },
        { boq_item_id: 'b', quantity: 5, created_at: '2026-06-13' },
      ], error: null }) };
    (mockSupabase.from as jest.Mock).mockReturnValueOnce(startChain).mockReturnValueOnce(endChain);

    const delta = await computeWeeklyProgressDelta(
      'proj-1',
      [{ id: 'a', planned: 10 }, { id: 'b', planned: 10 }],
      '2026-06-08', '2026-06-14',
    );

    expect(Math.round(delta)).toBe(75);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tools/__tests__/clientReport.test.ts -t "weekly delta"`
Expected: FAIL — "installedAsOf is not a function".

- [ ] **Step 3: Implement (append to `tools/clientReport.ts`)**

```typescript
export async function installedAsOf(projectId: string, isoDateEnd: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('progress_entries')
    .select('boq_item_id, quantity, created_at')
    .eq('project_id', projectId)
    .lte('created_at', isoDateEnd);
  if (error) throw error;

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(row.boq_item_id, (map.get(row.boq_item_id) ?? 0) + (row.quantity ?? 0));
  }
  return map;
}

function overallProgress(boqItems: Array<{ id: string; planned: number }>, installed: Map<string, number>): number {
  const withPlan = boqItems.filter((b) => b.planned > 0);
  if (withPlan.length === 0) return 0;
  const sum = withPlan.reduce((s, b) => s + Math.min(100, ((installed.get(b.id) ?? 0) / b.planned) * 100), 0);
  return sum / withPlan.length;
}

export async function computeWeeklyProgressDelta(
  projectId: string,
  boqItems: Array<{ id: string; planned: number }>,
  startIso: string,
  endIso: string,
): Promise<number> {
  // "Installed as of the day BEFORE the period" vs "as of period end".
  const [atStart, atEnd] = await Promise.all([
    installedAsOf(projectId, `${startIso}T00:00:00`),
    installedAsOf(projectId, `${endIso}T23:59:59`),
  ]);
  return overallProgress(boqItems, atEnd) - overallProgress(boqItems, atStart);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tools/__tests__/clientReport.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add tools/clientReport.ts tools/__tests__/clientReport.test.ts
git commit -m "feat: internal weekly progress delta (installedAsOf)"
```

---

## Task 6: Report numbering + audit helper

**Files:**
- Modify: `tools/clientReport.ts`
- Test: `tools/__tests__/clientReport.test.ts` (add cases)

**Interfaces:**
- Produces:
  - `assignNextReportNo(projectId: string): Promise<number>` — `max(report_no) + 1` for the project, or `1`.
  - `recordClientProgressReportExport(projectId: string, userId: string, filters: Record<string, unknown>): Promise<void>` — inserts into `report_exports` with `report_type = 'client_progress_report'` (plain string; NOT the ReportType enum).

- [ ] **Step 1: Write the failing test (append)**

```typescript
import { assignNextReportNo, recordClientProgressReportExport } from '../clientReport';

describe('clientReport numbering + audit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('assignNextReportNo returns 1 when the project has no reports', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);
    expect(await assignNextReportNo('proj-1')).toBe(1);
  });

  it('assignNextReportNo returns max+1', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { report_no: 6 }, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);
    expect(await assignNextReportNo('proj-1')).toBe(7);
  });

  it('recordClientProgressReportExport inserts the plain-string report_type', async () => {
    const chain = { insert: jest.fn().mockResolvedValue({ error: null }) };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);
    await recordClientProgressReportExport('proj-1', 'u-1', { kind: 'mingguan' });
    expect(mockSupabase.from).toHaveBeenCalledWith('report_exports');
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'proj-1', generated_by: 'u-1', report_type: 'client_progress_report',
    }));
  });
});
```

> **Confirmed columns:** `report_exports` insert uses `project_id, report_type, filters, file_path, generated_by` (verbatim from `recordReportExport` in `tools/reports.ts:1059-1065`). The impl below mirrors those exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tools/__tests__/clientReport.test.ts -t "numbering"`
Expected: FAIL — "assignNextReportNo is not a function".

- [ ] **Step 3: Implement (append to `tools/clientReport.ts`)**

```typescript
export async function assignNextReportNo(projectId: string): Promise<number> {
  const { data, error } = await supabase
    .from('client_progress_reports')
    .select('report_no')
    .eq('project_id', projectId)
    .order('report_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.report_no ?? 0) + 1;
}

export async function recordClientProgressReportExport(
  projectId: string,
  userId: string,
  filters: Record<string, unknown>,
): Promise<void> {
  // Columns mirror recordReportExport (tools/reports.ts). report_type is a plain
  // string here (NOT the ReportType enum) — this path stays out of that union.
  const { error } = await supabase.from('report_exports').insert({
    project_id: projectId,
    report_type: 'client_progress_report',
    filters,
    file_path: `exports/${projectId}/client_progress_report_${Date.now()}.json`,
    generated_by: userId,
  });
  if (error) throw error;
}
```

> **Concurrency note:** `assignNextReportNo` is `max+1` and not transactional. For this low-frequency, single-issuer action that is acceptable; if two reports are issued in the same second the second insert simply reuses a number (both rows persist — numbering is display metadata, not a unique key).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tools/__tests__/clientReport.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add tools/clientReport.ts tools/__tests__/clientReport.test.ts
git commit -m "feat: client report numbering + audit export helper"
```

---

## Task 7: Draft assembly + issue/freeze

**Files:**
- Modify: `tools/clientReport.ts`
- Test: `tools/__tests__/clientReport.test.ts` (add cases)

**Interfaces:**
- Consumes: `aggregatePeriod` (Task 3), `resolvePhotoUrl` from `tools/storage`, `deriveProjectStatusLabel` (Task 4), `assignNextReportNo` (Task 6), `recordClientProgressReportExport` (Task 6).
- Produces:
  - type `ClientReportDraft` (shape below — consumed by Task 8 render + Task 12 builder).
  - `assembleClientReportDraft(params: AssembleParams): Promise<ClientReportDraft>`
  - `issueClientReport(draft: ClientReportDraft, projectId: string, userId: string): Promise<{ id: string }>` — inserts a `client_progress_reports` row with frozen `snapshot`, sets `issued_at/issued_by`, records the export.

```typescript
// AssembleParams (input to assembleClientReportDraft)
export interface AssembleParams {
  projectId: string;
  kind: 'harian' | 'mingguan';
  periodStart: string;   // YYYY-MM-DD
  periodEnd: string;     // YYYY-MM-DD (== start for harian)
  projectName: string;
  clientName: string | null;
  milestoneStatuses: MilestoneStatus[];
}
```

- [ ] **Step 1: Write the failing test (append)**

```typescript
import { assembleClientReportDraft, issueClientReport } from '../clientReport';

jest.mock('../dailySiteLogs', () => ({ aggregatePeriod: jest.fn() }));
jest.mock('../storage', () => ({ resolvePhotoUrl: jest.fn(async (p: string) => `https://cdn/${p}`) }));
import { aggregatePeriod } from '../dailySiteLogs';

describe('assembleClientReportDraft', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds a draft: updates from highlights, hero = first featured photo, status from milestones', async () => {
    (aggregatePeriod as jest.Mock).mockResolvedValue({
      highlights: [
        { area: 'Tangga', note: 'Finishing', boq_item_id: null, sort_order: 0, log_date: '2026-06-14' },
      ],
      featuredPhotos: [
        { storage_path: 'a.jpg', caption: 'Hero', is_featured: true, captured_at: null, log_date: '2026-06-14' },
        { storage_path: 'b.jpg', caption: 'Thumb', is_featured: true, captured_at: null, log_date: '2026-06-12' },
      ],
      weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang', safetyIncidents: 0,
    });

    const draft = await assembleClientReportDraft({
      projectId: 'proj-1', kind: 'mingguan',
      periodStart: '2026-06-08', periodEnd: '2026-06-14',
      projectName: 'Graha Family T-61', clientName: 'Bpk. Jason Jordy',
      milestoneStatuses: ['ON_TRACK'],
    });

    expect(draft.statusLabel).toBe('Sesuai Jadwal');
    expect(draft.updates).toEqual([{ date: '2026-06-14', area: 'Tangga', note: 'Finishing' }]);
    expect(draft.hero?.url).toBe('https://cdn/a.jpg');
    expect(draft.thumbs).toHaveLength(1);
    expect(draft.thumbs[0].url).toBe('https://cdn/b.jpg');
    expect(draft.weather).toBe('Cerah');
    expect(draft.subtitle).toBe(''); // curator-typed, blank by default
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tools/__tests__/clientReport.test.ts -t assembleClientReportDraft`
Expected: FAIL — "assembleClientReportDraft is not a function".

- [ ] **Step 3: Implement (append to `tools/clientReport.ts`)**

Add the import at the top of the file:
```typescript
import { aggregatePeriod } from './dailySiteLogs';
import { resolvePhotoUrl } from './storage';
```

Then append:
```typescript
export interface ClientReportUpdate { date: string; area: string; note: string; }
export interface ClientReportPhoto { url: string; caption: string; date: string; }

export interface ClientReportDraft {
  kind: 'harian' | 'mingguan';
  reportNo: number;
  periodStart: string;
  periodEnd: string;
  projectName: string;
  clientName: string | null;
  subtitle: string;              // curator-typed (no projects column)
  statusLabel: string;
  weather: string | null;
  crewTotal: number | null;
  crewBreakdown: string | null;
  safetyIncidents: number;
  nextPlan: string;              // curator-typed
  updates: ClientReportUpdate[];
  hero: ClientReportPhoto | null;
  thumbs: ClientReportPhoto[];
}

function fmtCaptionDate(iso: string): string {
  // "2026-06-14" -> "14 Jun" (Indonesian short month)
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const [, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return `${d} ${months[(m ?? 1) - 1]}`;
}

export async function assembleClientReportDraft(params: AssembleParams): Promise<ClientReportDraft> {
  const agg = await aggregatePeriod(params.projectId, params.periodStart, params.periodEnd);
  const reportNo = await assignNextReportNo(params.projectId);

  const photos = await Promise.all(
    agg.featuredPhotos.map(async (p) => ({
      url: await resolvePhotoUrl(p.storage_path),
      caption: p.caption ?? '',
      date: fmtCaptionDate(p.log_date),
    })),
  );

  return {
    kind: params.kind,
    reportNo,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    projectName: params.projectName,
    clientName: params.clientName,
    subtitle: '',
    statusLabel: deriveProjectStatusLabel(params.milestoneStatuses),
    weather: agg.weather,
    crewTotal: agg.crewTotal,
    crewBreakdown: agg.crewBreakdown,
    safetyIncidents: agg.safetyIncidents,
    nextPlan: '',
    updates: agg.highlights.map((h) => ({ date: fmtCaptionDate(h.log_date), area: h.area, note: h.note })),
    hero: photos.length > 0 ? photos[0] : null,
    thumbs: photos.slice(1),
  };
}

export async function issueClientReport(
  draft: ClientReportDraft,
  projectId: string,
  userId: string,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('client_progress_reports')
    .insert({
      project_id: projectId,
      report_no: draft.reportNo,
      kind: draft.kind,
      period_start: draft.periodStart,
      period_end: draft.periodEnd,
      status_label: draft.statusLabel,
      weather: draft.weather,
      crew_total: draft.crewTotal,
      crew_breakdown: draft.crewBreakdown,
      safety_incidents: draft.safetyIncidents,
      next_plan: draft.nextPlan,
      snapshot: draft,                       // frozen rendered content
      issued_at: new Date().toISOString(),
      issued_by: userId,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Client report issue failed');

  await recordClientProgressReportExport(projectId, userId, { kind: draft.kind, report_no: draft.reportNo });
  return { id: data.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tools/__tests__/clientReport.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add tools/clientReport.ts tools/__tests__/clientReport.test.ts
git commit -m "feat: assemble + issue client report draft (frozen snapshot)"
```

---

## Task 8: Blueprint HTML render (`renderClientReportHtml`) — fidelity-critical

**Files:**
- Create: `tools/clientReportHtml.ts`
- Test: `tools/__tests__/clientReportHtml.test.ts`

**Interfaces:**
- Consumes: `ClientReportDraft` (Task 7).
- Produces: `renderClientReportHtml(draft: ClientReportDraft): string` — full self-contained A4 HTML, verbatim blueprint CSS, no `.toolbar`, HTML-escaped data.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/clientReportHtml.test.ts`:

```typescript
import { renderClientReportHtml } from '../clientReportHtml';
import type { ClientReportDraft } from '../clientReport';

const draft: ClientReportDraft = {
  kind: 'mingguan', reportNo: 7, periodStart: '2026-06-08', periodEnd: '2026-06-14',
  projectName: 'Graha Family T-61', clientName: 'Bpk. Jason Jordy', subtitle: 'Finishing Interior',
  statusLabel: 'Sesuai Jadwal', weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang · 2 kenek',
  safetyIncidents: 0, nextPlan: 'Penyelesaian railing tangga.',
  updates: [{ date: '14 Jun', area: 'Tangga', note: 'Finishing anak tangga <berjalan>' }],
  hero: { url: 'https://cdn/a.jpg', caption: 'Kondisi lapangan', date: '14 Jun' },
  thumbs: [{ url: 'https://cdn/b.jpg', caption: 'Mock-up', date: '12 Jun' }],
};

describe('renderClientReportHtml', () => {
  const html = renderClientReportHtml(draft);

  it('is exactly A4 and single-sheet', () => {
    expect(html).toContain('size:A4');
    expect(html).toContain('210mm');
    expect(html).toContain('297mm');
  });

  it('strips the screen-only toolbar', () => {
    expect(html).not.toContain('class="toolbar"');
    expect(html).not.toContain('window.print()'); // the toolbar button is gone
  });

  it('injects the report data', () => {
    expect(html).toContain('Graha Family T-61');
    expect(html).toContain('Bpk. Jason Jordy');
    expect(html).toContain('Finishing Interior');
    expect(html).toContain('Sesuai Jadwal');
    expect(html).toContain('Penyelesaian railing tangga.');
    expect(html).toContain('Laporan #07');
    expect(html).toContain('Tangga');
    expect(html).toContain('https://cdn/a.jpg');
  });

  it('sets the kicker by kind', () => {
    expect(html).toContain('Laporan Mingguan');
    expect(renderClientReportHtml({ ...draft, kind: 'harian' })).toContain('Laporan Harian');
  });

  it('HTML-escapes user text to prevent broken markup', () => {
    expect(html).toContain('Finishing anak tangga &lt;berjalan&gt;');
    expect(html).not.toContain('<berjalan>');
  });

  it('renders NO numeric percentage', () => {
    expect(html).not.toMatch(/\d+%/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tools/__tests__/clientReportHtml.test.ts`
Expected: FAIL — "Cannot find module '../clientReportHtml'".

- [ ] **Step 3: Implement the render**

Create `tools/clientReportHtml.ts`. **Copy the entire `<style>…</style>` block VERBATIM** from `assets/Client Progress Report Template/SANO_Laporan_Harian-Mingguan_Blueprint.html` (lines 10–149) into the `BLUEPRINT_CSS` template literal — do not retype or "improve" any CSS value (Global Constraint: verbatim port). Then build the body from the draft:

```typescript
// SANO — Client Progress Report HTML render
// Ports the "Blueprint Precision" template VERBATIM (assets/Client Progress
// Report Template/SANO_Laporan_Harian-Mingguan_Blueprint.html). Only the
// screen-only .toolbar is removed and placeholders are substituted. CSS values
// are NOT re-authored (spec §1.2 fidelity contract).

import { Platform } from 'react-native';
import type { ClientReportDraft } from './clientReport';

function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// VERBATIM from the blueprint HTML <style> block (lines 11–148). Do not edit values.
const BLUEPRINT_CSS = `
  /* PASTE lines 11–148 of SANO_Laporan_Harian-Mingguan_Blueprint.html here,
     unchanged. Includes :root tokens, .sheet {width:210mm;min-height:297mm},
     the corner marks, .strip, sections, and the @media print { @page{size:A4;
     margin:0} } block. */
`;

function fmtPeriodLong(kind: string, start: string, end: string): string {
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const p = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
  const a = p(start), b = p(end);
  if (kind === 'harian' || start === end) return `${a.d} ${months[a.m - 1]} ${a.y}`;
  return `${a.d} – ${b.d} ${months[b.m - 1]} ${b.y}`;
}

function fmtPeriodShort(kind: string, start: string, end: string): string {
  const months = ['Jan','Feb','Mar','Apr','Jun','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const p = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
  const a = p(start), b = p(end);
  if (kind === 'harian' || start === end) return `${a.d} ${months[a.m - 1]} ${a.y}`;
  return `${a.d}–${b.d} ${months[b.m - 1]} ${b.y}`;
}

export function renderClientReportHtml(draft: ClientReportDraft): string {
  const kicker = draft.kind === 'harian' ? 'Laporan Harian' : 'Laporan Mingguan';
  const periodeLong = fmtPeriodLong(draft.kind, draft.periodStart, draft.periodEnd);
  const periodeShort = fmtPeriodShort(draft.kind, draft.periodStart, draft.periodEnd);
  const reportTag = `Laporan #${String(draft.reportNo).padStart(2, '0')}`;

  const crewCell = draft.crewTotal != null
    ? `<div class="val">${esc(draft.crewTotal)} orang</div>${draft.crewBreakdown ? `<div class="crew">${esc(draft.crewBreakdown)}</div>` : ''}`
    : `<div class="val">—</div>`;

  const updateRows = draft.updates.map((u) => `
      <div class="row"><span class="date">${esc(u.date)}</span><span class="area">${esc(u.area)}</span><span class="note">${esc(u.note)}</span></div>`).join('');

  const hero = draft.hero
    ? `<div class="hero">
        <div class="ph" style="background-image:url('${esc(draft.hero.url)}');background-size:cover;background-position:center;height:50mm;"></div>
        <div class="cap"><span class="d">${esc(draft.hero.date)}</span><span>${esc(draft.hero.caption)}</span></div>
      </div>`
    : '';

  const thumbs = draft.thumbs.length
    ? `<div class="thumbs">${draft.thumbs.map((t) => `
        <figure><div class="ph" style="background-image:url('${esc(t.url)}');background-size:cover;background-position:center;height:26mm;"></div><figcaption><span class="d">${esc(t.date)}</span> · ${esc(t.caption)}</figcaption></figure>`).join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SANO · ${esc(draft.projectName)} — ${esc(reportTag)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
<style>${BLUEPRINT_CSS}</style></head>
<body>
  <div class="sheet">
    <span class="mark tl"></span><span class="mark tr"></span><span class="mark bl"></span><span class="mark br"></span>
    <div class="top">
      <div class="brand"><span class="logo">SANO</span><span class="tick"></span></div>
      <div class="hdrmeta">Konfidensial<br><b>${esc(reportTag)}</b><br><span>${esc(periodeShort)}</span></div>
    </div>
    <div class="kicker">${esc(kicker)}</div>
    <h1>${esc(draft.projectName)}</h1>
    <div class="subtitle">${esc(draft.subtitle)}</div>
    <div class="strip">
      <div class="cell"><div class="lab">Klien</div><div class="val">${esc(draft.clientName ?? '—')}</div></div>
      <div class="cell"><div class="lab">Periode</div><div class="val">${esc(periodeLong)}</div></div>
      <div class="cell"><div class="lab">Cuaca</div><div class="val">${esc(draft.weather ?? '—')}</div></div>
      <div class="cell"><div class="lab">Tenaga Kerja</div>${crewCell}</div>
      <div class="cell"><div class="lab">Status</div><div class="val accent">${esc(draft.statusLabel)}</div></div>
    </div>
    <section>
      <div class="sec-head"><span class="no">01</span><h2>Update Lapangan</h2></div>
      <div class="updates">${updateRows}</div>
    </section>
    <section>
      <div class="sec-head"><span class="no">02</span><h2>Dokumentasi Lapangan</h2></div>
      ${hero}
      ${thumbs}
    </section>
    <div class="closing">
      <div class="plan">
        <div class="body"><span class="no">03</span><h2>Rencana Periode Berikutnya</h2><p>${esc(draft.nextPlan)}</p></div>
        <div class="safety"><div class="lab">Keselamatan</div><div class="num">${esc(draft.safetyIncidents)} Insiden</div><div class="sub">Lingkungan Aman</div></div>
      </div>
      <div class="runfoot">
        <span>WHAstudio © 2026 · Konfidensial</span>
        <span>${esc(draft.projectName)} · ${esc(reportTag)}</span>
        <span>Hal. 1 / 1</span>
      </div>
      <div class="dimline">A4 · 210 × 297 mm</div>
    </div>
  </div>
</body></html>`;
}
```

> **Fidelity note:** the hero/thumb placeholders in the blueprint are `.ph` divs; here they become the SAME `.ph` divs with a `background-image`, so the black caption bar `.cap` and captions render identically. Keep the `height` values (50mm hero / 26mm thumb) matching the blueprint's `.hero .ph` / `figure .ph` rules.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tools/__tests__/clientReportHtml.test.ts`
Expected: PASS (6 tests). If the "NO numeric percentage" test fails, check that no injected data contains `%` (it shouldn't; the template has no % field).

- [ ] **Step 5: Commit**

```bash
git add tools/clientReportHtml.ts tools/__tests__/clientReportHtml.test.ts
git commit -m "feat: render Blueprint Precision client report HTML (A4, verbatim CSS)"
```

---

## Task 9: Print-to-PDF export (`exportClientReportPdf`)

**Files:**
- Modify: `tools/clientReportHtml.ts`

**Interfaces:**
- Produces: `exportClientReportPdf(draft: ClientReportDraft): Promise<void>` — web: opens a new window, writes the HTML, waits for fonts, calls `print()`. Native: throws a clear "not supported" error (MVP is web-only).

- [ ] **Step 1: Implement (append to `tools/clientReportHtml.ts`)**

```typescript
export async function exportClientReportPdf(draft: ClientReportDraft): Promise<void> {
  if (Platform.OS !== 'web') {
    throw new Error('Export PDF laporan klien hanya tersedia di versi web untuk saat ini.');
  }
  const html = renderClientReportHtml(draft);
  const win = window.open('', '_blank');
  if (!win) throw new Error('Popup diblokir. Izinkan popup untuk mencetak laporan.');
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Fidelity safeguard: wait for Space Grotesk before printing (spec §1.2).
  try {
    // @ts-ignore - document.fonts exists in browsers
    if (win.document.fonts?.ready) await win.document.fonts.ready;
  } catch { /* ignore font API gaps */ }
  win.focus();
  win.print();
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep clientReportHtml || echo "clean"`
Expected: `clean` (no type errors in this file).

- [ ] **Step 3: Manual verification (web)**

You will verify this end-to-end after Task 12 wires it to the builder. For now confirm it compiles.

- [ ] **Step 4: Commit**

```bash
git add tools/clientReportHtml.ts
git commit -m "feat: web print-to-PDF for client report (fonts-ready gated)"
```

---

## Task 10: Daily Site Log form + Progress-tab entry

**Files:**
- Create: `workflows/screens/DailyLogScreen.tsx`
- Modify: `workflows/screens/ProgresScreen.tsx`

**Interfaces:**
- Consumes: `useProject` (`project`, `profile`, `boqItems`, `refresh`), `getDailyLog`/`upsertDailyLog` (Task 2), `PhotoGalleryField`, `Card`, `SelectSheet`, `pickAndUploadPhoto`, `useToast`, theme, `buildWorkGroups`.
- Produces: `DailyLogScreen` default export with props `{ onBack: () => void; initialDate?: string }`.

- [ ] **Step 1: Create `workflows/screens/DailyLogScreen.tsx`**

```tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import SelectSheet from '../components/SelectSheet';
import PhotoGalleryField from '../components/PhotoGalleryField';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { pickAndUploadPhoto } from '../../tools/storage';
import { sanitizeText } from '../../tools/validation';
import { buildWorkGroups } from '../../tools/boqWorkGroups';
import { getDailyLog, upsertDailyLog, type DailyLogHighlight, type DailyLogPhoto } from '../../tools/dailySiteLogs';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DailyLogScreen({ onBack, initialDate }: { onBack: () => void; initialDate?: string }) {
  const { project, profile, boqItems, refresh } = useProject();
  const { show: toast } = useToast();

  const [logDate] = useState(initialDate ?? todayIso());
  const [weather, setWeather] = useState('');
  const [crewTotal, setCrewTotal] = useState('');
  const [crewBreakdown, setCrewBreakdown] = useState('');
  const [safety, setSafety] = useState('0');
  const [highlights, setHighlights] = useState<DailyLogHighlight[]>([{ area: '', note: '', boq_item_id: null, sort_order: 0 }]);
  const [photos, setPhotos] = useState<DailyLogPhoto[]>([]);
  const [saving, setSaving] = useState(false);

  const boqOptions = useMemo(() => {
    // Flat option list; label = "code — label". Optional link, so include a blank.
    return [{ value: '', label: '(Tanpa item BoQ)' }, ...boqItems.map((b) => ({ value: b.id, code: b.code, label: b.label }))];
  }, [boqItems]);

  const loadExisting = useCallback(async () => {
    if (!project) return;
    const existing = await getDailyLog(project.id, logDate);
    if (existing) {
      setWeather(existing.weather ?? '');
      setCrewTotal(existing.crew_total != null ? String(existing.crew_total) : '');
      setCrewBreakdown(existing.crew_breakdown ?? '');
      setSafety(String(existing.safety_incidents ?? 0));
      setHighlights(existing.highlights.length ? existing.highlights : [{ area: '', note: '', boq_item_id: null, sort_order: 0 }]);
      setPhotos(existing.photos);
    }
  }, [project, logDate]);

  useEffect(() => { loadExisting(); }, [loadExisting]);

  const updateHighlight = (i: number, patch: Partial<DailyLogHighlight>) =>
    setHighlights((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  const addHighlight = () => setHighlights((prev) => [...prev, { area: '', note: '', boq_item_id: null, sort_order: prev.length }]);
  const removeHighlight = (i: number) => setHighlights((prev) => prev.filter((_, idx) => idx !== i));

  const addPhoto = async () => {
    if (!project) return;
    const path = await pickAndUploadPhoto(`daily-log/${project.id}`);
    if (!path) return;
    setPhotos((prev) => [...prev, { storage_path: path, caption: '', is_featured: true, captured_at: new Date().toISOString() }]);
  };
  const removePhoto = (i: number) => setPhotos((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!project || !profile) return;
    setSaving(true);
    try {
      await upsertDailyLog({
        project_id: project.id,
        log_date: logDate,
        weather: weather ? sanitizeText(weather) : null,
        crew_total: crewTotal ? parseInt(crewTotal, 10) : null,
        crew_breakdown: crewBreakdown ? sanitizeText(crewBreakdown) : null,
        safety_incidents: parseInt(safety || '0', 10),
        author_id: profile.id,
        highlights: highlights
          .filter((h) => h.area.trim() || h.note.trim())
          .map((h, i) => ({ ...h, area: sanitizeText(h.area), note: sanitizeText(h.note), sort_order: i })),
        photos,
      });
      toast('Log harian disimpan', 'ok');
      await refresh();
      onBack();
    } catch (err: any) {
      toast(err.message ?? 'Gagal menyimpan log', 'critical');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={onBack} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color={COLORS.textSec} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>
        <Text style={styles.head}>Log Harian — {logDate}</Text>

        <Card title="Kondisi Hari Ini">
          <Text style={styles.label}>Cuaca</Text>
          <TextInput style={styles.input} value={weather} onChangeText={setWeather} placeholder="Cerah / Hujan / Berawan" />
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Tenaga Kerja</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={crewTotal} onChangeText={setCrewTotal} placeholder="8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Insiden K3</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={safety} onChangeText={setSafety} placeholder="0" />
            </View>
          </View>
          <Text style={styles.label}>Rincian Tenaga Kerja</Text>
          <TextInput style={styles.input} value={crewBreakdown} onChangeText={setCrewBreakdown} placeholder="3 tukang · 2 kenek · 1 mandor" />
        </Card>

        <Card title="Update Lapangan" subtitle="Catatan progres naratif. Kaitkan ke item BoQ bila relevan (opsional).">
          {highlights.map((h, i) => (
            <View key={i} style={styles.hlBlock}>
              <View style={styles.hlHead}>
                <Text style={styles.hlNum}>#{i + 1}</Text>
                {highlights.length > 1 && (
                  <TouchableOpacity onPress={() => removeHighlight(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle-outline" size={20} color={COLORS.critical} />
                  </TouchableOpacity>
                )}
              </View>
              <TextInput style={styles.input} value={h.area} onChangeText={(v) => updateHighlight(i, { area: v })} placeholder="Area (mis. Tangga)" />
              <TextInput style={[styles.input, styles.textarea]} value={h.note} onChangeText={(v) => updateHighlight(i, { note: v })} multiline placeholder="Catatan progres..." />
              <Text style={styles.linkLabel}>Kaitkan item BoQ (opsional)</Text>
              <SelectSheet
                value={h.boq_item_id ?? ''}
                options={boqOptions}
                onChange={(v) => updateHighlight(i, { boq_item_id: v || null })}
                placeholder="(Tanpa item BoQ)"
                title="Pilih item BoQ"
              />
            </View>
          ))}
          <TouchableOpacity style={styles.addRow} onPress={addHighlight}>
            <Ionicons name="add" size={16} color={COLORS.primary} />
            <Text style={styles.addText}>Tambah update</Text>
          </TouchableOpacity>
        </Card>

        <Card title="Dokumentasi" subtitle="Foto yang ditandai akan muncul di laporan klien.">
          <PhotoGalleryField
            photoPaths={photos.map((p) => p.storage_path)}
            onAdd={addPhoto}
            onReplace={() => addPhoto()}
            onRemove={removePhoto}
            emptyLabel="Tambah Foto Lapangan"
            helperText="Foto kondisi lapangan, progres, atau material."
          />
        </Card>

        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
          <Text style={styles.saveText}>{saving ? 'Menyimpan...' : 'Simpan Log Harian'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxl },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
  head: { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text, marginBottom: SPACE.md },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: SPACE.xs + 2, marginTop: SPACE.md },
  linkLabel: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, marginBottom: SPACE.xs + 2, marginTop: SPACE.md },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text },
  textarea: { minHeight: 70, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: SPACE.md - 2 },
  hlBlock: { borderBottomWidth: 1, borderBottomColor: COLORS.borderSub, paddingBottom: SPACE.md, marginBottom: SPACE.sm },
  hlHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACE.sm },
  hlNum: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.accent, letterSpacing: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingVertical: SPACE.sm, marginTop: SPACE.xs },
  addText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center', marginTop: SPACE.md },
  saveText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
});
```

- [ ] **Step 2: Wire into ProgresScreen — add the submodule + card**

In `workflows/screens/ProgresScreen.tsx`:

(a) Add import near the other screen imports:
```tsx
import DailyLogScreen from './DailyLogScreen';
import { getDailyLog } from '../../tools/dailySiteLogs';
```

(b) Extend the `SubModule` union (line ~23):
```tsx
type SubModule = 'home' | 'progress' | 'perubahan' | 'daily-log';
```

(c) Add the takeover near the existing `if (activeModule === 'perubahan')` block:
```tsx
if (activeModule === 'daily-log') {
  return <DailyLogScreen onBack={() => setActiveModule('home')} />;
}
```

(d) Add a "Log Harian Hari Ini" card at the TOP of the `home` submodule's content (before the recent-progress list). Add state + effect near the other home state:
```tsx
const [todayLogExists, setTodayLogExists] = useState<boolean | null>(null);
useEffect(() => {
  if (activeModule !== 'home' || !project) return;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  getDailyLog(project.id, iso).then((l) => setTodayLogExists(!!l)).catch(() => setTodayLogExists(null));
}, [activeModule, project]);
```

And render the card (uses the existing `Card` import; place it as the first child in the home view):
```tsx
<Card title="Log Harian Hari Ini" subtitle="Catatan lapangan yang mengisi laporan progres klien.">
  <TouchableOpacity
    style={{ backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center' }}
    onPress={() => setActiveModule('daily-log')}
  >
    <Text style={{ color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' }}>
      {todayLogExists ? 'Edit Log Hari Ini' : '+ Catat Log Harian'}
    </Text>
  </TouchableOpacity>
</Card>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "DailyLogScreen|ProgresScreen" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Manual verification**

Run the web app: `npm run web` (or the project's start command). In the Progress tab home, tap **+ Catat Log Harian**, fill weather/crew/one highlight/a photo, Save. Re-open — fields persist (upsert by date). Confirm the card now shows **Edit Log Hari Ini**.

- [ ] **Step 5: Commit**

```bash
git add workflows/screens/DailyLogScreen.tsx workflows/screens/ProgresScreen.tsx
git commit -m "feat: daily site log form + Progress-tab entry card"
```

---

## Task 11: Cross-prompt (progress entry → highlight)

**Files:**
- Modify: `workflows/screens/ProgresScreen.tsx`

**Interfaces:**
- Consumes: `getDailyLog`/`upsertDailyLog` (Task 2), the existing progress-submit handler.

- [ ] **Step 1: After a successful progress-entry insert, offer to add a highlight**

Find the progress submit handler (where `supabase.from('progress_entries').insert(...)` succeeds — around line 183). Immediately after the success toast, add a confirm-and-append. Add this helper inside the component:

```tsx
const offerAddToDailyLog = useCallback(async (boqId: string, note: string) => {
  if (!project || !profile) return;
  const item = boqItems.find((b) => b.id === boqId);
  const area = item ? `${item.code} — ${item.label}` : 'Progres';
  const msg = `Tambahkan "${area}" ke Log Harian klien?`;
  const ok = Platform.OS === 'web'
    ? (typeof window !== 'undefined' && window.confirm ? window.confirm(msg) : false)
    : false; // native: skip auto-prompt in MVP
  if (!ok) return;

  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const existing = await getDailyLog(project.id, iso);
  const highlights = existing?.highlights ?? [];
  await upsertDailyLog({
    project_id: project.id,
    log_date: iso,
    weather: existing?.weather ?? null,
    crew_total: existing?.crew_total ?? null,
    crew_breakdown: existing?.crew_breakdown ?? null,
    safety_incidents: existing?.safety_incidents ?? 0,
    author_id: profile.id,
    highlights: [...highlights, { area: item?.label ?? 'Progres', note, boq_item_id: boqId, sort_order: highlights.length }],
    photos: existing?.photos ?? [],
  });
  toast('Ditambahkan ke Log Harian', 'ok');
}, [project, profile, boqItems, toast]);
```

Then call it after the successful insert (use the note the user typed for the progress entry, or a default):
```tsx
// after: toast('Progres dicatat', 'ok'); await refresh();
await offerAddToDailyLog(boqId, progressNote ? sanitizeText(progressNote) : 'Progres pekerjaan tercatat.');
```

> Ensure `Platform` is imported in ProgresScreen (it already imports from 'react-native'; add `Platform` to that import if missing).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep ProgresScreen || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Manual verification (web)**

Submit a progress entry with a note. A confirm dialog offers to add it to the daily log; accept. Open the Daily Log form for today → the highlight appears, linked to the BoQ row.

- [ ] **Step 4: Commit**

```bash
git add workflows/screens/ProgresScreen.tsx
git commit -m "feat: cross-prompt progress entry into daily log highlight"
```

---

## Task 12: Client report builder + Export Center entry

**Files:**
- Create: `workflows/screens/ClientReportBuilderScreen.tsx`
- Modify: `workflows/screens/LaporanScreen.tsx`

**Interfaces:**
- Consumes: `useProject` (`project`, `milestones`), `assembleClientReportDraft`/`issueClientReport`/`ClientReportDraft` (Task 7), `exportClientReportPdf` (Task 9), `Card`, `SelectSheet`, `useToast`, theme.
- Produces: `ClientReportBuilderScreen` default export with props `{ onBack: () => void }`.

- [ ] **Step 1: Create `workflows/screens/ClientReportBuilderScreen.tsx`**

```tsx
import React, { useState, useMemo } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import SelectSheet from '../components/SelectSheet';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { sanitizeText } from '../../tools/validation';
import { assembleClientReportDraft, issueClientReport, type ClientReportDraft } from '../../tools/clientReport';
import { exportClientReportPdf } from '../../tools/clientReportHtml';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

function isoNDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayIso(): string { return isoNDaysAgo(0); }

export default function ClientReportBuilderScreen({ onBack }: { onBack: () => void }) {
  const { project, profile, milestones } = useProject();
  const { show: toast } = useToast();

  const [kind, setKind] = useState<'harian' | 'mingguan'>('mingguan');
  const [draft, setDraft] = useState<ClientReportDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const kindOptions = useMemo(() => ([
    { value: 'harian', label: 'Laporan Harian' },
    { value: 'mingguan', label: 'Laporan Mingguan' },
  ]), []);

  const generate = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const periodEnd = todayIso();
      const periodStart = kind === 'harian' ? periodEnd : isoNDaysAgo(6);
      const d = await assembleClientReportDraft({
        projectId: project.id,
        kind,
        periodStart,
        periodEnd,
        projectName: project.name,
        clientName: project.client_name ?? null,   // client_name is on the Project type (tools/types.ts:35)
        milestoneStatuses: milestones.map((m) => m.status),
      });
      setDraft(d);
      toast('Draf laporan dibuat — silakan tinjau & lengkapi', 'ok');
    } catch (err: any) {
      toast(err.message ?? 'Gagal membuat draf', 'critical');
    } finally {
      setBusy(false);
    }
  };

  const patch = (p: Partial<ClientReportDraft>) => setDraft((prev) => (prev ? { ...prev, ...p } : prev));

  const exportPdf = async () => {
    if (!draft) return;
    try {
      await exportClientReportPdf(draft);
    } catch (err: any) {
      toast(err.message ?? 'Gagal mencetak', 'critical');
    }
  };

  const issue = async () => {
    if (!draft || !project || !profile) return;
    setBusy(true);
    try {
      await issueClientReport(draft, project.id, profile.id);
      toast(`Laporan #${String(draft.reportNo).padStart(2, '0')} diterbitkan`, 'ok');
      onBack();
    } catch (err: any) {
      toast(err.message ?? 'Gagal menerbitkan', 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={onBack} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color={COLORS.textSec} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>
        <Text style={styles.head}>Laporan Progres Klien (Blueprint)</Text>

        <Card title="Periode">
          <Text style={styles.label}>Jenis</Text>
          <SelectSheet value={kind} options={kindOptions} onChange={(v) => setKind(v as any)} title="Jenis laporan" />
          <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={generate}>
            <Text style={styles.btnText}>{busy ? 'Memproses...' : 'Buat Draf'}</Text>
          </TouchableOpacity>
        </Card>

        {draft && (
          <>
            <Card title="Lengkapi Naratif" subtitle="Isi field yang tidak bisa diambil otomatis.">
              <Text style={styles.label}>Sub-judul (mis. Finishing Interior)</Text>
              <TextInput style={styles.input} value={draft.subtitle} onChangeText={(v) => patch({ subtitle: v })} placeholder="Lingkup pekerjaan" />
              <Text style={styles.label}>Klien</Text>
              <TextInput style={styles.input} value={draft.clientName ?? ''} onChangeText={(v) => patch({ clientName: v })} placeholder="Nama klien" />
              <Text style={styles.label}>Cuaca</Text>
              <TextInput style={styles.input} value={draft.weather ?? ''} onChangeText={(v) => patch({ weather: v })} placeholder="Cerah" />
              <Text style={styles.label}>Status</Text>
              <TextInput style={styles.input} value={draft.statusLabel} onChangeText={(v) => patch({ statusLabel: v })} />
              <Text style={styles.label}>Rencana Periode Berikutnya</Text>
              <TextInput style={[styles.input, styles.textarea]} value={draft.nextPlan} onChangeText={(v) => patch({ nextPlan: v })} multiline placeholder="Rencana pekerjaan berikutnya..." />
            </Card>

            <Card title={`Update Lapangan (${draft.updates.length})`} subtitle="Hasil agregasi log harian. Edit/kurangi sesuai kebutuhan klien.">
              {draft.updates.map((u, i) => (
                <View key={i} style={styles.updRow}>
                  <Text style={styles.updDate}>{u.date}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.updArea}>{u.area}</Text>
                    <Text style={styles.updNote}>{u.note}</Text>
                  </View>
                  <TouchableOpacity onPress={() => patch({ updates: draft.updates.filter((_, idx) => idx !== i) })}>
                    <Ionicons name="close-circle-outline" size={18} color={COLORS.critical} />
                  </TouchableOpacity>
                </View>
              ))}
              {draft.updates.length === 0 && <Text style={styles.hint}>Belum ada update. Isi Log Harian dulu di tab Progres.</Text>}
            </Card>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={exportPdf}>
                <Ionicons name="print-outline" size={16} color={COLORS.primary} />
                <Text style={styles.secondaryText}>Cetak / PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { flex: 1 }, busy && { opacity: 0.6 }]} disabled={busy} onPress={issue}>
                <Text style={styles.btnText}>Terbitkan & Simpan</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxl },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
  head: { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text, marginBottom: SPACE.md },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: SPACE.xs + 2, marginTop: SPACE.md },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text },
  textarea: { minHeight: 70, textAlignVertical: 'top' },
  btn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center', marginTop: SPACE.md },
  btnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.base, paddingHorizontal: SPACE.base, marginTop: SPACE.md },
  secondaryText: { color: COLORS.primary, fontSize: TYPE.sm, fontFamily: FONTS.semibold },
  actions: { flexDirection: 'row', gap: SPACE.md - 2, alignItems: 'center' },
  updRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md - 2, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  updDate: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.accent, width: 52 },
  updArea: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  updNote: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
});
```

- [ ] **Step 2: Wire into LaporanScreen — Export Center row + takeover**

In `workflows/screens/LaporanScreen.tsx`:

(a) Add import:
```tsx
import ClientReportBuilderScreen from './ClientReportBuilderScreen';
```

(b) Extend the `Section` union (line ~32) with `'client-report'`:
```tsx
type Section = 'overview' | 'mtn' | 'baseline' | 'gate2' | 'jadwal' | 'jadwal-form' | 'jadwal-ai-draft' | 'jadwal-ai-review' | 'katalog' | 'mandor' | 'opname' | 'attendance' | 'client-report';
```

(c) Add the takeover near the other `if (activeSection === ...)` blocks:
```tsx
if (activeSection === 'client-report') {
  return <ClientReportBuilderScreen onBack={() => setActiveSection('overview')} />;
}
```

(d) Add a dedicated button in the Export Center Card (this report is NOT a `ReportType`, so it does NOT go in the `generateReport` rows array — add it as a separate row above/below that map):
```tsx
<TouchableOpacity style={styles.exportRow} onPress={() => setActiveSection('client-report')}>
  <Ionicons name="newspaper-outline" size={18} color={COLORS.primary} />
  <Text style={styles.exportLabel}>Laporan Progres Klien (Blueprint)</Text>
  <Ionicons name="chevron-forward" size={16} color={COLORS.textSec} />
</TouchableOpacity>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ClientReportBuilderScreen|LaporanScreen" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Manual verification (web) — end-to-end + FIDELITY CHECK**

1. Ensure at least one daily log with highlights + a featured photo exists (Task 10).
2. Report tab → Export Center → **Laporan Progres Klien (Blueprint)** → pick Mingguan → **Buat Draf**.
3. Fill subtitle + next-plan, trim updates. Tap **Cetak / PDF**.
4. In the print preview, **Save as PDF** and open it beside `assets/Client Progress Report Template/daily_blueprint.pdf`.
5. **FIDELITY ACCEPTANCE (Global Constraint §1.2):** confirm A4 single page, Space Grotesk, sand accents, corner registration marks, metadata strip, numbered sections, black caption bar, footer + "A4 · 210 × 297 mm" line — matching the reference. No numeric %. If anything drifts, the `BLUEPRINT_CSS` paste (Task 8 Step 3) is incomplete or altered — fix it.
6. Tap **Terbitkan & Simpan** → confirm a `client_progress_reports` row exists with a non-null `snapshot` and `issued_at` (check in the Dashboard).

- [ ] **Step 5: Commit**

```bash
git add workflows/screens/ClientReportBuilderScreen.tsx workflows/screens/LaporanScreen.tsx
git commit -m "feat: client report builder + Export Center entry"
```

---

## Task 13 (Polish, optional): base64-embed Space Grotesk

**Files:**
- Modify: `tools/clientReportHtml.ts`

Only do this if the Task 12 fidelity check shows font fallback (wrong typeface) in the printed PDF. The `document.fonts.ready` gate (Task 9) is the MVP safeguard; embedding is the hardening.

- [ ] **Step 1:** Confirm `@expo-google-fonts/space-grotesk` is installed: `ls node_modules/@expo-google-fonts/space-grotesk/*.ttf`.
- [ ] **Step 2:** Write a one-off script `tools/scripts/embedFonts.mjs` that base64-encodes the 300/400/500/600/700 `.ttf` files and writes `tools/generatedFonts.ts` exporting a `SPACE_GROTESK_FONT_FACE` string of `@font-face { font-family:'Space Grotesk'; font-weight:...; src:url(data:font/ttf;base64,...) format('truetype'); }` rules.
- [ ] **Step 3:** In `renderClientReportHtml`, replace the Google Fonts `<link>` with `<style>${SPACE_GROTESK_FONT_FACE}</style>` before `${BLUEPRINT_CSS}`.
- [ ] **Step 4:** Re-run the Task 8 tests (`npm test -- tools/__tests__/clientReportHtml.test.ts`) — expected PASS; add an assertion `expect(html).toContain('@font-face')`.
- [ ] **Step 5:** Commit: `git commit -am "feat: embed Space Grotesk for print fidelity"`.

---

## Self-Review

**Spec coverage:**
- §4 data model → Task 1 ✓
- §5 daily site log (capture + aggregate) → Tasks 2, 3, 10 ✓
- §5.4 cross-prompt → Task 11 ✓
- §6.2 assembly (status map, weekly delta, numbering, draft, issue) → Tasks 4, 5, 6, 7 ✓
- §6.3 render + separation + print + fonts → Tasks 8, 9, 13 ✓
- §6.4 daily/weekly semantics → Task 12 (kind selector + period logic) ✓
- §7 roles → enforced by RLS (Task 1) + Export Center visibility (existing gating); daily log open to project members. ✓
- §1.1 freeze snapshot → Task 7 (`issueClientReport` writes `snapshot`) ✓
- §1.2 A4 fidelity → Task 8 tests + Task 12 Step 4 acceptance check ✓
- Number-free → Task 8 test "renders NO numeric percentage" ✓

**Placeholder scan:** The only intentional "paste verbatim" is `BLUEPRINT_CSS` (Task 8 Step 3) — required by the spec's verbatim-port constraint, not a plan gap; the instruction names the exact source file + line range. All column/type references are now resolved against the code (below).

**Type consistency:** `ClientReportDraft` defined in Task 7 is consumed unchanged in Tasks 8, 9, 12. `DailyLogHighlight`/`DailyLogPhoto` defined in Task 2, reused in Tasks 3, 10, 11. `aggregatePeriod`/`assignNextReportNo`/`deriveProjectStatusLabel` signatures match across producer/consumer tasks.

**Resolved against code (no confirm-at-build left):**
1. `report_exports` insert columns = `project_id, report_type, filters, file_path, generated_by` (`tools/reports.ts:1059-1065`) — used verbatim in Task 6.
2. `Project.client_name: string | null` exists (`tools/types.ts:35`) — Task 12 reads it directly, no cast.
3. `set_updated_at()` may or may not pre-exist — Task 1 guards both cases with a `DO $$` check.
