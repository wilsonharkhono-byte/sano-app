// tools/progressClaims/claimFlags.ts
// SANO — advisory flags on a claimed work area (spec 2026-09-17 §4.4). The
// estimator sees them as chips; none blocks verification, and none is stored.
// Pure.
import type { DiaryLine, DiaryProposal } from './diaryEvidence';
import { rowFraction, type StagePct } from './stageMath';
import { isSingle, type StageWeights, type WeightSource } from './stageWeights';
import { statusOfPct } from './statusCredit';

export type ClaimFlag = 'NO_EVIDENCE' | 'STAGE_ORDER' | 'DIARY_MISMATCH' | 'MATERIAL_BEHIND' | 'REFERENCE_WEIGHTS';

/** Claimed rebar credit may run this far ahead of the besi requested before it is flagged (stock on site, rounding). */
export const MATERIAL_TOLERANCE = 0.1;

export const CLAIM_FLAG_LABELS: Record<ClaimFlag, string> = {
  NO_EVIDENCE: 'Naik tanpa foto atau laporan',
  STAGE_ORDER: 'Pengecoran mendahului besi/bekisting',
  DIARY_MISMATCH: 'Berbeda dari laporan harian',
  MATERIAL_BEHIND: 'Pembesian melebihi besi yang diminta',
  REFERENCE_WEIGHTS: 'Bobot referensi',
};

export interface ClaimFlagInput {
  weights: StageWeights;
  source: WeightSource | null;
  prevPct: StagePct;
  claimedPct: StagePct;
  photoCount: number;
  /** Confirmed diary lines for the row since its last verification. */
  diaryLines: DiaryLine[];
  proposal: DiaryProposal | null;
  /** Besi planned and requested (not rejected) for this work area, when known. */
  besi?: { planned: number; requested: number } | null;
}

export function claimFlags(input: ClaimFlagInput): ClaimFlag[] {
  const { weights, claimedPct, prevPct } = input;
  const flags: ClaimFlag[] = [];
  const rises = rowFraction(weights, claimedPct) > rowFraction(weights, prevPct);
  if (rises && input.photoCount === 0 && input.diaryLines.length === 0) flags.push('NO_EVIDENCE');
  if (!isSingle(weights)) {
    const pour = claimedPct.PENGECORAN ?? 0;
    if (pour > (claimedPct.PEMBESIAN ?? 0) || pour > (claimedPct.BEKISTING ?? 0)) flags.push('STAGE_ORDER');
  }
  const disagrees = (input.proposal?.stages ?? []).some(
    (s) => statusOfPct(claimedPct[s.stage]).status !== statusOfPct(input.proposal?.pct[s.stage]).status,
  );
  if (disagrees) flags.push('DIARY_MISMATCH');
  const besi = input.besi;
  if (!isSingle(weights) && besi && besi.planned > 0 && (claimedPct.PEMBESIAN ?? 0) / 100 > besi.requested / besi.planned + MATERIAL_TOLERANCE) {
    flags.push('MATERIAL_BEHIND');
  }
  if (input.source === 'reference') flags.push('REFERENCE_WEIGHTS');
  return flags;
}
