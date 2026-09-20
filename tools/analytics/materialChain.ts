// tools/analytics/materialChain.ts
// SANO — Material vs progres (spec 2026-09-20 §5): per material group, what
// was requested and approved against what the verified claims and the daily
// reports say is installed, week by week, with the stock, lead and cover that
// follow. The BoQ material plan per work area is the bridge from a stage
// percent to a quantity. Pure; nothing here is estimated.
//
// Upstream contracts: `diary.lines` must already hold the latest revision of
// each report (`listDiaryLines` does that) and `verifiedLines` must already be
// the lines of VERIFIED claims only (`loadVerifiedClaimLines` does that); two
// claim lines sharing a `verified_at` keep their input order (stable sort).
import type { DiaryLine } from '../progressClaims/diaryEvidence';
import { rowFraction, type StagePct } from '../progressClaims/stageMath';
import { pctOfStatus, statusOfActivity } from '../progressClaims/statusCredit';
import { isSingle, validateStageWeights, SINGLE_WEIGHTS, type StageKey, type StageWeights } from '../progressClaims/stageWeights';
import { isWeightBearingStage, type WeightBearingStage } from '../reportLineDraftValidate';
import { addCalendarDays } from '../timeWindow';
import { CATEGORY_WORK, materialGroupOf, type CatalogEntry, type PlannedLine, type RequestedLine } from './materialCoverage';
import { dateOf, daysBetween, weekOf, weeksBetween } from './weekBuckets';
import { WORK_TYPE_LABELS } from './workType';

export const PACE_WINDOW_WEEKS = 4;
export const PROJECTION_MAX_WEEKS = 16;
/** Terpasang may run this many points above Disetujui before the card warns (the claim flag's tolerance). */
export const OVERRUN_TOLERANCE_PTS = 10;

/** The claim stage a catalogue category feeds: its work type when that is a weight-bearing stage. Other categories feed the row as a whole. */
const CATEGORY_STAGE: Record<string, WeightBearingStage> = {};
for (const [category, work] of Object.entries(CATEGORY_WORK)) if (isWeightBearingStage(work)) CATEGORY_STAGE[category] = work;

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
  /** The chart's denominator: the plan tied to work areas, so every series is comparable. */
  planned: number;
  /** Planned for the project without naming a work area: reported beside the chart, never in its denominator. */
  plannedWithoutArea: number;
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

/**
 * The share of a row this group counts: its stage when the row is split and the group feeds a stage; the row as a
 * whole otherwise. A claim stored under the other shape (the row's weights changed after it was verified) still
 * answers: a whole-row figure stands in for the missing stage, and stage figures are combined with the row's
 * current weights — which for a now-single row credit nothing, since the weights they were claimed under are gone.
 */
function rowPct(weights: StageWeights, pct: StagePct, stage: WeightBearingStage | null): number {
  if (isSingle(weights)) return pct.SINGLE ?? rowFraction(weights, pct) * 100;
  if (stage) return pct[stage] ?? pct.SINGLE ?? 0;
  return rowFraction(weights, pct) * 100;
}

interface RowState { planned: number; weights: StageWeights; verified: Array<{ at: string; pct: StagePct }>; diary: DiaryLine[] }
interface GroupPlan { category: string; unit: string; rows: Map<string, RowState>; withoutArea: number }
interface RequestEvents { requested: Array<[string, number]>; approved: Array<[string, number]> }

interface WeekPoint {
  week: string;
  requested: number;
  approved: number;
  /** The approved quantity itself, in the group's unit: the stock is a quantity, not a rounded percent. */
  approvedQty: number;
  verified: number | null;
  verifiedQty: number | null;
  diary: number | null;
}

interface Projection { pace: number | null; windowWeeks: number | null; note: string | null }

/** Oldest first, by the status board's own tie-break (`newestFirst` in diaryEvidence, reversed), so both pick the same latest line. */
const oldestFirst = (a: DiaryLine, b: DiaryLine) =>
  a.period_end.localeCompare(b.period_end) || (a.issued_at ?? '').localeCompare(b.issued_at ?? '') || a.line_index - b.line_index;

export function buildMaterialChain(input: MaterialChainInput): { groups: ChainGroup[]; unplannedRequested: string[]; planWithoutAreaOnly: string[] } {
  const thisWeek = weekOf(input.today);
  const weightsByRow = new Map<string, StageWeights>();
  for (const w of input.weights) { const v = validateStageWeights(w.weights); if (v.ok) weightsByRow.set(w.boq_item_id, v.weights); }

  // Plan per group: per work area, and what the project plans without naming one.
  const plans = new Map<string, GroupPlan>();
  for (const p of input.planned) {
    const g = materialGroupOf(input.catalog, p.material_id);
    const q = Number(p.planned_quantity) || 0;
    if (!g || q <= 0) continue;
    if (!plans.has(g.key)) plans.set(g.key, { category: g.category, unit: g.unit, rows: new Map(), withoutArea: 0 });
    const plan = plans.get(g.key)!;
    if (!p.boq_item_id) { plan.withoutArea += q; continue; }
    const row = plan.rows.get(p.boq_item_id) ?? { planned: 0, weights: weightsByRow.get(p.boq_item_id) ?? SINGLE_WEIGHTS, verified: [], diary: [] };
    row.planned += q;
    plan.rows.set(p.boq_item_id, row);
  }

  // Requests per group: (week, qty) events for Diminta and Disetujui.
  const events = new Map<string, RequestEvents>();
  const unplanned = new Set<string>();
  for (const r of input.requests) {
    const g = materialGroupOf(input.catalog, r.material_id);
    if (!g || r.status === 'REJECTED') continue;
    if (!plans.has(g.key)) { unplanned.add(`${g.category} (${g.unit})`); continue; }
    const qty = Number(r.quantity) || 0;
    if (qty <= 0) continue;
    if (!events.has(g.key)) events.set(g.key, { requested: [], approved: [] });
    const e = events.get(g.key)!;
    e.requested.push([weekOf(r.created_at), qty]);
    if (r.status === 'APPROVED') e.approved.push([weekOf(r.reviewed_at ?? r.created_at), qty]);
  }

  const groups: ChainGroup[] = [];
  const planWithoutAreaOnly: string[] = [];
  for (const [key, plan] of plans) {
    // A group is charted on its work areas; one planned only for the project as a whole is reported instead.
    if (plan.rows.size === 0) { planWithoutAreaOnly.push(`${plan.category} (${plan.unit}) ${fmt(plan.withoutArea)} ${plan.unit}`); continue; }
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
      row.diary.sort(oldestFirst);
    }
    groups.push(buildGroup(key, plan, stage, events.get(key) ?? { requested: [], approved: [] }, thisWeek, input.diary.readable));
  }
  groups.sort((a, b) => b.planned - a.planned || a.key.localeCompare(b.key));
  return { groups, unplannedRequested: [...unplanned].sort(), planWithoutAreaOnly: planWithoutAreaOnly.sort() };
}

/** The pace of the last weeks, or why there is none. The note names the window it actually measured. */
function projectionOf(series: ReadonlyArray<WeekPoint>, verifiedWeeks: ReadonlyArray<string>, verifiedNow: number | null, thisWeek: string): Projection {
  const none = (note: string) => ({ pace: null, windowWeeks: null, note });
  if (verifiedNow === null) return none('Belum ada progres terverifikasi.');
  if (verifiedWeeks.length < 2) return none('Belum cukup data: proyeksi butuh progres terverifikasi di dua minggu berbeda.');
  if (verifiedNow >= 100) return none('Sudah 100 % terverifikasi.');
  const windowWeeks = Math.max(1, Math.min(PACE_WINDOW_WEEKS, Math.round(daysBetween(verifiedWeeks[0], thisWeek) / 7)));
  const before = series.find((s) => s.week === addCalendarDays(thisWeek, -7 * windowWeeks))?.verified ?? 0;
  const pace = round1((verifiedNow - before) / windowWeeks);
  if (pace <= 0) return none(`Tidak ada kenaikan progres terverifikasi dalam ${windowWeeks} minggu terakhir.`);
  return { pace, windowWeeks, note: null };
}

/** The relation between what was approved and what is installed, each number with its reason when it has none. */
function relationOf(series: ReadonlyArray<WeekPoint>, now: WeekPoint, projection: Projection, thisWeek: string): ChainRelation {
  const relation: ChainRelation = {
    stockPts: null, stockQty: null, stockNote: null, leadWeeks: null, leadWeekIndex: null, leadNote: null,
    coverWeeks: null, coverNote: null, pacePerWeek: projection.pace, windowWeeks: projection.windowWeeks,
  };
  const { approved: A, approvedQty, verified: T, verifiedQty } = now;
  if (T === null || verifiedQty === null) {
    relation.stockNote = 'belum ada progres terverifikasi';
    relation.leadNote = 'belum bisa dihitung';
    relation.coverNote = 'belum ada laju';
    return relation;
  }
  relation.stockPts = round1(A - T);
  // The quantity comes from the quantities themselves, never from the rounded points.
  relation.stockQty = round1(approvedQty - verifiedQty);
  if (T <= 0 || A < T) relation.leadNote = 'belum bisa dihitung';
  else {
    const idx = series.findIndex((s) => s.approved >= T);
    relation.leadWeekIndex = idx;
    relation.leadWeeks = Math.round(daysBetween(series[idx].week, thisWeek) / 7);
  }
  if (projection.pace === null) relation.coverNote = 'belum ada laju';
  else if (A <= T) relation.coverNote = 'tidak ada stok tersisa';
  else relation.coverWeeks = Math.round((A - T) / projection.pace);
  return relation;
}

function buildGroup(
  key: string,
  plan: GroupPlan,
  stage: WeightBearingStage | null,
  events: RequestEvents,
  thisWeek: string,
  diaryReadable: boolean,
): ChainGroup {
  const rows = [...plan.rows.values()];
  const planned = rows.reduce((s, r) => s + r.planned, 0);
  const pctOfPlan = (q: number) => (planned > 0 ? round1((100 * q) / planned) : 0);
  const hasVerified = rows.some((r) => r.verified.length > 0);
  const hasDiary = rows.some((r) => r.diary.length > 0);

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
    return { verified: pctOfPlan(v), verifiedQty: v, diary: pctOfPlan(d) };
  };

  const pastWeeks = weeksBetween(firstWeek, thisWeek);
  const series: WeekPoint[] = pastWeeks.map((w) => {
    const inst = installedAt(endOf(w));
    const approvedQty = cum(events.approved, w);
    return {
      week: w,
      requested: pctOfPlan(cum(events.requested, w)),
      approved: pctOfPlan(approvedQty),
      approvedQty,
      verified: hasVerified ? inst.verified : null,
      verifiedQty: hasVerified ? inst.verifiedQty : null,
      diary: diaryReadable && hasDiary ? inst.diary : null,
    };
  });
  const now = series[series.length - 1];
  const verifiedNow = now.verified;

  // Projection at the pace of the last calendar weeks, as the S-curve does.
  const verifiedWeeks = [...new Set(rows.flatMap((r) => r.verified.map((v) => weekOf(v.at))))].sort();
  const projection = projectionOf(series, verifiedWeeks, verifiedNow, thisWeek);
  const pace = projection.pace;

  const stepsToFull = pace === null || verifiedNow === null ? 0 : Math.min(PROJECTION_MAX_WEEKS, Math.ceil((100 - verifiedNow) / pace));
  const weeks = weeksBetween(firstWeek, addCalendarDays(thisWeek, 7 * stepsToFull));
  const thisWeekIndex = pastWeeks.length - 1;
  const at = <K extends 'requested' | 'approved' | 'verified' | 'diary'>(k: K) => weeks.map((_, i) => (i <= thisWeekIndex ? series[i][k] : null));
  const projected = weeks.map((_, i) =>
    pace === null || verifiedNow === null || i < thisWeekIndex ? null : Math.min(100, round1(verifiedNow + (i - thisWeekIndex) * pace)));

  const relation = relationOf(series, now, projection, thisWeek);
  const warnings: string[] = [];
  if (verifiedNow !== null && verifiedNow - now.approved > OVERRUN_TOLERANCE_PTS) {
    warnings.push(`Pekerjaan melebihi material yang disetujui: terpasang ${fmt(verifiedNow)} %, disetujui ${fmt(now.approved)} %.`);
  }

  const workType = CATEGORY_WORK[plan.category] ?? null;
  const workLabel = workType ? WORK_TYPE_LABELS[workType] : null;
  const shortName = shortGroupName(plan.category, plan.unit);
  return {
    key, category: plan.category, unit: plan.unit, shortName, workLabel,
    chipLabel: `${shortName} (${plan.unit})${workLabel ? ` → ${workLabel}` : ''}`,
    planned: round1(planned), plannedWithoutArea: round1(plan.withoutArea), rows: rows.length, weeks, thisWeekIndex,
    requested: at('requested'), approved: at('approved'), verified: at('verified'), diary: at('diary'), projected,
    today: { requested: now.requested, approved: now.approved, verified: now.verified, diary: now.diary },
    relation, warnings, projectionNote: projection.note, diaryReadable,
  };
}
