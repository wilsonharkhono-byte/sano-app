// tools/progressClaims/stageWeights.ts
// SANO — stage weights of a work-area row (spec §5.3, §7, §17). Pure.
//
// A row either splits its value across the three weight-bearing stages
// (bekisting, pembesian, pengecoran; fractions summing to 1) or carries the
// single stage {"SINGLE": 1} because its BoQ price is not split by stage
// (tangga, piles, lainnya). Weights are never guessed: each stored row records
// its source, and the reference profile is generated from real RABs.
import { WEIGHT_BEARING_STAGES, type WeightBearingStage } from '../reportLineDraftValidate';
import type { WorkAreaClass } from './workAreaClass';

export type StageKey = WeightBearingStage | 'SINGLE';
export type SplitWeights = Record<WeightBearingStage, number>;
export type StageWeights = { SINGLE: 1 } | SplitWeights;
export type WeightSource = 'rab' | 'input_sheet' | 'reference' | 'manual';

export const SINGLE_WEIGHTS: StageWeights = { SINGLE: 1 };
export const WEIGHT_SUM_TOLERANCE = 0.001;

export interface ReferenceEntry {
  weights: SplitWeights;
  workbooks: number;
  rows: number;
  volume_m3: number;
}
export type ReferenceProfile = Partial<Record<WorkAreaClass, ReferenceEntry>>;

export function isSingle(w: StageWeights): w is { SINGLE: 1 } {
  return Object.prototype.hasOwnProperty.call(w, 'SINGLE');
}

export function stagesOf(w: StageWeights): StageKey[] {
  return isSingle(w) ? ['SINGLE'] : [...WEIGHT_BEARING_STAGES];
}

export function weightOf(w: StageWeights, stage: StageKey): number {
  if (isSingle(w)) return stage === 'SINGLE' ? 1 : 0;
  return stage === 'SINGLE' ? 0 : w[stage];
}

/**
 * Three non-negative amounts (Rupiah subtotals or percents) → fractions rounded
 * to 3 decimals, the rounding remainder landing on pengecoran so they sum to 1.
 * Null when an amount is invalid or all are zero.
 */
export function weightsFromAmounts(amounts: SplitWeights): SplitWeights | null {
  const values = WEIGHT_BEARING_STAGES.map((s) => amounts[s]);
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const bekisting = Math.round((amounts.BEKISTING / total) * 1000) / 1000;
  const pembesian = Math.round((amounts.PEMBESIAN / total) * 1000) / 1000;
  const pengecoran = Math.max(0, Math.round((1 - bekisting - pembesian) * 1000) / 1000);
  return { BEKISTING: bekisting, PEMBESIAN: pembesian, PENGECORAN: pengecoran };
}

export type WeightValidation = { ok: true; weights: StageWeights } | { ok: false; reason: string };

/** The only accepted shapes are {"SINGLE": 1} or exactly the three stages, each 0..1, summing to 1 ± 0.001. */
export function validateStageWeights(raw: unknown): WeightValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'bobot harus berupa objek' };
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length === 1 && keys[0] === 'SINGLE') {
    return r.SINGLE === 1 ? { ok: true, weights: { SINGLE: 1 } } : { ok: false, reason: 'SINGLE harus bernilai 1' };
  }
  if (keys.length !== WEIGHT_BEARING_STAGES.length || !WEIGHT_BEARING_STAGES.every((s) => keys.includes(s))) {
    return { ok: false, reason: 'bobot harus berisi tepat BEKISTING, PEMBESIAN dan PENGECORAN' };
  }
  const values = WEIGHT_BEARING_STAGES.map((s) => r[s]);
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) {
    return { ok: false, reason: 'setiap bobot harus angka antara 0 dan 1' };
  }
  const sum = (values as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) return { ok: false, reason: `jumlah bobot ${sum.toFixed(3)}, harus 1` };
  return { ok: true, weights: { BEKISTING: r.BEKISTING as number, PEMBESIAN: r.PEMBESIAN as number, PENGECORAN: r.PENGECORAN as number } };
}

/** Spec §7.3: a class the RABs price by stage gets its profile weights; every other class is SINGLE. */
export function referenceWeightsFor(cls: WorkAreaClass, profile: ReferenceProfile): StageWeights {
  return profile[cls]?.weights ?? SINGLE_WEIGHTS;
}
