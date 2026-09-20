// tools/__tests__/analyticsMaterialChain.test.ts
import { buildMaterialChain, type MaterialChainInput } from '../analytics/materialChain';

const catalog = new Map([
  ['besi13', { name: 'Besi beton ulir 13 mm', category: 'Struktur', unit: 'kg', is_asset: false }],
  ['besi16', { name: 'Besi beton ulir 16 mm', category: 'Struktur', unit: 'kg', is_asset: false }],
  ['semen', { name: 'Semen PCC 40 kg', category: 'Material Beton', unit: 'zak', is_asset: false }],
  ['bata', { name: 'Bata ringan', category: 'Dinding', unit: 'pcs', is_asset: false }],
  ['pipa', { name: 'Pipa PVC 4 inci', category: 'Plumbing', unit: 'btg', is_asset: false }],
  ['scaf', { name: 'Scaffolding', category: 'Peralatan', unit: 'set', is_asset: true }],
]);
const planned = [
  { material_id: 'besi13', boq_item_id: 'k1', planned_quantity: 1000 },
  { material_id: 'besi16', boq_item_id: 'k2', planned_quantity: 3000 },
  { material_id: 'semen', boq_item_id: 'k1', planned_quantity: 200 },
  { material_id: 'bata', boq_item_id: 'd1', planned_quantity: 500 },
  { material_id: 'scaf', boq_item_id: null, planned_quantity: 10 },
];
const req = (material: string, quantity: number, status: string, created: string, reviewed: string | null = null) => ({
  material_id: material, quantity, status, created_at: `${created}T02:00:00Z`, reviewed_at: reviewed ? `${reviewed}T02:00:00Z` : null, allocations: [],
});
const requests = [
  req('besi13', 500, 'APPROVED', '2026-08-10', '2026-08-12'),
  req('besi16', 900, 'PENDING', '2026-08-20'),
  req('besi16', 300, 'REJECTED', '2026-08-21', '2026-08-22'),
  req('semen', 100, 'APPROVED', '2026-09-01'),
];
/** The two weight shapes a row (and a claim line's snapshot) can have. */
const SPLIT = { BEKISTING: 0.3, PEMBESIAN: 0.4, PENGECORAN: 0.3 };
const WHOLE = { SINGLE: 1 };
const weights = [{ boq_item_id: 'k1', weights: SPLIT }];
const vline = (row: string, pct: Record<string, number>, at: string, snapshot: unknown = WHOLE) => ({
  boq_item_id: row, verified_pct: pct, weights_snapshot: snapshot, verified_at: `${at}T03:00:00Z`,
});
const dline = (id: string, row: string, stage: string | null, state: string, periodEnd: string, reportNo: number, lineIndex = 0) => ({
  id, boq_item_id: row, stage, activity_state: state, line_text: '', line_index: lineIndex, report_id: `r${reportNo}`, report_no: reportNo, revision: 1, period_end: periodEnd, issued_at: null,
});

function input(over: Partial<MaterialChainInput> = {}): MaterialChainInput {
  return { today: '2026-09-17', planned, requests, catalog, weights, verifiedLines: [], diary: { lines: [], readable: true }, ...over };
}

describe('buildMaterialChain groups', () => {
  it('makes one chain per planned material group, largest plan first, with the work it feeds', () => {
    const { groups, unplannedRequested } = buildMaterialChain(input());
    expect(groups.map((g) => g.chipLabel)).toEqual(['Besi (kg) → Pembesian', 'Bata (pcs) → Pasangan', 'Semen (zak) → Pengecoran']);
    expect(groups[0]).toMatchObject({ key: 'Struktur · kg', category: 'Struktur', unit: 'kg', planned: 4000, rows: 2 });
    expect(unplannedRequested).toEqual([]);
  });

  it('lists requested groups without a plan instead of charting them', () => {
    const { groups, unplannedRequested } = buildMaterialChain(input({ planned: planned.filter((p) => p.material_id !== 'semen') }));
    expect(groups.map((g) => g.key)).toEqual(['Struktur · kg', 'Dinding · pcs']);
    expect(unplannedRequested).toEqual(['Material Beton (zak)']);
  });

  it('keeps the work areas as the denominator and reports the plan made without one beside it', () => {
    const { groups } = buildMaterialChain(input({
      planned: [
        { material_id: 'besi13', boq_item_id: 'k1', planned_quantity: 1000 },
        { material_id: 'besi16', boq_item_id: null, planned_quantity: 1000 },
      ],
      requests: [req('besi13', 1000, 'APPROVED', '2026-09-01', '2026-09-02')],
    }));
    // 1 000 kg approved against the 1 000 kg tied to k1; the 1 000 kg planned for the project as a whole is reported, not divided into.
    expect(groups[0]).toMatchObject({ key: 'Struktur · kg', planned: 1000, plannedWithoutArea: 1000, rows: 1 });
    expect(groups[0].today.approved).toBe(100);
  });

  it('reports a group planned only for the project as a whole instead of charting or disowning it', () => {
    const { groups, unplannedRequested, planWithoutAreaOnly } = buildMaterialChain(input({
      planned: [...planned, { material_id: 'pipa', boq_item_id: null, planned_quantity: 300 }],
      requests: [...requests, req('pipa', 50, 'PENDING', '2026-09-01')],
    }));
    expect(groups.map((g) => g.key)).toEqual(['Struktur · kg', 'Dinding · pcs', 'Material Beton · zak']);
    expect(unplannedRequested).toEqual([]);
    expect(planWithoutAreaOnly).toEqual(['Plumbing (btg) 300 btg']);
  });
});

describe('buildMaterialChain procurement series', () => {
  it('cumulates requests by the week made and approvals by the week decided, rejected left out, as % of plan', () => {
    const g = buildMaterialChain(input()).groups[0];
    expect(g.weeks.slice(0, 6)).toEqual(['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']);
    expect(g.thisWeekIndex).toBe(5);
    expect(g.requested.slice(0, 6)).toEqual([12.5, 35, 35, 35, 35, 35]);
    expect(g.approved.slice(0, 6)).toEqual([12.5, 12.5, 12.5, 12.5, 12.5, 12.5]);
    expect(g.today).toMatchObject({ requested: 35, approved: 12.5, verified: null, diary: null });
  });

  it('falls back to the request week when an approved header has no decision time', () => {
    const g = buildMaterialChain(input({ requests: [req('besi13', 400, 'APPROVED', '2026-09-02')] })).groups[0];
    expect(g.weeks[0]).toBe('2026-08-31');
    expect(g.approved[0]).toBe(10);
  });

  it('starts the axis this week when nothing was ever recorded', () => {
    const g = buildMaterialChain(input({ requests: [] })).groups[0];
    expect(g.weeks).toEqual(['2026-09-14']);
    expect(g.requested).toEqual([0]);
    expect(g.projectionNote).toBe('Belum ada progres terverifikasi.');
  });
});

const verifiedLines = [
  vline('k1', { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, '2026-08-26', SPLIT),
  vline('k1', { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 0 }, '2026-09-02', SPLIT),
  vline('k2', { SINGLE: 25 }, '2026-09-09'),
  vline('zz', { SINGLE: 100 }, '2026-09-09'),
];

describe('buildMaterialChain installed series', () => {
  it('reads each row’s stage percent as of the week, split rows by the group’s stage and single rows as a whole', () => {
    const g = buildMaterialChain(input({ verifiedLines })).groups[0];
    // k1: 50 % pembesian × 1 000 kg from the week of 24 Aug, 100 % from 31 Aug; k2 (SINGLE) 25 % × 3 000 kg from 7 Sep; zz is not in the plan.
    expect(g.verified.slice(0, 6)).toEqual([0, 0, 12.5, 25, 43.8, 43.8]);
    expect(g.today.verified).toBe(43.8);
  });

  it('projects the last weeks’ verified pace to 100 and extends the axis to the finish', () => {
    const g = buildMaterialChain(input({ verifiedLines })).groups[0];
    expect(g.relation).toMatchObject({ pacePerWeek: 10.4, windowWeeks: 3 });
    expect(g.weeks).toHaveLength(12);
    expect(g.weeks[11]).toBe('2026-10-26');
    expect(g.projected.slice(4)).toEqual([null, 43.8, 54.2, 64.6, 75, 85.4, 95.8, 100]);
    expect(g.verified.slice(6)).toEqual([null, null, null, null, null, null]);
    expect(g.projectionNote).toBeNull();
  });

  it('names the window it actually measured when the verified figure did not rise', () => {
    const flat = [vline('k1', { PEMBESIAN: 50 }, '2026-09-09', SPLIT), vline('k1', { PEMBESIAN: 50 }, '2026-09-16', SPLIT)];
    const g = buildMaterialChain(input({ verifiedLines: flat })).groups[0];
    // Verified in the weeks of 7 and 14 Sep, so the pace was measured over 1 week, not 4; 12,5 % both weeks.
    expect(g.projectionNote).toBe('Tidak ada kenaikan progres terverifikasi dalam 1 minggu terakhir.');
    expect(g.relation).toMatchObject({ pacePerWeek: null, windowWeeks: null });
  });

  it('says so instead of projecting when the group is fully verified', () => {
    const done = [vline('k1', { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 100 }, '2026-08-26', SPLIT), vline('k2', { SINGLE: 100 }, '2026-09-02')];
    const g = buildMaterialChain(input({ verifiedLines: done })).groups[0];
    expect(g.today.verified).toBe(100);
    expect(g.projectionNote).toBe('Sudah 100 % terverifikasi.');
    expect(g.projected.every((v) => v === null)).toBe(true);
  });

  it('says it is done even when the whole group was verified in one week', () => {
    const oneWeek = [vline('k1', { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 100 }, '2026-08-26', SPLIT), vline('k2', { SINGLE: 100 }, '2026-08-26')];
    const g = buildMaterialChain(input({ verifiedLines: oneWeek })).groups[0];
    // Both rows verified in the week of 24 Aug: there is no second week, but there is also nothing left to project.
    expect(g.today.verified).toBe(100);
    expect(g.projectionNote).toBe('Sudah 100 % terverifikasi.');
  });

  it('needs verified progress in two different weeks before it projects', () => {
    const g = buildMaterialChain(input({ verifiedLines: verifiedLines.slice(0, 1) })).groups[0];
    expect(g.projectionNote).toBe('Belum cukup data: proyeksi butuh progres terverifikasi di dua minggu berbeda.');
    expect(g.projected.every((v) => v === null)).toBe(true);
    expect(g.relation.coverNote).toBe('belum ada laju');
  });

  it('turns confirmed diary lines into Berjalan 50 / Selesai 100 on the group’s stage, floored at verified', () => {
    const lines = [
      dline('l1', 'k1', 'PEMBESIAN', 'SELESAI', '2026-08-20', 3),
      dline('l2', 'k1', 'BEKISTING', 'SELESAI', '2026-08-21', 4),
      dline('l3', 'k2', 'BEKISTING', 'MULAI', '2026-09-10', 9),
    ];
    const g = buildMaterialChain(input({ verifiedLines, diary: { lines, readable: true } })).groups[0];
    // 17 Aug: k1 selesai → 1 000 of 4 000. 7 Sep: k1 verified 100 %, k2 (single) mulai → 50 % of 3 000, above its verified 25 %.
    expect(g.diary.slice(0, 6)).toEqual([0, 25, 25, 25, 62.5, 62.5]);
    expect(g.today.diary).toBe(62.5);
    expect(g.diaryReadable).toBe(true);
  });

  it('draws no diary series when the diary cannot be read, and none before any diary or verified row exists', () => {
    const unreadable = buildMaterialChain(input({ verifiedLines, diary: { lines: [], readable: false } })).groups[0];
    expect(unreadable.diary.every((v) => v === null)).toBe(true);
    expect(unreadable.diaryReadable).toBe(false);
    // A group the diary never mentions has no diary line of its own, even where it is verified.
    const verifiedOnly = buildMaterialChain(input({ verifiedLines })).groups[0];
    expect(verifiedOnly.diary.every((v) => v === null)).toBe(true);
    expect(verifiedOnly.diaryReadable).toBe(true);
    const empty = buildMaterialChain(input()).groups[0];
    expect(empty.diary.every((v) => v === null)).toBe(true);
    expect(empty.verified.every((v) => v === null)).toBe(true);
  });
});

describe('buildMaterialChain verified_pct shapes', () => {
  it('reads a whole-row figure for a split row whose snapshot says it was claimed as one stage', () => {
    // k1 was split after this line was verified whole: 40 % of its 1 000 kg is 10 % of the group's 4 000 kg.
    const g = buildMaterialChain(input({ verifiedLines: [vline('k1', { SINGLE: 40 }, '2026-08-26', WHOLE)] })).groups[0];
    expect(g.today.verified).toBe(10);
  });

  it('combines a single-stage row’s stage figures with the weights its own snapshot carries', () => {
    // k2 is SINGLE now, but this line was verified while it was split: 0,3 × 100 + 0,4 × 50 = 50 % of its 3 000 kg, so 37,5 % of 4 000 kg.
    const g = buildMaterialChain(input({ verifiedLines: [vline('k2', { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, '2026-08-26', SPLIT)] })).groups[0];
    expect(g.today.verified).toBe(37.5);
  });

  it('counts nothing when the line carries no usable snapshot to read its shape with', () => {
    const noSnapshot = [vline('k2', { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 100 }, '2026-08-26', null)];
    expect(buildMaterialChain(input({ verifiedLines: noSnapshot })).groups[0].today.verified).toBe(0);
    const invalid = [vline('k2', { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 100 }, '2026-08-26', { BEKISTING: 0.9, PEMBESIAN: 0.9, PENGECORAN: 0.9 })];
    expect(buildMaterialChain(input({ verifiedLines: invalid })).groups[0].today.verified).toBe(0);
  });

  it('reads a split row in a category that feeds no single stage as the whole row', () => {
    const bata = buildMaterialChain(input({
      weights: [...weights, { boq_item_id: 'd1', weights: { BEKISTING: 0.3, PEMBESIAN: 0.4, PENGECORAN: 0.3 } }],
      verifiedLines: [vline('d1', { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, '2026-08-26', SPLIT)],
    })).groups.find((g) => g.key === 'Dinding · pcs');
    // Dinding feeds Pasangan, not a weight-bearing stage, so d1 counts 0,3 × 100 + 0,4 × 50 + 0,3 × 0 = 50 % of its 500 pcs.
    expect(bata?.today.verified).toBe(50);
  });

  it('takes no percent from a claim it cannot read', () => {
    const odd = [
      { boq_item_id: 'k1', verified_pct: 'lunas', weights_snapshot: SPLIT, verified_at: '2026-08-26T03:00:00Z' },
      { boq_item_id: 'k2', verified_pct: { SINGLE: '25' }, weights_snapshot: WHOLE, verified_at: '2026-09-02T03:00:00Z' },
    ];
    const g = buildMaterialChain(input({ verifiedLines: odd })).groups[0];
    expect(g.today.verified).toBe(0);
    expect(g.projectionNote).toBe('Tidak ada kenaikan progres terverifikasi dalam 3 minggu terakhir.');
  });
});

describe('buildMaterialChain relation', () => {
  it('reports stock, lead and cover when approvals run ahead of installation', () => {
    const more = [...requests, req('besi16', 2000, 'APPROVED', '2026-08-17', '2026-08-19')];
    const g = buildMaterialChain(input({ requests: more, verifiedLines })).groups[0];
    expect(g.approved.slice(0, 6)).toEqual([12.5, 62.5, 62.5, 62.5, 62.5, 62.5]);
    expect(g.requested.slice(0, 6)).toEqual([12.5, 85, 85, 85, 85, 85]);
    // Both stock figures come from the quantities: 2 500 kg approved − 1 750 kg verified (1 000 + 750) = 750 kg, and 750 / 4 000 = 18,75 → 18,8 points.
    expect(g.relation).toMatchObject({ stockPts: 18.8, stockQty: 750, stockNote: null, leadWeeks: 4, leadWeekIndex: 1, leadNote: null, coverWeeks: 2, coverNote: null });
    expect(g.warnings).toEqual([]);
  });

  it('shows a negative stock and warns when installation outruns what was approved', () => {
    const g = buildMaterialChain(input({ verifiedLines })).groups[0];
    // 500 kg approved − 1 750 kg verified = −1 250 kg; −1 250 / 4 000 = −31,25, and a half rounds towards +∞, so −31,2 points.
    expect(g.relation).toMatchObject({ stockPts: -31.2, stockQty: -1250, leadWeeks: null, leadNote: 'belum bisa dihitung', coverWeeks: null, coverNote: 'tidak ada stok tersisa' });
    expect(g.warnings).toEqual(['Pekerjaan melebihi material yang disetujui: terpasang 43,8 %, disetujui 12,5 %.']);
  });

  it('says why each number is missing when nothing is verified', () => {
    const g = buildMaterialChain(input()).groups[0];
    expect(g.relation).toMatchObject({ stockPts: null, stockQty: null, stockNote: 'belum ada progres terverifikasi', leadNote: 'belum bisa dihitung', coverNote: 'belum ada laju', pacePerWeek: null });
    expect(g.warnings).toEqual([]);
  });
});
