// tools/progressClaims/claimView.ts
// SANO — pure view model for the weekly stage claim screens (spec §6.2, §16, §17).
// No I/O: the screens load rows, weights, verified figures and claim lines
// through tools/progressClaims/claims.ts and hand them here.
import { todayIsoWIB } from '../timeWindow';
import type { ClaimStatus } from './claimRules';
import { rowFraction, type StagePct } from './stageMath';
import { stageLabel } from './stages';
import {
  isSingle, stagesOf, validateStageWeights, weightsFromAmounts,
  type StageKey, type StageWeights, type WeightSource,
} from './stageWeights';
import { shortDateId, weekLabel } from './week';
import { classifyWorkAreas, type WorkAreaClass } from './workAreaClass';

/** The BoQ fields these screens read; tools/types.ts BoqItem satisfies it. */
export interface ClaimableItem {
  id: string;
  code: string;
  label: string;
  unit: string;
  planned: number;
  installed: number;
  progress: number;
  sort_order?: number | null;
  chapter?: string | null;
  sub_chapter?: string | null;
  superseded_at?: string | null;
}

const SIMPLIFIED_CODE_RE = /^T1-\d+$/;

/**
 * The rows a claim can name: live, planned > 0, in BoQ order. On a SANO Input
 * project only its T1 work areas count, exactly as buildWorkGroups treats them
 * (the Others anchor is not a work area).
 */
export function claimableRows<T extends ClaimableItem>(items: T[]): T[] {
  const live = items.filter((b) => (b.superseded_at ?? null) == null);
  const simplified = live.filter((b) => SIMPLIFIED_CODE_RE.test((b.code ?? '').trim()));
  const base = simplified.length > 0 ? simplified : live;
  return base
    .filter((b) => Number(b.planned) > 0)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code));
}

export const WORK_AREA_CLASS_LABELS: Record<WorkAreaClass, string> = {
  PILECAP_SLOOF_PLAT_DASAR: 'Pile cap, sloof & plat dasar',
  KOLOM: 'Kolom',
  BALOK_PLAT: 'Balok & plat',
  DINDING: 'Dinding',
  TANGGA: 'Tangga',
  BOREDPILE: 'Bored pile',
  LAINNYA: 'Lainnya',
};

export function stageKeyLabel(stage: StageKey): string {
  return stage === 'SINGLE' ? 'Progres' : stageLabel(stage);
}

export function weightSourceLabel(source: WeightSource | null, referenceClass: string | null): string {
  switch (source) {
    case 'reference': {
      const name = referenceClass && referenceClass in WORK_AREA_CLASS_LABELS
        ? WORK_AREA_CLASS_LABELS[referenceClass as WorkAreaClass]
        : referenceClass ?? '-';
      return `Bobot referensi (${name})`;
    }
    case 'manual':
      return 'Bobot diatur estimator';
    case 'rab':
      return 'Bobot dari RAB';
    case 'input_sheet':
      return 'Bobot dari SANO Input';
    default:
      return 'Bobot belum diatur';
  }
}

/** A boq_stage_weights row as read; weights stay unknown until validated. */
export interface WeightRowLike {
  boq_item_id: string;
  weights: unknown;
  source: WeightSource;
  reference_class: string | null;
}

/** Classes are decided across all the rows given, so the basement-first ground rule sees every floor. */
export function classifyRows(rows: ClaimableItem[]): Map<string, WorkAreaClass> {
  const classes = classifyWorkAreas(rows.map((r) => ({ label: r.label, chapter: r.chapter ?? null, sub_chapter: r.sub_chapter ?? null })));
  return new Map(rows.map((r, i) => [r.id, classes[i]]));
}

/** Rows that have no stored weights yet, each with the reference class its label implies. */
export function missingWeightSeeds(
  rows: ClaimableItem[],
  weights: WeightRowLike[],
): Array<{ boq_item_id: string; reference_class: WorkAreaClass }> {
  const have = new Set(weights.map((w) => w.boq_item_id));
  const classes = classifyRows(rows);
  return rows
    .filter((r) => !have.has(r.id))
    .map((r) => ({ boq_item_id: r.id, reference_class: classes.get(r.id) ?? 'LAINNYA' }));
}

/** A verified claim line with its claim embedded (PostgREST returns an object or a one-element array). */
export interface VerifiedLineRow {
  boq_item_id: string;
  verified_pct: StagePct | null;
  updated_at: string;
  progress_claims: { verified_at: string | null } | Array<{ verified_at: string | null }> | null;
}

/** The most recently verified stage percents per row. */
export function latestVerifiedByRow(rows: VerifiedLineRow[]): Map<string, StagePct> {
  const best = new Map<string, { at: string; pct: StagePct }>();
  for (const r of rows) {
    if (!r.verified_pct) continue;
    const claim = Array.isArray(r.progress_claims) ? r.progress_claims[0] : r.progress_claims;
    const at = `${claim?.verified_at ?? ''}|${r.updated_at}`;
    const current = best.get(r.boq_item_id);
    if (!current || at > current.at) best.set(r.boq_item_id, { at, pct: r.verified_pct });
  }
  return new Map([...best].map(([id, v]) => [id, v.pct]));
}

/** Spec §17: only the latest revision of each report number counts, so a re-issued report never counts twice. */
export function latestRevisionReportIds(reports: Array<{ id: string; report_no: number; revision: number }>): Set<string> {
  const best = new Map<number, { id: string; revision: number }>();
  for (const r of reports) {
    const current = best.get(r.report_no);
    if (!current || r.revision > current.revision) best.set(r.report_no, { id: r.id, revision: r.revision });
  }
  return new Set([...best.values()].map((v) => v.id));
}

export function countLinesByRow(
  lines: Array<{ boq_item_id: string | null; report_id: string }>,
  reportIds: Set<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of lines) {
    if (!l.boq_item_id || !reportIds.has(l.report_id)) continue;
    counts.set(l.boq_item_id, (counts.get(l.boq_item_id) ?? 0) + 1);
  }
  return counts;
}

/** A progress_claim_lines row as the screens need it. */
export interface ClaimLineLike {
  id: string;
  boq_item_id: string;
  prev_verified: StagePct;
  claimed_pct: StagePct;
  note: string | null;
  regress_reason: string | null;
  evidence: { photo_refs?: string[] } | null;
}

export interface ClaimRowView {
  item: ClaimableItem;
  weights: StageWeights | null;
  source: WeightSource | null;
  referenceClass: string | null;
  prevPct: StagePct;
  claimedPct: StagePct | null;
  lineId: string | null;
  note: string | null;
  regressReason: string | null;
  photoRefs: string[];
  /** 0..1; 0 when the row has no usable weights. */
  prevFraction: number;
  /** 0..1; null when this claim has no line for the row. */
  claimedFraction: number | null;
  linkedLines: number;
}

export function zeroPct(weights: StageWeights): StagePct {
  return Object.fromEntries(stagesOf(weights).map((s) => [s, 0])) as StagePct;
}

export function buildRowViews(
  rows: ClaimableItem[],
  weights: WeightRowLike[],
  verified: Map<string, StagePct>,
  lines: ClaimLineLike[],
  linked: Map<string, number> = new Map(),
): ClaimRowView[] {
  const weightByRow = new Map(weights.map((w) => [w.boq_item_id, w]));
  const lineByRow = new Map(lines.map((l) => [l.boq_item_id, l]));
  return rows.map((item) => {
    const stored = weightByRow.get(item.id);
    const checked = stored ? validateStageWeights(stored.weights) : null;
    const usable = checked && checked.ok ? checked.weights : null;
    const line = lineByRow.get(item.id) ?? null;
    const prevPct = verified.get(item.id) ?? line?.prev_verified ?? (usable ? zeroPct(usable) : {});
    const refs = line?.evidence?.photo_refs;
    return {
      item,
      weights: usable,
      source: usable && stored ? stored.source : null,
      referenceClass: usable && stored ? stored.reference_class : null,
      prevPct,
      claimedPct: line?.claimed_pct ?? null,
      lineId: line?.id ?? null,
      note: line?.note ?? null,
      regressReason: line?.regress_reason ?? null,
      photoRefs: Array.isArray(refs) ? refs.filter((r): r is string => typeof r === 'string') : [],
      prevFraction: usable ? rowFraction(usable, prevPct) : 0,
      claimedFraction: usable && line ? rowFraction(usable, line.claimed_pct) : null,
      linkedLines: linked.get(item.id) ?? 0,
    };
  });
}

export type ClaimFlag = 'OK' | 'INFO' | 'WARNING' | 'HIGH';

export interface ClaimHeader {
  status: ClaimStatus;
  week_start: string;
  verified_at: string | null;
  return_note: string | null;
}

export function claimStatusSummary(claim: ClaimHeader | null): { label: string; flag: ClaimFlag; detail: string } {
  if (!claim) {
    return { label: 'Belum ada klaim', flag: 'INFO', detail: 'Klaim minggu ini dibuka saat progres pertama disimpan.' };
  }
  const week = weekLabel(claim.week_start);
  switch (claim.status) {
    case 'DRAFT':
      return { label: 'Belum dikirim', flag: 'WARNING', detail: week };
    case 'SUBMITTED':
      return { label: 'Menunggu verifikasi', flag: 'INFO', detail: week };
    case 'RETURNED':
      return { label: 'Dikembalikan', flag: 'HIGH', detail: claim.return_note ? `${week}: ${claim.return_note}` : week };
    case 'VERIFIED':
    default:
      return {
        label: 'Terverifikasi',
        flag: 'OK',
        detail: claim.verified_at ? `${week}, diverifikasi ${shortDateId(todayIsoWIB(new Date(claim.verified_at)))}` : week,
      };
  }
}

/** "42,5" or "42.5" gives 42.5 (one decimal kept); blank gives null; anything else or above 100 gives NaN. */
export function parsePercentInput(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  if (!/^\d{1,3}(\.\d+)?$/.test(t)) return Number.NaN;
  const n = Number(t);
  return n <= 100 ? Math.round(n * 10) / 10 : Number.NaN;
}

const decimalText = (n: number): string => String(Math.round(n * 10) / 10).replace('.', ',');

export function formatPercent(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : `${decimalText(n)}%`;
}

export function formatFraction(fraction: number | null | undefined): string {
  return fraction == null ? '—' : formatPercent(fraction * 100);
}

/** Quantity with an Indonesian decimal comma, at most two decimals: 41.0875 m³ reads "41,09 m³". */
export function formatQty(n: number, unit: string): string {
  const text = (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
  return `${text} ${unit}`.trim();
}

export function pctInputs(weights: StageWeights, pct: StagePct | null): Record<string, string> {
  return Object.fromEntries(stagesOf(weights).map((s) => {
    const v = pct?.[s];
    return [s, typeof v === 'number' ? decimalText(v) : ''];
  }));
}

export type PctRead = { ok: true; pct: StagePct } | { ok: false; reason: string };

export function readPctInputs(weights: StageWeights, inputs: Record<string, string>): PctRead {
  const pct: StagePct = {};
  for (const s of stagesOf(weights)) {
    const v = parsePercentInput(inputs[s] ?? '');
    const name = stageKeyLabel(s).toLowerCase();
    if (v === null) return { ok: false, reason: `Isi persentase ${name}.` };
    if (Number.isNaN(v)) return { ok: false, reason: `Persentase ${name} harus angka 0 sampai 100.` };
    pct[s] = v;
  }
  return { ok: true, pct };
}

export function regressedStages(weights: StageWeights, prev: StagePct, next: StagePct): StageKey[] {
  return stagesOf(weights).filter((s) => (next[s] ?? 0) < (prev[s] ?? 0));
}

export const SPLIT_STAGES = ['BEKISTING', 'PEMBESIAN', 'PENGECORAN'] as const;
export type SplitStage = (typeof SPLIT_STAGES)[number];

export function weightPercentInputs(weights: StageWeights | null): Record<SplitStage, string> {
  if (!weights || isSingle(weights)) return { BEKISTING: '', PEMBESIAN: '', PENGECORAN: '' };
  return {
    BEKISTING: decimalText(weights.BEKISTING * 100),
    PEMBESIAN: decimalText(weights.PEMBESIAN * 100),
    PENGECORAN: decimalText(weights.PENGECORAN * 100),
  };
}

export type WeightRead = { ok: true; weights: StageWeights } | { ok: false; reason: string };

/** Three percents that must add up to 100 (± 0.1), stored as fractions with the remainder on pengecoran. */
export function readWeightPercentInputs(inputs: Record<string, string>): WeightRead {
  const values = SPLIT_STAGES.map((s) => parsePercentInput(inputs[s] ?? ''));
  if (values.some((v) => v === null || Number.isNaN(v))) {
    return { ok: false, reason: 'Isi ketiga bobot dengan angka 0 sampai 100.' };
  }
  const [bekisting, pembesian, pengecoran] = values as number[];
  const sum = bekisting + pembesian + pengecoran;
  if (Math.abs(sum - 100) > 0.1) return { ok: false, reason: `Jumlah bobot ${formatPercent(sum)}, harus 100%.` };
  const weights = weightsFromAmounts({ BEKISTING: bekisting, PEMBESIAN: pembesian, PENGECORAN: pengecoran });
  if (!weights) return { ok: false, reason: 'Bobot tidak valid.' };
  const checked = validateStageWeights(weights);
  return checked.ok ? { ok: true, weights: checked.weights } : { ok: false, reason: checked.reason };
}
