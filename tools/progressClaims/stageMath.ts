// tools/progressClaims/stageMath.ts
// SANO — a work-area row's completion from its stage percents, and the
// quantity a verified claim adds (spec §6.2 step 5, §7.5). Pure. The verify
// RPC recomputes the same numbers server-side; this module is the preview.
import { stagesOf, weightOf, type StageKey, type StageWeights } from './stageWeights';

export type StagePct = Partial<Record<StageKey, number>>;

/** Percent input → 0..100 with one decimal; null when not a finite number. */
export function clampPct(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

/**
 * Row completion as a fraction 0..1: Σ weight × percent / 100 over the weights' own stages, divided by the
 * weights' sum so weights that sum to 0.999 still reach 1 when every stage is complete. A missing percent
 * counts as 0. Migration 104 stage_row_fraction() computes the same number.
 */
export function rowFraction(weights: StageWeights, pct: StagePct): number {
  const stages = stagesOf(weights);
  const total = stages.reduce((acc, stage) => acc + weightOf(weights, stage), 0);
  if (total <= 0) return 0;
  const weighted = stages.reduce((acc, stage) => acc + weightOf(weights, stage) * ((clampPct(pct[stage]) ?? 0) / 100), 0);
  return Math.round(Math.min(1, Math.max(0, weighted / total)) * 1e6) / 1e6;
}

export interface ClaimDelta {
  /** planned × (new − previous) fraction, 4 decimals; negative for a regression. */
  deltaQuantity: number;
  installedAfter: number;
  /** 0..100, one decimal — what boq_items.progress becomes. */
  progressAfter: number;
  regression: boolean;
  unchanged: boolean;
}

export function claimDelta(planned: number, previousFraction: number, newFraction: number): ClaimDelta {
  const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const deltaQuantity = round4((newFraction - previousFraction) * planned);
  return {
    deltaQuantity: deltaQuantity === 0 ? 0 : deltaQuantity,
    installedAfter: round4(planned * newFraction),
    progressAfter: Math.round(newFraction * 1000) / 10,
    regression: deltaQuantity < 0,
    unchanged: deltaQuantity === 0,
  };
}

/**
 * What verify_progress_claim writes for a row (migration 104): installed
 * becomes planned x newFraction (4 decimals), and the entry is the difference
 * from what the row's entries already sum to. Unlike claimDelta, this follows
 * weight or planned-volume changes made since the last verification.
 */
export function deltaFromInstalled(planned: number, installedBefore: number, newFraction: number): ClaimDelta {
  const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const installedAfter = round4(planned * newFraction);
  const deltaQuantity = round4(installedAfter - installedBefore);
  return {
    deltaQuantity: deltaQuantity === 0 ? 0 : deltaQuantity,
    installedAfter,
    progressAfter: Math.round(newFraction * 1000) / 10,
    regression: deltaQuantity < 0,
    unchanged: deltaQuantity === 0,
  };
}

export function workStatusFor(fraction: number): 'COMPLETE' | 'IN_PROGRESS' {
  return fraction >= 1 - 1e-6 ? 'COMPLETE' : 'IN_PROGRESS';
}
