// tools/analytics/approvalFlow.ts
// SANO — Alur persetujuan (spec 2026-09-17 §5.3.4): how long material requests
// wait for a decision, and what is waiting now. Pure.
import { dateOf, daysBetween } from './weekBuckets';

export interface RequestHeader { created_at: string; reviewed_at: string | null; overall_status: string }

const DECIDED: ReadonlySet<string> = new Set(['APPROVED', 'REJECTED']);
const OPEN: ReadonlySet<string> = new Set(['PENDING', 'UNDER_REVIEW', 'AUTO_HOLD']);
const AGE_BUCKETS: ReadonlyArray<{ label: string; max: number }> = [
  { label: '0–2 hari', max: 2 }, { label: '3–7 hari', max: 7 }, { label: '8–14 hari', max: 14 }, { label: '> 14 hari', max: Infinity },
];
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface ApprovalFlow {
  total: number;
  decided: number;
  medianDaysToDecision: number | null;
  rejectedPct: number | null;
  pending: number;
  oldestPendingDays: number | null;
  pendingByAge: Array<{ label: string; count: number }>;
}

export function buildApprovalFlow(input: { today: string; headers: RequestHeader[] }): ApprovalFlow {
  const decided = input.headers.filter((h) => DECIDED.has(h.overall_status) && h.reviewed_at);
  const days = decided.map((h) => daysBetween(dateOf(h.created_at), dateOf(h.reviewed_at as string))).sort((a, b) => a - b);
  const median = days.length === 0 ? null : days.length % 2 === 1 ? days[(days.length - 1) / 2] : round1((days[days.length / 2 - 1] + days[days.length / 2]) / 2);
  const ages = input.headers.filter((h) => OPEN.has(h.overall_status)).map((h) => daysBetween(dateOf(h.created_at), input.today));
  return {
    total: input.headers.length,
    decided: decided.length,
    medianDaysToDecision: median,
    rejectedPct: decided.length > 0 ? round1((100 * decided.filter((h) => h.overall_status === 'REJECTED').length) / decided.length) : null,
    pending: ages.length,
    oldestPendingDays: ages.length > 0 ? Math.max(...ages) : null,
    pendingByAge: AGE_BUCKETS.map((b, i) => ({ label: b.label, count: ages.filter((a) => a <= b.max && (i === 0 || a > AGE_BUCKETS[i - 1].max)).length })),
  };
}
