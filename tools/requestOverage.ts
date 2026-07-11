// SANO — Signal-1 request-time soft heads-up (Task 2.4).
//
// Pure, dependency-free helpers (no supabase, no react-native) so they unit-test
// without mocking — same discipline as budgetGate.ts. Shared by:
//   - workflows/gates/gate1.ts        (Tier-1 work-group)
//   - workflows/screens/PermintaanScreen.tsx (Tier-2/Tier-3 request builders)
//   - office/screens/ApprovalsScreen.tsx     (estimator overage panel, recomputed)
//
// Design authority: docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md §3.
//   - Severity CAPS at WARNING at request time — never HIGH/CRITICAL, never a
//     hard quantity block. >120% still WARNING but the copy escalates.
//   - Copy is a running total ("melebihi total alokasi"), never "this request is
//     over" and never a pace accusation ("terlalu cepat").
//   - Sub-100 bands are UNCHANGED from the pre-069 thresholds (INFO >50 exists
//     only where it existed before — Tier-2/3; Tier-1 has no INFO tier).
//
// SERVER TWIN: supabase/migrations/069_soft_request_gate.sql reproduces the band
// mapping (compute_tier1_workgroup_flag / compute_tier2_flag / compute_tier3_flag).
// Change the two in lockstep or a modified client diverges from the server flag.

import type { FlagLevel, GateResult, OverageComponents, OverageReason } from './types';

/** Projected cumulative above this % of plan requires a reason before submit. */
export const REASON_THRESHOLD_PCT = 100;

export const OVERAGE_REASONS: readonly OverageReason[] = [
  'WASTE', 'REWORK', 'PLAN_UNDERESTIMATE', 'VARIATION', 'OTHER',
];

/** Indonesian labels for the reason picker (spec §3). */
export const OVERAGE_REASON_LABELS: Record<OverageReason, string> = {
  WASTE: 'Kerusakan/susut lapangan',
  REWORK: 'Bongkar-pasang',
  PLAN_UNDERESTIMATE: 'Volume RAB kurang',
  VARIATION: 'Perubahan pekerjaan',
  OTHER: 'Lainnya',
};

/** Formats a base-unit quantity for the running-total copy. Callers may inject a
 * supplier-unit-aware formatter (e.g. batang) — see gate1.ts. Default is base. */
export type QtyFormatter = (n: number, unit: string) => string;

const defaultFmtQty: QtyFormatter = (n, unit) =>
  `${Math.round(n).toLocaleString('id-ID')} ${unit}`;

/** projected = poOrdered(if any) + otherOpen + thisRequest. */
export function projectedTotal(c: Pick<OverageComponents, 'poOrdered' | 'otherOpen' | 'thisRequest'>): number {
  return (c.poOrdered ?? 0) + c.otherOpen + c.thisRequest;
}

/** Assemble OverageComponents, computing projectedPct against `planned`. */
export function makeOverageComponents(input: {
  grainLabel: string;
  poOrdered: number | null;
  otherOpen: number;
  thisRequest: number;
  planned: number;
  unit: string;
}): OverageComponents {
  const projected = projectedTotal(input);
  const projectedPct = input.planned > 0 ? (projected / input.planned) * 100 : 0;
  return { ...input, projectedPct };
}

/**
 * Running-total copy per spec §3. Names the grain, then the cumulative:
 *   "Proyek — Sudah di-PO 900 kg + permintaan berjalan 60 kg + permintaan ini
 *    50 kg = 1.010 kg dari rencana 1.000 kg (101%)"
 * The "Sudah di-PO …" segment is omitted when poOrdered is null (Tier-1 grain
 * has no PO dimension — see gate1.ts / migration 069 header).
 */
export function formatRunningTotalMessage(c: OverageComponents, fmt: QtyFormatter = defaultFmtQty): string {
  const projected = projectedTotal(c);
  const segments: string[] = [];
  if (c.poOrdered != null) segments.push(`Sudah di-PO ${fmt(c.poOrdered, c.unit)}`);
  segments.push(`permintaan berjalan ${fmt(c.otherOpen, c.unit)}`);
  segments.push(`permintaan ini ${fmt(c.thisRequest, c.unit)}`);
  return `${c.grainLabel} — ${segments.join(' + ')} = ${fmt(projected, c.unit)} `
    + `dari rencana ${fmt(c.planned, c.unit)} (${c.projectedPct.toFixed(0)}%)`;
}

/**
 * Cap a request-time quantity/budget flag at WARNING (spec §3 — request time
 * never hard-blocks). HIGH/CRITICAL collapse to WARNING; INFO/OK pass through.
 */
export function capFlagAtWarning(flag: FlagLevel): FlagLevel {
  return flag === 'HIGH' || flag === 'CRITICAL' ? 'WARNING' : flag;
}

interface Band { flag: FlagLevel; suffix: string; }

/**
 * Band mapping for a projected burn %. Post-069: the >100 (was HIGH) and >120
 * (was CRITICAL) bands both resolve to WARNING with escalating copy. `infoBand`
 * controls the sub-80 INFO tier: true for Tier-2/3 (INFO >50 existed before),
 * false for Tier-1 work-group (never had an INFO tier).
 */
export function overageBand(pct: number, infoBand: boolean): Band {
  if (pct > 120) return { flag: 'WARNING', suffix: ' — jauh melebihi alokasi.' };
  if (pct > 100) return { flag: 'WARNING', suffix: ' — melebihi total alokasi.' };
  if (pct > 80) return { flag: 'WARNING', suffix: ' — mendekati batas alokasi.' };
  if (infoBand && pct > 50) return { flag: 'INFO', suffix: '' };
  return { flag: 'OK', suffix: '' };
}

/**
 * Build a request-time GateResult from overage components. Severity is capped at
 * WARNING by construction (overageBand never returns HIGH/CRITICAL). The
 * components ride along on `.overage` so the caller can persist them and drive
 * the reason-required predicate.
 */
export function buildOverageResult(
  c: OverageComponents,
  check: string,
  opts?: { infoBand?: boolean; extra?: GateResult; fmt?: QtyFormatter },
): GateResult {
  const infoBand = opts?.infoBand ?? true;
  const band = overageBand(c.projectedPct, infoBand);
  return {
    flag: band.flag,
    check,
    msg: formatRunningTotalMessage(c, opts?.fmt) + band.suffix,
    overage: c,
    ...(opts?.extra ? { extra: opts.extra } : {}),
  };
}

/**
 * True when a line's projected cumulative crosses 100% of plan — the supervisor
 * must pick an overage_reason before submit (spec §3 reason capture).
 */
export function requiresOverageReason(result: GateResult | null | undefined): boolean {
  return !!result?.overage && result.overage.projectedPct > REASON_THRESHOLD_PCT;
}
