// tools/__tests__/analyticsModules.test.ts
import { buildApprovalFlow } from '../analytics/approvalFlow';
import { buildDiaryActivity } from '../analytics/diaryActivity';
import { buildMaterialCoverage, coverageByRow } from '../analytics/materialCoverage';
import { workTypeOfLine } from '../analytics/workType';

describe('workTypeOfLine', () => {
  it('trusts a confirmed link, and falls back to keywords labelled as such', () => {
    expect(workTypeOfLine('PEMBESIAN', 'apa saja')).toEqual({ type: 'PEMBESIAN', source: 'link' });
    expect(workTypeOfLine('CURING', 'curing kolom')).toEqual({ type: 'LAINNYA', source: 'link' });
    expect(workTypeOfLine(null, 'Basement :: Penulangan basement -5.00')).toEqual({ type: 'PEMBESIAN', source: 'keyword' });
    expect(workTypeOfLine(null, 'Pembuatan bekisting sloof dan pilecap')).toEqual({ type: 'BEKISTING', source: 'keyword' });
    expect(workTypeOfLine(null, 'Pengecoran plat lantai')).toEqual({ type: 'PENGECORAN', source: 'keyword' });
    expect(workTypeOfLine(null, 'Pasang batako dinding pagar')).toEqual({ type: 'PASANGAN', source: 'keyword' });
    expect(workTypeOfLine(null, 'Pembuatan saluran air kotor')).toEqual({ type: 'MEP', source: 'keyword' });
    expect(workTypeOfLine(null, 'Pekerjaan galian pondasi')).toEqual({ type: 'GALIAN', source: 'keyword' });
    expect(workTypeOfLine(null, 'Rapat koordinasi')).toEqual({ type: 'LAINNYA', source: 'keyword' });
  });
});

describe('buildDiaryActivity', () => {
  const report = (date: string, crew: number | null, updates: string[], over: Record<string, unknown> = {}) => ({
    id: `r-${date}`, report_no: Number(date.slice(-2)), revision: 1, period_start: date, crewTotal: crew,
    updates: updates.map((note) => ({ area: '', note })), ...over,
  });

  it('counts work per week, crew, and working days without a report', () => {
    const a = buildDiaryActivity({
      today: '2026-09-12',
      reports: [
        report('2026-09-07', 20, ['Pasang bekisting kolom', 'Penulangan balok']),
        report('2026-09-08', 30, ['Pengecoran plat']),
        report('2026-09-10', null, ['Penulangan kolom']),
      ],
      links: new Map([['r-2026-09-08:0', 'PENGECORAN']]),
    });
    expect(a.weeks).toEqual(['2026-09-07']);
    expect(a.byWeek[0]).toMatchObject({
      week: '2026-09-07', reports: 3, crewAvg: 25, crewDays: 50, lines: 4, linkedLines: 1,
      mix: { BEKISTING: 1, PEMBESIAN: 2, PENGECORAN: 1 },
      // Mon–Sat up to today (Sat 12 Sep): 9, 11 and 12 Sep have no report.
      daysWithoutReport: 3,
    });
    expect(a.reportCount).toBe(3);
    expect(a.keywordShare).toBe(75);
  });

  it('counts only the latest revision of a report', () => {
    const a = buildDiaryActivity({
      today: '2026-09-08',
      reports: [report('2026-09-07', 20, ['Galian'], { id: 'v1', report_no: 1, revision: 1 }), report('2026-09-07', 22, ['Galian', 'Bekisting'], { id: 'v2', report_no: 1, revision: 2 })],
      links: new Map(),
    });
    expect(a.byWeek[0]).toMatchObject({ reports: 1, lines: 2, crewAvg: 22 });
  });

  it('is empty without reports', () => {
    expect(buildDiaryActivity({ today: '2026-09-08', reports: [], links: new Map() })).toMatchObject({ weeks: [], byWeek: [], reportCount: 0 });
  });
});

describe('buildMaterialCoverage', () => {
  const catalog = new Map([
    ['besi13', { name: 'Besi beton ulir 13 mm', category: 'Struktur', unit: 'kg', is_asset: false }],
    ['besi16', { name: 'Besi beton ulir 16 mm', category: 'Struktur', unit: 'kg', is_asset: false }],
    ['semen', { name: 'Semen PCC 40 kg', category: 'Material Beton', unit: 'zak', is_asset: false }],
    ['scaf', { name: 'Scaffolding', category: 'Peralatan', unit: 'set', is_asset: true }],
  ]);
  const planned = [
    { material_id: 'besi13', boq_item_id: 'k1', planned_quantity: 1000 },
    { material_id: 'besi16', boq_item_id: 'k2', planned_quantity: 3000 },
    { material_id: 'semen', boq_item_id: 'k1', planned_quantity: 200 },
    { material_id: 'scaf', boq_item_id: null, planned_quantity: 10 },
  ];
  const req = (material: string, quantity: number, status: string, date: string, alloc: Array<[string, number]> = []) => ({
    material_id: material, quantity, status, created_at: `${date}T02:00:00Z`, allocations: alloc.map(([boq_item_id, allocated_quantity]) => ({ boq_item_id, allocated_quantity })),
  });
  const requests = [
    req('besi13', 500, 'APPROVED', '2026-08-10', [['k1', 500]]),
    req('besi16', 900, 'PENDING', '2026-08-20', [['k2', 900]]),
    req('besi16', 300, 'REJECTED', '2026-08-21', [['k2', 300]]),
    req('semen', 100, 'APPROVED', '2026-09-01', [['k1', 100]]),
  ];

  it('compares requested and approved with the plan per material group of one unit, assets left out', () => {
    const c = buildMaterialCoverage({ planned, requests, catalog, firstMentions: new Map(), today: '2026-09-17' });
    expect(c.groups.map((g) => g.key)).toEqual(['Struktur · kg', 'Material Beton · zak']);
    expect(c.groups[0]).toMatchObject({ planned: 4000, requested: 1400, approved: 500, requestedPct: 35, approvedPct: 12.5, requestCount: 2 });
    expect(c.groups[1]).toMatchObject({ planned: 200, requested: 100, approved: 100, approvedPct: 50 });
  });

  it('measures the days from the first request to the first diary mention, and flags material waiting for work', () => {
    const c = buildMaterialCoverage({
      planned, requests, catalog, today: '2026-09-17',
      firstMentions: new Map([['PEMBESIAN', '2026-08-24']]),
    });
    expect(c.groups[0]).toMatchObject({ workType: 'PEMBESIAN', firstRequest: '2026-08-10', firstMention: '2026-08-24', lagDays: 14, waiting: false });
    // Semen requested 1 Sep, no pengecoran in the diary by 17 Sep: 16 days.
    expect(c.groups[1]).toMatchObject({ workType: 'PENGECORAN', firstRequest: '2026-09-01', firstMention: null, lagDays: null, waiting: true });
  });

  it('gives besi coverage per work area for the claim flag', () => {
    const byRow = coverageByRow({ planned, requests, catalog }, 'Struktur', 'kg');
    expect(byRow.get('k1')).toEqual({ planned: 1000, requested: 500, approved: 500 });
    expect(byRow.get('k2')).toEqual({ planned: 3000, requested: 900, approved: 0 });
  });
});

describe('buildApprovalFlow', () => {
  const h = (created: string, status: string, reviewed: string | null = null) => ({ created_at: created, overall_status: status, reviewed_at: reviewed });

  it('measures days to a decision, the rejected share, and pending requests by age', () => {
    const f = buildApprovalFlow({
      today: '2026-09-17',
      headers: [
        h('2026-09-01T02:00:00Z', 'APPROVED', '2026-09-02T02:00:00Z'),
        h('2026-09-01T02:00:00Z', 'APPROVED', '2026-09-04T02:00:00Z'),
        h('2026-09-01T02:00:00Z', 'REJECTED', '2026-09-10T02:00:00Z'),
        h('2026-08-20T02:00:00Z', 'PENDING'),
        h('2026-09-16T02:00:00Z', 'UNDER_REVIEW'),
        h('2026-09-10T02:00:00Z', 'AUTO_HOLD'),
      ],
    });
    expect(f).toMatchObject({ total: 6, decided: 3, medianDaysToDecision: 3, rejectedPct: 33.3, pending: 3, oldestPendingDays: 28 });
    expect(f.pendingByAge).toEqual([{ label: '0–2 hari', count: 1 }, { label: '3–7 hari', count: 1 }, { label: '8–14 hari', count: 0 }, { label: '> 14 hari', count: 1 }]);
  });

  it('reports nothing measured without decided requests', () => {
    expect(buildApprovalFlow({ today: '2026-09-17', headers: [] })).toMatchObject({ total: 0, decided: 0, medianDaysToDecision: null, rejectedPct: null, pending: 0, oldestPendingDays: null });
  });
});
