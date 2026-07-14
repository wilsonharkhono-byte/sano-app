import { mapMilestoneStatusToLabel, deriveProjectStatusLabel, installedAsOf, computeWeeklyProgressDelta, assignNextReportNo, nextRevisionNo, recordClientProgressReportExport, assembleClientReportDraft, issueClientReport, listClientReports, getClientReportSnapshot } from '../clientReport';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../dailySiteLogs', () => ({ aggregatePeriod: jest.fn() }));
jest.mock('../storage', () => ({ resolvePhotoUrl: jest.fn(async (p: string) => `https://cdn/${p}`) }));
import { aggregatePeriod } from '../dailySiteLogs';
const mockSupabase = supabase as jest.Mocked<typeof supabase>;

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

describe('clientReport weekly delta', () => {
  beforeEach(() => jest.clearAllMocks());

  // Task 3.5: installedAsOf now takes an EXCLUSIVE cutoff and queries with
  // `.lt()` (was inclusive `.lte()`) — callers pass a WIB-day-boundary
  // instant from tools/timeWindow.ts instead of an offset-less literal.
  it('installedAsOf sums quantities per boq item strictly before the cutoff instant', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockResolvedValue({
        data: [
          { boq_item_id: 'a', quantity: 4, created_at: '2026-06-10' },
          { boq_item_id: 'a', quantity: 6, created_at: '2026-06-11' },
          { boq_item_id: 'b', quantity: 2, created_at: '2026-06-12' },
        ],
        error: null,
      }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);

    const map = await installedAsOf('proj-1', '2026-06-14T17:00:00.000Z');

    expect(map.get('a')).toBe(10);
    expect(map.get('b')).toBe(2);
    expect(chain.lt).toHaveBeenCalledWith('created_at', '2026-06-14T17:00:00.000Z');
  });

  it('computeWeeklyProgressDelta = overall% at end minus overall% at start', async () => {
    // start: a=0/10, b=0/10 -> 0% ; end: a=10/10, b=5/10 -> (100+50)/2 = 75%
    const startChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), lt: jest.fn().mockResolvedValue({ data: [], error: null }) };
    const endChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), lt: jest.fn().mockResolvedValue({
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
    // Task 3.5: WIB day boundaries via dayRangeWIB, both exclusive `.lt()`.
    // 00:00:00 WIB 2026-06-08 == 2026-06-07T17:00:00.000Z; the exclusive end
    // of 2026-06-14's WIB day == 00:00:00 WIB 2026-06-15 == 2026-06-14T17:00:00.000Z.
    expect(startChain.lt).toHaveBeenCalledWith('created_at', '2026-06-07T17:00:00.000Z');
    expect(endChain.lt).toHaveBeenCalledWith('created_at', '2026-06-14T17:00:00.000Z');
  });
});

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

  // Task 3.7: true-max revision counter — queried fresh rather than trusting
  // whatever revision row the caller happens to be looking at.
  it('nextRevisionNo returns 1 when the report_no has no revisions yet', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);
    expect(await nextRevisionNo('proj-1', 5)).toBe(1);
  });

  it('nextRevisionNo returns max(revision)+1 scoped to (project_id, report_no)', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { revision: 3 }, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);
    expect(await nextRevisionNo('proj-1', 5)).toBe(4);
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'proj-1');
    expect(chain.eq).toHaveBeenCalledWith('report_no', 5);
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

describe('issueClientReport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts a frozen snapshot + issued fields, records export after success, returns id', async () => {
    const draft = {
      kind: 'mingguan', reportNo: 7, periodStart: '2026-06-08', periodEnd: '2026-06-14',
      projectName: 'Graha', clientName: 'Bpk', subtitle: 'Finishing', statusLabel: 'Sesuai Jadwal',
      weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang', safetyIncidents: 0,
      nextPlan: 'Lanjut', updates: [], hero: null, thumbs: [],
    } as any;

    const insertChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'rep-1' }, error: null }),
    };
    const exportChain = { insert: jest.fn().mockResolvedValue({ error: null }) };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(insertChain)   // client_progress_reports insert
      .mockReturnValueOnce(exportChain);  // report_exports insert (recordClientProgressReportExport)

    const result = await issueClientReport(draft, 'proj-1', 'user-1');

    expect(result).toEqual({ id: 'rep-1', reportNo: 7, revision: 1 });
    expect(mockSupabase.from).toHaveBeenNthCalledWith(1, 'client_progress_reports');
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'proj-1', report_no: 7, kind: 'mingguan',
      snapshot: draft, issued_by: 'user-1', next_plan: 'Lanjut',
    }));
    const insertArg = (insertChain.insert as jest.Mock).mock.calls[0][0];
    expect(typeof insertArg.issued_at).toBe('string');
    expect(insertArg.revision).toBe(1); // default first issue
    expect(mockSupabase.from).toHaveBeenNthCalledWith(2, 'report_exports');
    expect(exportChain.insert).toHaveBeenCalled();
  });

  it('a revision keeps the same report_no and bumps revision', async () => {
    const draft = {
      kind: 'harian', reportNo: 2, revision: 2, periodStart: '2026-07-02', periodEnd: '2026-07-02',
      projectName: 'Nusa', clientName: null, subtitle: '', statusLabel: 'Sesuai Jadwal',
      weather: null, crewTotal: null, crewBreakdown: null, safetyIncidents: 0,
      nextPlan: '', updates: [], hero: null, thumbs: [],
    } as any;
    const insertChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'rep-2r2' }, error: null }),
    };
    const exportChain = { insert: jest.fn().mockResolvedValue({ error: null }) };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(exportChain);

    const result = await issueClientReport(draft, 'proj-1', 'user-1');

    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      report_no: 2, revision: 2,
    }));
    expect(result).toEqual({ id: 'rep-2r2', reportNo: 2, revision: 2 });
  });

  // Task 3.7: race-safe numbering. Migration 075 adds a hard UNIQUE index on
  // (project_id, report_no, revision); a lost race between two concurrent
  // "Terbitkan" taps now surfaces as a Postgres 23505 instead of silently
  // inserting a duplicate. issueClientReport must catch that, recompute the
  // true next number, and retry.
  it('retries with a fresh report_no on a unique-violation for a brand-new report, then succeeds', async () => {
    const draft = {
      kind: 'mingguan', reportNo: 7, periodStart: '2026-06-08', periodEnd: '2026-06-14',
      projectName: 'Graha', clientName: 'Bpk', subtitle: 'Finishing', statusLabel: 'Sesuai Jadwal',
      weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang', safetyIncidents: 0,
      nextPlan: 'Lanjut', updates: [], hero: null, thumbs: [],
    } as any;

    const conflictChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_client_progress_reports_no_revision"' } }),
    };
    const assignChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { report_no: 7 }, error: null }), // someone else took 7 first
    };
    const successChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'rep-retry' }, error: null }),
    };
    const exportChain = { insert: jest.fn().mockResolvedValue({ error: null }) };

    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(conflictChain)  // 1st insert attempt -> 23505
      .mockReturnValueOnce(assignChain)    // assignNextReportNo requery -> 8
      .mockReturnValueOnce(successChain)   // 2nd insert attempt -> success
      .mockReturnValueOnce(exportChain);   // report_exports insert

    const result = await issueClientReport(draft, 'proj-1', 'user-1');

    // The stale-toast bug: the caller must be told #08 (what was actually
    // inserted after the retry), not #07 (the pre-retry number the draft
    // still holds) — so the return value carries the post-retry numbers,
    // not an echo of draft.reportNo/draft.revision.
    expect(result).toEqual({ id: 'rep-retry', reportNo: 8, revision: 1 });
    expect(conflictChain.insert).toHaveBeenCalledWith(expect.objectContaining({ report_no: 7, revision: 1 }));
    expect(successChain.insert).toHaveBeenCalledWith(expect.objectContaining({ report_no: 8, revision: 1 }));
    expect((successChain.insert as jest.Mock).mock.calls[0][0].snapshot).toMatchObject({ reportNo: 8, revision: 1 });
  });

  it('retries with a fresh revision on a unique-violation when re-issuing an existing report_no', async () => {
    const draft = {
      kind: 'harian', reportNo: 2, revision: 2, periodStart: '2026-07-02', periodEnd: '2026-07-02',
      projectName: 'Nusa', clientName: null, subtitle: '', statusLabel: 'Sesuai Jadwal',
      weather: null, crewTotal: null, crewBreakdown: null, safetyIncidents: 0,
      nextPlan: '', updates: [], hero: null, thumbs: [],
    } as any;

    const conflictChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { code: '23505' } }),
    };
    const revisionChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { revision: 2 }, error: null }), // someone else already took R2
    };
    const successChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'rep-2r3' }, error: null }),
    };
    const exportChain = { insert: jest.fn().mockResolvedValue({ error: null }) };

    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(conflictChain)
      .mockReturnValueOnce(revisionChain)
      .mockReturnValueOnce(successChain)
      .mockReturnValueOnce(exportChain);

    const result = await issueClientReport(draft, 'proj-1', 'user-1');

    expect(result).toEqual({ id: 'rep-2r3', reportNo: 2, revision: 3 });
    expect(conflictChain.insert).toHaveBeenCalledWith(expect.objectContaining({ report_no: 2, revision: 2 }));
    expect(successChain.insert).toHaveBeenCalledWith(expect.objectContaining({ report_no: 2, revision: 3 }));
  });

  it('does not retry non-unique-violation insert errors', async () => {
    const draft = {
      kind: 'harian', reportNo: 1, periodStart: '2026-07-01', periodEnd: '2026-07-01',
      projectName: 'X', clientName: null, subtitle: '', statusLabel: 'Sesuai Jadwal',
      weather: null, crewTotal: null, crewBreakdown: null, safetyIncidents: 0,
      nextPlan: '', updates: [], hero: null, thumbs: [],
    } as any;
    const errChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { code: '23503', message: 'foreign key violation' } }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(errChain);

    await expect(issueClientReport(draft, 'proj-1', 'user-1')).rejects.toMatchObject({ code: '23503' });
    expect(errChain.insert).toHaveBeenCalledTimes(1);
  });

  // Minor (a): retry-exhaustion must surface a plain-language Indonesian
  // operator message, not the raw Postgres 23505 copy — the raw error is
  // still logged via console.warn so the real cause isn't lost.
  it('gives up after the bounded retry limit if the race never resolves, mapping to an operator-facing message', async () => {
    const draft = {
      kind: 'harian', reportNo: 3, periodStart: '2026-07-01', periodEnd: '2026-07-01',
      projectName: 'X', clientName: null, subtitle: '', statusLabel: 'Sesuai Jadwal',
      weather: null, crewTotal: null, crewBreakdown: null, safetyIncidents: 0,
      nextPlan: '', updates: [], hero: null, thumbs: [],
    } as any;
    const conflictChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { code: '23505' } }),
    };
    const assignChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { report_no: 3 }, error: null }),
    };
    // Every insert attempt conflicts, every requery hands back the same
    // number (worst case: perpetual contention) — must stop, not loop
    // forever. `.from()` alternates between the insert chain (odd calls) and
    // the assignNextReportNo requery chain (even calls) since both target
    // the same table name and can't be disambiguated by argument alone.
    let call = 0;
    (mockSupabase.from as jest.Mock).mockImplementation(() => {
      call += 1;
      return call % 2 === 1 ? conflictChain : assignChain;
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(issueClientReport(draft, 'proj-1', 'user-1')).rejects.toMatchObject({
      message: 'Nomor laporan bentrok berulang — coba lagi.',
    });
    expect(conflictChain.insert).toHaveBeenCalledTimes(5); // MAX_REPORT_ISSUE_ATTEMPTS
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: '23505' }));

    warnSpy.mockRestore();
  });

  // Minor (c): isUniqueViolation also recognizes the constraint name from
  // migration 075 even when `code` is missing/different — future-proofs
  // against other unique constraints on this table being misread as a
  // numbering race, while still retrying on THIS specific constraint.
  it('retries on a unique-violation identified by constraint name even without a 23505 code', async () => {
    const draft = {
      kind: 'mingguan', reportNo: 7, periodStart: '2026-06-08', periodEnd: '2026-06-14',
      projectName: 'Graha', clientName: 'Bpk', subtitle: 'Finishing', statusLabel: 'Sesuai Jadwal',
      weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang', safetyIncidents: 0,
      nextPlan: 'Lanjut', updates: [], hero: null, thumbs: [],
    } as any;

    const conflictChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'duplicate key value violates unique constraint "uq_client_progress_reports_no_revision"' },
      }),
    };
    const assignChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { report_no: 7 }, error: null }),
    };
    const successChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'rep-retry-2' }, error: null }),
    };
    const exportChain = { insert: jest.fn().mockResolvedValue({ error: null }) };

    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(conflictChain)
      .mockReturnValueOnce(assignChain)
      .mockReturnValueOnce(successChain)
      .mockReturnValueOnce(exportChain);

    const result = await issueClientReport(draft, 'proj-1', 'user-1');

    expect(result).toEqual({ id: 'rep-retry-2', reportNo: 8, revision: 1 });
  });
});

describe('report archive (Riwayat Laporan)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('listClientReports maps rows newest-first with issuer name', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    };
    // The final .order resolves the promise (thenable chain): make the second
    // order call return a resolved value.
    chain.order
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({
        data: [
          { id: 'r2', report_no: 2, revision: 1, kind: 'harian', period_start: '2026-07-02', period_end: '2026-07-02', issued_at: '2026-07-02T10:00:00Z', profiles: { full_name: 'Krisanto' } },
          { id: 'r1', report_no: 1, revision: 1, kind: 'harian', period_start: '2026-07-01', period_end: '2026-07-01', issued_at: '2026-07-01T10:00:00Z', profiles: null },
        ],
        error: null,
      });
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);

    const rows = await listClientReports('proj-1');

    expect(mockSupabase.from).toHaveBeenCalledWith('client_progress_reports');
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'proj-1');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'r2', report_no: 2, issued_by_name: 'Krisanto' });
    expect(rows[1].issued_by_name).toBeNull();
  });

  it('getClientReportSnapshot returns the frozen snapshot (or null)', async () => {
    const snapshot = { kind: 'harian', reportNo: 1, updates: [] };
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { snapshot }, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);

    const result = await getClientReportSnapshot('r1');
    expect(result).toEqual(snapshot);
    expect(chain.eq).toHaveBeenCalledWith('id', 'r1');

    const emptyChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(emptyChain);
    expect(await getClientReportSnapshot('missing')).toBeNull();
  });
});

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

    // Mock supabase chain for assignNextReportNo
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);

    const draft = await assembleClientReportDraft({
      projectId: 'proj-1', kind: 'mingguan',
      periodStart: '2026-06-08', periodEnd: '2026-06-14',
      projectName: 'Graha Family T-61', clientName: 'Bpk. Jason Jordy',
      milestoneStatuses: ['ON_TRACK'],
    });

    expect(draft.statusLabel).toBe('Sesuai Jadwal');
    expect(draft.updates).toEqual([{ date: '14 Jun', area: 'Tangga', note: 'Finishing' }]);
    expect(draft.hero?.url).toBe('https://cdn/a.jpg');
    expect(draft.thumbs).toHaveLength(1);
    expect(draft.thumbs[0].url).toBe('https://cdn/b.jpg');
    expect(draft.weather).toBe('Cerah');
    expect(draft.subtitle).toBe(''); // curator-typed, blank by default
  });
});
