// tools/progressClaims/statusCredit.ts
// SANO — status credit (spec 2026-09-17 §4.1). A stage of a work area is not
// started, running or finished, and earns a fixed share of its weight: 0, 50
// or 100 percent. Nobody estimates a figure; a person may still type one.
// Pure.
import type { ActivityState } from '../reportLineDraftValidate';

export const STAGE_STATUSES = ['BELUM', 'BERJALAN', 'SELESAI'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

const CREDIT: Record<StageStatus, number> = { BELUM: 0, BERJALAN: 50, SELESAI: 100 };
const LABELS: Record<StageStatus, string> = { BELUM: 'Belum', BERJALAN: 'Berjalan', SELESAI: 'Selesai' };

export function pctOfStatus(status: StageStatus): number {
  return CREDIT[status];
}

export function stageStatusLabel(status: StageStatus): string {
  return LABELS[status];
}

/** A stage percent as a status. `exact` marks a figure a person typed (anything that is not the credit itself). */
export function statusOfPct(pct: number | null | undefined): { status: StageStatus; exact: boolean } {
  const v = typeof pct === 'number' && Number.isFinite(pct) ? pct : 0;
  if (v <= 0) return { status: 'BELUM', exact: false };
  if (v >= 100) return { status: 'SELESAI', exact: false };
  return { status: 'BERJALAN', exact: v !== CREDIT.BERJALAN };
}

/** The diary's Mulai and Lanjut both mean the stage is running. */
export function statusOfActivity(state: ActivityState | string | null | undefined): StageStatus {
  return state === 'SELESAI' ? 'SELESAI' : 'BERJALAN';
}

export function maxStatus(a: StageStatus, b: StageStatus): StageStatus {
  return CREDIT[a] >= CREDIT[b] ? a : b;
}
