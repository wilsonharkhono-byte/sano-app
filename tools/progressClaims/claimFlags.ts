// tools/progressClaims/claimFlags.ts
// SANO — advisory flags on a claimed work area (spec 2026-09-17 §4.4). The
// estimator sees them as chips; none blocks verification, and none is stored.
// Pure.
import type { DiaryLine, DiaryProposal } from './diaryEvidence';
import { rowFraction, type StagePct } from './stageMath';
import { isSingle, type StageWeights, type WeightSource } from './stageWeights';
import { statusOfPct } from './statusCredit';

export type ClaimFlag = 'NO_EVIDENCE' | 'STAGE_ORDER' | 'DIARY_MISMATCH' | 'REFERENCE_WEIGHTS';

export const CLAIM_FLAG_LABELS: Record<ClaimFlag, string> = {
  NO_EVIDENCE: 'Naik tanpa foto atau laporan',
  STAGE_ORDER: 'Pengecoran mendahului besi/bekisting',
  DIARY_MISMATCH: 'Berbeda dari laporan harian',
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
  if (input.source === 'reference') flags.push('REFERENCE_WEIGHTS');
  return flags;
}
