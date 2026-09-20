// tools/analytics/materialChain.ts
// SANO — Material vs progres (spec 2026-09-20 §5): per material group, what
// was requested and approved against what the verified claims and the daily
// reports say is installed, week by week, with the stock, lead and cover that
// follow. The BoQ material plan per work area is the bridge from a stage
// percent to a quantity. Pure; nothing here is estimated.
import type { DiaryLine } from '../progressClaims/diaryEvidence';
import { rowFraction, type StagePct } from '../progressClaims/stageMath';
import { pctOfStatus, statusOfActivity } from '../progressClaims/statusCredit';
import { isSingle, validateStageWeights, SINGLE_WEIGHTS, type StageKey, type StageWeights } from '../progressClaims/stageWeights';
import type { WeightBearingStage } from '../reportLineDraftValidate';
import { addCalendarDays } from '../timeWindow';
import { CATEGORY_WORK, materialGroupOf, type CatalogEntry, type PlannedLine, type RequestedLine } from './materialCoverage';
import { dateOf, daysBetween, weekOf, weeksBetween } from './weekBuckets';
import { WORK_TYPE_LABELS } from './workType';

export const PACE_WINDOW_WEEKS = 4;
export const PROJECTION_MAX_WEEKS = 16;
/** Terpasang may run this many points above Disetujui before the card warns (the claim flag's tolerance). */
export const OVERRUN_TOLERANCE_PTS = 10;

/** The claim stage a catalogue category feeds; other categories feed the row as a whole. */
const CATEGORY_STAGE: Record<string, WeightBearingStage> = { Struktur: 'PEMBESIAN', 'Kayu & Bekisting': 'BEKISTING', 'Material Beton': 'PENGECORAN' };
const SHORT_NAME: Record<string, string> = { Struktur: 'Besi', 'Kayu & Bekisting': 'Bekisting', Dinding: 'Bata', Plumbing: 'Pipa' };

export interface VerifiedClaimLine { boq_item_id: string; verified_pct: unknown; verified_at: string }
export interface StageWeightInput { boq_item_id: string; weights: unknown }

export interface MaterialChainInput {
  /** Today as a WIB date. */
  today: string;
  planned: ReadonlyArray<PlannedLine>;
  requests: ReadonlyArray<RequestedLine>;
  catalog: ReadonlyMap<string, CatalogEntry>;
  weights: ReadonlyArray<StageWeightInput>;
  verifiedLines: ReadonlyArray<VerifiedClaimLine>;
  diary: { lines: ReadonlyArray<DiaryLine>; readable: boolean };
}

export interface ChainRelation {
  /** Disetujui − Terpasang, in points and in the group's unit; null with a note when nothing is verified. */
  stockPts: number | null;
  stockQty: number | null;
  stockNote: string | null;
  leadWeeks: number | null;
  /** Index in `weeks` where Disetujui first reached today's Terpasang. */
  leadWeekIndex: number | null;
  leadNote: string | null;
  coverWeeks: number | null;
  coverNote: string | null;
  pacePerWeek: number | null;
  windowWeeks: number | null;
}

export interface ChainGroup {
  /** "Struktur · kg" */
  key: string;
  category: string;
  unit: string;
  shortName: string;
  workLabel: string | null;
  /** "Besi (kg) → Pembesian" */
  chipLabel: string;
  planned: number;
  /** Work areas with a planned quantity of this group. */
  rows: number;
  weeks: string[];
  thisWeekIndex: number;
  requested: Array<number | null>;
  approved: Array<number | null>;
  verified: Array<number | null>;
  diary: Array<number | null>;
  projected: Array<number | null>;
  today: { requested: number; approved: number; verified: number | null; diary: number | null };
  relation: ChainRelation;
  warnings: string[];
  projectionNote: string | null;
  diaryReadable: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const endOf = (week: string) => addCalendarDays(week, 6);
const fmt = (n: number) => round1(n).toLocaleString('id-ID');

export function shortGroupName(category: string, unit: string): string {
  if (category === 'Material Beton') return unit === 'zak' ? 'Semen' : unit === 'm3' || unit === 'm³' ? 'Readymix' : 'Beton';
  return SHORT_NAME[category] ?? category;
}

function parsePct(raw: unknown): StagePct {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: StagePct = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k as StageKey] = Math.min(100, Math.max(0, v));
  }
  return out;
}

/** The share of a row this group counts: its stage when the row is split and the group feeds a stage; the row as a whole otherwise. */
function rowPct(weights: StageWeights, pct: StagePct, stage: WeightBearingStage | null): number {
  if (isSingle(weights)) return pct.SINGLE ?? 0;
  if (stage) return pct[stage] ?? 0;
  return rowFraction(weights, pct) * 100;
}

interface RowState { planned: number; weights: StageWeights; verified: Array<{ at: string; pct: StagePct }>; diary: DiaryLine[] }

const diaryOrder = (l: DiaryLine) => `${l.period_end}|${String(l.report_no).padStart(6, '0')}|${String(l.line_index).padStart(4, '0')}`;

export function buildMaterialChain(input: MaterialChainInput): { groups: ChainGroup[]; unplannedRequested: string[] } {
  const thisWeek = weekOf(input.today);
  const weightsByRow = new Map<string, StageWeights>();
  for (const w of input.weights) { const v = validateStageWeights(w.weights); if (v.ok) weightsByRow.set(w.boq_item_id, v.weights); }

  // Plan per group and per row.
  const plans = new Map<string, { category: string; unit: string; rows: Map<string, RowState> }>();
  for (const p of input.planned) {
    const g = materialGroupOf(input.catalog, p.material_id);
    const q = Number(p.planned_quantity) || 0;
    if (!g || !p.boq_item_id || q <= 0) continue;
    if (!plans.has(g.key)) plans.set(g.key, { category: g.category, unit: g.unit, rows: new Map() });
    const rows = plans.get(g.key)!.rows;
    const row = rows.get(p.boq_item_id) ?? { planned: 0, weights: weightsByRow.get(p.boq_item_id) ?? SINGLE_WEIGHTS, verified: [], diary: [] };
    row.planned += q;
    rows.set(p.boq_item_id, row);
  }

  // Requests per group: (week, qty) events for Diminta and Disetujui.
  const events = new Map<string, { requested: Array<[string, number]>; approved: Array<[string, number]> }>();
  const unplanned = new Set<string>();
  for (const r of input.requests) {
    const g = materialGroupOf(input.catalog, r.material_id);
    if (!g || r.status === 'REJECTED') continue;
    if (!plans.has(g.key)) { unplanned.add(`${g.category} (${g.unit})`); continue; }
    if (!events.has(g.key)) events.set(g.key, { requested: [], approved: [] });
    const e = events.get(g.key)!;
    const qty = Number(r.quantity) || 0;
    e.requested.push([weekOf(r.created_at), qty]);
    if (r.status === 'APPROVED') e.approved.push([weekOf(r.reviewed_at ?? r.created_at), qty]);
  }

  const groups: ChainGroup[] = [];
  for (const [key, plan] of plans) {
    const stage = CATEGORY_STAGE[plan.category] ?? null;
    for (const v of input.verifiedLines) plan.rows.get(v.boq_item_id)?.verified.push({ at: v.verified_at, pct: parsePct(v.verified_pct) });
    for (const l of input.diary.lines) {
      const row = l.boq_item_id ? plan.rows.get(l.boq_item_id) : null;
      if (!row) continue;
      if (!isSingle(row.weights) && stage && l.stage !== stage) continue;
      row.diary.push(l);
    }
    for (const row of plan.rows.values()) {
      row.verified.sort((a, b) => a.at.localeCompare(b.at));
      row.diary.sort((a, b) => diaryOrder(a).localeCompare(diaryOrder(b)));
    }
    groups.push(buildGroup(key, plan, stage, events.get(key) ?? { requested: [], approved: [] }, thisWeek, input.diary.readable));
  }
  groups.sort((a, b) => b.planned - a.planned || a.key.localeCompare(b.key));
  return { groups, unplannedRequested: [...unplanned].sort() };
}

function buildGroup(
  key: string,
  plan: { category: string; unit: string; rows: Map<string, RowState> },
  stage: WeightBearingStage | null,
  events: { requested: Array<[string, number]>; approved: Array<[string, number]> },
  thisWeek: string,
  diaryReadable: boolean,
): ChainGroup {
  const rows = [...plan.rows.values()];
  const planned = rows.reduce((s, r) => s + r.planned, 0);
  const pctOfPlan = (q: number) => (planned > 0 ? round1((100 * q) / planned) : 0);
  const hasVerified = rows.some((r) => r.verified.length > 0);
  const hasDiary = diaryReadable && rows.some((r) => r.diary.length > 0);

  const firstWeek = [
    ...events.requested.map(([w]) => w),
    ...rows.flatMap((r) => r.verified.map((v) => weekOf(v.at))),
    ...rows.flatMap((r) => r.diary.map((l) => weekOf(l.period_end))),
    thisWeek,
  ].sort()[0];

  // Cumulative figures at each week's end, up to this week.
  const cum = (list: Array<[string, number]>, w: string) => list.reduce((s, [ew, q]) => (ew <= w ? s + q : s), 0);
  const verifiedAt = (row: RowState, end: string) => {
    let latest: StagePct | null = null;
    for (const v of row.verified) { if (dateOf(v.at) <= end) latest = v.pct; else break; }
    return latest ? rowPct(row.weights, latest, stage) : 0;
  };
  const diaryAt = (row: RowState, end: string) => {
    let latest: DiaryLine | null = null;
    for (const l of row.diary) { if (l.period_end <= end) latest = l; else break; }
    return latest ? pctOfStatus(statusOfActivity(latest.activity_state)) : 0;
  };
  const installedAt = (end: string) => {
    let v = 0;
    let d = 0;
    for (const row of rows) {
      const vp = verifiedAt(row, end);
      v += (row.planned * vp) / 100;
      d += (row.planned * Math.max(vp, diaryAt(row, end))) / 100;
    }
    return { verified: pctOfPlan(v), diary: pctOfPlan(d) };
  };

  const pastWeeks = weeksBetween(firstWeek, thisWeek);
  const series = pastWeeks.map((w) => {
    const end = endOf(w);
    const inst = installedAt(end);
    return { week: w, requested: pctOfPlan(cum(events.requested, w)), approved: pctOfPlan(cum(events.approved, w)), verified: hasVerified ? inst.verified : null, diary: hasDiary || hasVerified ? (diaryReadable ? inst.diary : null) : null };
  });
  const now = series[series.length - 1];

  // Projection at the pace of the last four calendar weeks, as the S-curve does.
  const verifiedWeeks = [...new Set(rows.flatMap((r) => r.verified.map((v) => weekOf(v.at))))].sort();
  let pace: number | null = null;
  let windowWeeks: number | null = null;
  let projectionNote: string | null = null;
  if (!hasVerified) projectionNote = 'Belum ada progres terverifikasi.';
  else if (verifiedWeeks.length < 2) projectionNote = 'Belum cukup data: proyeksi butuh progres terverifikasi di dua minggu berbeda.';
  else if ((now.verified as number) < 100) {
    // A const so the closure below keeps the narrowing `windowWeeks` (a `let`) loses.
    const window = Math.max(1, Math.min(PACE_WINDOW_WEEKS, Math.round(daysBetween(verifiedWeeks[0], thisWeek) / 7)));
    windowWeeks = window;
    const before = series.find((s) => s.week === addCalendarDays(thisWeek, -7 * window))?.verified ?? 0;
    const p = round1(((now.verified as number) - before) / window);
    if (p > 0) pace = p; else projectionNote = `Tidak ada kenaikan progres terverifikasi dalam ${PACE_WINDOW_WEEKS} minggu terakhir.`;
  }
  const stepsToFull = pace ? Math.min(PROJECTION_MAX_WEEKS, Math.ceil((100 - (now.verified as number)) / pace)) : 0;
  const weeks = weeksBetween(firstWeek, addCalendarDays(thisWeek, 7 * stepsToFull));
  const thisWeekIndex = pastWeeks.length - 1;
  const at = <K extends 'requested' | 'approved' | 'verified' | 'diary'>(k: K) => weeks.map((w, i) => (i <= thisWeekIndex ? series[i][k] : null));
  const projected = weeks.map((w, i) => (pace === null || i < thisWeekIndex ? null : Math.min(100, round1((now.verified as number) + (i - thisWeekIndex) * pace))));

  // The relation between what was approved and what is installed.
  const A = now.approved;
  const T = now.verified;
  const relation: ChainRelation = {
    stockPts: null, stockQty: null, stockNote: null, leadWeeks: null, leadWeekIndex: null, leadNote: null,
    coverWeeks: null, coverNote: null, pacePerWeek: pace, windowWeeks,
  };
  if (T === null) {
    relation.stockNote = 'belum ada progres terverifikasi';
    relation.leadNote = 'belum bisa dihitung';
    relation.coverNote = 'belum ada laju';
  } else {
    relation.stockPts = round1(A - T);
    relation.stockQty = round1(((A - T) * planned) / 100);
    if (T <= 0 || A < T) relation.leadNote = 'belum bisa dihitung';
    else {
      const idx = series.findIndex((s) => s.approved >= T);
      relation.leadWeekIndex = idx;
      relation.leadWeeks = Math.round(daysBetween(series[idx].week, thisWeek) / 7);
    }
    if (pace === null) relation.coverNote = 'belum ada laju';
    else if (A <= T) relation.coverNote = 'tidak ada stok tersisa';
    else relation.coverWeeks = Math.round((A - T) / pace);
  }
  const warnings: string[] = [];
  if (T !== null && T - A > OVERRUN_TOLERANCE_PTS) warnings.push(`Pekerjaan melebihi material yang disetujui: terpasang ${fmt(T)} %, disetujui ${fmt(A)} %.`);

  const workType = CATEGORY_WORK[plan.category] ?? null;
  const workLabel = workType ? WORK_TYPE_LABELS[workType] : null;
  const shortName = shortGroupName(plan.category, plan.unit);
  return {
    key, category: plan.category, unit: plan.unit, shortName, workLabel,
    chipLabel: `${shortName} (${plan.unit})${workLabel ? ` → ${workLabel}` : ''}`,
    planned: round1(planned), rows: rows.length, weeks, thisWeekIndex,
    requested: at('requested'), approved: at('approved'), verified: at('verified'), diary: at('diary'), projected,
    today: { requested: now.requested, approved: now.approved, verified: now.verified, diary: now.diary },
    relation, warnings, projectionNote, diaryReadable,
  };
}
