// tools/progressClaims/claims.ts
// SANO — data access for stage weights and the weekly stage claim (migrations
// 103 and 104; spec §6.2, §16, §18). Reads go through RLS. Every write is an
// RPC that re-checks the rules, and a refusal comes back as an Error whose
// message is the Indonesian sentence from mapClaimRpcError.
import { supabase } from '../supabase';
import { mapClaimRpcError, type ClaimStatus } from './claimRules';
import { countLinesByRow, latestRevisionReportIds, latestVerifiedByRow, type VerifiedLineRow } from './claimView';
import type { StagePct } from './stageMath';
import type { StageWeights, WeightSource } from './stageWeights';
import type { WorkAreaClass } from './workAreaClass';

export const OPEN_CLAIM_STATUSES: ReadonlyArray<ClaimStatus> = ['DRAFT', 'SUBMITTED', 'RETURNED'];

export interface ProgressClaim {
  id: string;
  project_id: string;
  week_start: string;
  status: ClaimStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  returned_by: string | null;
  returned_at: string | null;
  return_note: string | null;
  verified_by: string | null;
  verified_at: string | null;
  verifier_note: string | null;
}

export interface ProgressClaimLine {
  id: string;
  claim_id: string;
  project_id: string;
  boq_item_id: string;
  prev_verified: StagePct;
  claimed_pct: StagePct;
  verified_pct: StagePct | null;
  weights_snapshot: StageWeights | null;
  row_pct_prev: number | null;
  row_pct_new: number | null;
  installed_before: number | null;
  delta_quantity: number | null;
  regress_reason: string | null;
  note: string | null;
  evidence: { photo_refs?: string[]; report_line_ids?: string[] } | null;
  created_at: string;
  updated_at: string;
}

export interface StageWeightRow {
  boq_item_id: string;
  weights: unknown;
  source: WeightSource;
  reference_class: string | null;
  updated_at: string;
}

const CLAIM_COLUMNS =
  'id, project_id, week_start, status, created_by, created_at, updated_at, submitted_by, submitted_at, returned_by, returned_at, return_note, verified_by, verified_at, verifier_note';
const LINE_COLUMNS =
  'id, claim_id, project_id, boq_item_id, prev_verified, claimed_pct, verified_pct, weights_snapshot, row_pct_prev, row_pct_new, installed_before, delta_quantity, regress_reason, note, evidence, created_at, updated_at';

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(mapClaimRpcError(error.message));
  return data as T;
}

// ── Reads ────────────────────────────────────────────────────────────────

/** The project's claim in progress (DRAFT, SUBMITTED or RETURNED); migration 104 allows at most one. */
export async function getOpenClaim(projectId: string): Promise<ProgressClaim | null> {
  const { data, error } = await supabase
    .from('progress_claims')
    .select(CLAIM_COLUMNS)
    .eq('project_id', projectId)
    .in('status', [...OPEN_CLAIM_STATUSES])
    .maybeSingle();
  if (error) throw error;
  return (data as ProgressClaim | null) ?? null;
}

/** The most recently opened claim of any status, for the status cards. */
export async function getLatestClaim(projectId: string): Promise<ProgressClaim | null> {
  const { data, error } = await supabase
    .from('progress_claims')
    .select(CLAIM_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ProgressClaim | null) ?? null;
}

export async function countSubmittedClaims(projectId: string): Promise<number> {
  const { count, error } = await supabase
    .from('progress_claims')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'SUBMITTED');
  if (error) throw error;
  return count ?? 0;
}

export async function listClaimLines(claimId: string): Promise<ProgressClaimLine[]> {
  const { data, error } = await supabase
    .from('progress_claim_lines')
    .select(LINE_COLUMNS)
    .eq('claim_id', claimId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as ProgressClaimLine[];
}

/** Each row's most recently verified stage percents. */
export async function listVerifiedStagePct(projectId: string): Promise<Map<string, StagePct>> {
  const { data, error } = await supabase
    .from('progress_claim_lines')
    .select('boq_item_id, verified_pct, updated_at, progress_claims!inner(status, verified_at)')
    .eq('project_id', projectId)
    .eq('progress_claims.status', 'VERIFIED');
  if (error) throw error;
  return latestVerifiedByRow((data ?? []) as unknown as VerifiedLineRow[]);
}

export async function listStageWeights(projectId: string): Promise<StageWeightRow[]> {
  const { data, error } = await supabase
    .from('boq_stage_weights')
    .select('boq_item_id, weights, source, reference_class, updated_at')
    .eq('project_id', projectId);
  if (error) throw error;
  return (data ?? []) as StageWeightRow[];
}

/**
 * Confirmed Blueprint report lines per row since a date, from the latest
 * revision of each report only. Evidence is advisory: when the lines cannot
 * be read (for example migration 102 not pasted yet) this returns an empty
 * map instead of failing the claim screen.
 */
export async function countLinkedLinesByRow(projectId: string, sinceDate: string): Promise<Map<string, number>> {
  try {
    const { data: reports, error } = await supabase
      .from('client_progress_reports')
      .select('id, report_no, revision')
      .eq('project_id', projectId)
      .gte('period_start', sinceDate)
      .not('issued_at', 'is', null);
    if (error) throw error;
    const reportIds = latestRevisionReportIds((reports ?? []) as Array<{ id: string; report_no: number; revision: number }>);
    if (reportIds.size === 0) return new Map();
    const { data: lines, error: linesError } = await supabase
      .from('client_report_lines')
      .select('boq_item_id, report_id')
      .in('report_id', [...reportIds])
      .eq('status', 'CONFIRMED');
    if (linesError) throw linesError;
    return countLinesByRow((lines ?? []) as Array<{ boq_item_id: string | null; report_id: string }>, reportIds);
  } catch (err) {
    console.warn('countLinkedLinesByRow failed:', (err as { message?: string })?.message ?? err);
    return new Map();
  }
}

// ── Stage weights (migration 103) ────────────────────────────────────────

export async function seedReferenceWeights(
  projectId: string,
  rows: Array<{ boq_item_id: string; reference_class: WorkAreaClass }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  return callRpc<number>('seed_reference_stage_weights', { p_project_id: projectId, p_rows: rows });
}

export async function setStageWeights(boqItemId: string, weights: StageWeights): Promise<void> {
  await callRpc('set_boq_stage_weights', { p_boq_item_id: boqItemId, p_weights: weights });
}

export async function resetStageWeights(boqItemId: string, referenceClass: WorkAreaClass): Promise<void> {
  await callRpc('reset_boq_stage_weights', { p_boq_item_id: boqItemId, p_reference_class: referenceClass });
}

// ── The weekly claim (migration 104) ─────────────────────────────────────

export interface SaveClaimLineInput {
  projectId: string;
  boqItemId: string;
  claimedPct: StagePct;
  note?: string | null;
  photoRefs: string[];
  regressReason?: string | null;
}

export interface SaveClaimLineResult {
  claim_id: string;
  claim_status: ClaimStatus;
  week_start: string;
  line_id: string;
  prev_verified: StagePct;
  claimed_pct: StagePct;
  row_fraction_prev: number;
  row_fraction_claimed: number;
}

export async function saveClaimLine(input: SaveClaimLineInput): Promise<SaveClaimLineResult> {
  return callRpc<SaveClaimLineResult>('save_progress_claim_line', {
    p_project_id: input.projectId,
    p_boq_item_id: input.boqItemId,
    p_claimed_pct: input.claimedPct,
    p_note: input.note ?? null,
    p_photo_refs: input.photoRefs,
    p_regress_reason: input.regressReason ?? null,
  });
}

export async function removeClaimLine(lineId: string): Promise<{ claim_id: string; lines_left: number }> {
  return callRpc('remove_progress_claim_line', { p_line_id: lineId });
}

export async function submitClaim(claimId: string): Promise<{ claim_id: string; status: ClaimStatus; lines: number; notified: number }> {
  return callRpc('submit_progress_claim', { p_claim_id: claimId });
}

export async function returnClaim(claimId: string, note: string): Promise<{ claim_id: string; status: ClaimStatus; notified: number }> {
  return callRpc('return_progress_claim', { p_claim_id: claimId, p_note: note });
}

export interface VerifyLineInput {
  line_id: string;
  verified_pct: StagePct;
  regress_reason?: string | null;
}

export interface VerifyClaimResult {
  claim_id: string;
  status: ClaimStatus;
  lines: number;
  entries: number;
  regressions: number;
  notified: number;
}

export async function verifyClaim(claimId: string, lines: VerifyLineInput[], note?: string | null): Promise<VerifyClaimResult> {
  return callRpc<VerifyClaimResult>('verify_progress_claim', { p_claim_id: claimId, p_lines: lines, p_note: note ?? null });
}
