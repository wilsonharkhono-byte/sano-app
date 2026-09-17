// tools/progressClaims/claims.ts
// SANO — data access for stage weights and the weekly stage claim (migrations
// 103 and 104; spec §6.2, §16, §18). Reads go through RLS, a page at a time
// where a project can pass PostgREST's 1,000-row cap. Every write is an RPC
// that re-checks the rules, and a refusal comes back as a ClaimRpcError: its
// message is the Indonesian sentence, its code the refusal code.
import { fetchAllPaged } from '../queryHelpers';
import { supabase } from '../supabase';
import { ClaimRpcError, type ClaimStatus } from './claimRules';
import type { ClaimableItem } from './claimView';
import { latestRevisionLines, type DiaryLine } from './diaryEvidence';
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
  created_by: string;
  updated_by: string;
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
  'id, claim_id, project_id, boq_item_id, prev_verified, claimed_pct, verified_pct, weights_snapshot, row_pct_prev, row_pct_new, installed_before, delta_quantity, regress_reason, note, evidence, created_by, updated_by, created_at, updated_at';

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new ClaimRpcError(error.message);
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

/** Each row's most recently verified stage percents, one row per BoQ item (migration 104 view). */
export async function listVerifiedStagePct(projectId: string): Promise<Map<string, StagePct>> {
  const rows = await fetchAllPaged<{ boq_item_id: string; verified_pct: StagePct }>((from, to) =>
    supabase
      .from('progress_claim_latest_verified')
      .select('boq_item_id, verified_pct')
      .eq('project_id', projectId)
      .order('boq_item_id')
      .range(from, to));
  return new Map(rows.map((r) => [r.boq_item_id, r.verified_pct]));
}

/** When each row was last verified (migration 104 view); rows never verified are absent. */
export async function listVerifiedAtByRow(projectId: string): Promise<Map<string, string>> {
  const rows = await fetchAllPaged<{ boq_item_id: string; verified_at: string }>((from, to) =>
    supabase
      .from('progress_claim_latest_verified')
      .select('boq_item_id, verified_at')
      .eq('project_id', projectId)
      .order('boq_item_id')
      .range(from, to));
  return new Map(rows.map((r) => [r.boq_item_id, r.verified_at]));
}

interface DiaryLineRow {
  id: string;
  boq_item_id: string | null;
  stage: string | null;
  activity_state: string | null;
  line_text: string;
  line_index: number;
  report_id: string;
  client_progress_reports: { report_no: number; revision: number | null; period_end: string; issued_at: string | null };
}

/**
 * The project's CONFIRMED report lines with their report, from the latest
 * revision of each report only (spec 2026-09-17 §4.2). The diary is evidence:
 * when it cannot be read, `readable` is false and the claim screens carry on
 * from the verified figures.
 */
export async function listDiaryLines(projectId: string): Promise<{ lines: DiaryLine[]; readable: boolean }> {
  try {
    const rows = await fetchAllPaged<DiaryLineRow>((from, to) =>
      supabase
        .from('client_report_lines')
        .select('id, boq_item_id, stage, activity_state, line_text, line_index, report_id, client_progress_reports!inner(project_id, report_no, revision, period_end, issued_at)')
        .eq('status', 'CONFIRMED')
        .eq('client_progress_reports.project_id', projectId)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: DiaryLineRow[] | null; error: { message?: string } | null }>);
    const lines = rows.map((r): DiaryLine => ({
      id: r.id, boq_item_id: r.boq_item_id, stage: r.stage, activity_state: r.activity_state, line_text: r.line_text, line_index: r.line_index,
      report_id: r.report_id, report_no: r.client_progress_reports.report_no, revision: r.client_progress_reports.revision ?? 1,
      period_end: r.client_progress_reports.period_end, issued_at: r.client_progress_reports.issued_at,
    }));
    return { lines: latestRevisionLines(lines), readable: true };
  } catch (err) {
    console.warn('listDiaryLines failed:', (err as { message?: string })?.message ?? err);
    return { lines: [], readable: false };
  }
}

/** What each row's progress entries sum to, one row per BoQ item (migration 104 view). Verification writes the difference from this. */
export async function listEntryTotals(projectId: string): Promise<Map<string, number>> {
  const rows = await fetchAllPaged<{ boq_item_id: string; installed_total: number | string }>((from, to) =>
    supabase
      .from('progress_entry_totals')
      .select('boq_item_id, installed_total')
      .eq('project_id', projectId)
      .order('boq_item_id')
      .range(from, to));
  return new Map(rows.map((r) => [r.boq_item_id, Number(r.installed_total) || 0]));
}

export async function listStageWeights(projectId: string): Promise<StageWeightRow[]> {
  return fetchAllPaged<StageWeightRow>((from, to) =>
    supabase
      .from('boq_stage_weights')
      .select('boq_item_id, weights, source, reference_class, updated_at')
      .eq('project_id', projectId)
      .order('boq_item_id')
      .range(from, to));
}

const ROW_ID_CHUNK = 100;

/**
 * A claim's BoQ rows as they are now, keyed by id. The screen's copy of
 * boq_items can predate a re-publish, and verification computes from the live
 * planned volume. Ids go in chunks so the request URL stays short.
 */
export async function listClaimRows(boqItemIds: ReadonlyArray<string>): Promise<Map<string, ClaimableItem>> {
  const ids = [...new Set(boqItemIds)];
  const rows = new Map<string, ClaimableItem>();
  for (let i = 0; i < ids.length; i += ROW_ID_CHUNK) {
    const { data, error } = await supabase
      .from('boq_items')
      .select('id, project_id, code, label, unit, planned, installed, progress, superseded_at')
      .in('id', ids.slice(i, i + ROW_ID_CHUNK));
    if (error) throw error;
    for (const r of (data ?? []) as ClaimableItem[]) {
      rows.set(r.id, { ...r, planned: Number(r.planned) || 0, installed: Number(r.installed) || 0, progress: Number(r.progress) || 0 });
    }
  }
  return rows;
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

export async function submitClaim(claimId: string): Promise<{ claim_id: string; status: ClaimStatus; lines: number; notified: number; verifiers_notified: number }> {
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
