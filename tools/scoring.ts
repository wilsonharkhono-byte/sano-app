// SAN Contractor — Hidden Scoring and Performance Layer
// Evaluates supervisor and estimator behavior from real system activity.
// Scores are generated server-side and NOT shown to the scored role.
// Only authorized office roles (estimator, admin, principal) can review scores.

import { supabase } from './supabase';
import type { UserRole } from './types';

// ── Score Dimensions ─────────────────────────────────────────────────

interface SupervisorMetrics {
  photo_compliance: number;       // % of progress entries with photos
  defect_resolution_speed: number; // avg days from OPEN → RESOLVED
  rework_rate: number;            // rework_entries / total progress_entries
  progress_consistency: number;   // # of days with at least one progress entry
  vo_cause_accuracy: number;      // % of VOs with cause classified
}

interface EstimatorMetrics {
  gate1_auto_hold_rate: number;   // % of requests with CRITICAL flag not caught
  defect_validation_time: number; // avg hours from OPEN to VALIDATED
  milestone_revision_count: number;
  baseline_accuracy: number;      // % of Gate 1 checks that stay within 5%
  escalation_rate: number;        // HIGH/CRITICAL Gate 2 items per PO
}

export interface ScoringResult {
  user_id: string;
  role: UserRole;
  project_id: string;
  period: string; // YYYY-MM
  metrics: SupervisorMetrics | EstimatorMetrics;
  total_score: number; // 0–100
  computed_at: string;
}

// ── Supervisor Scoring ───────────────────────────────────────────────

export async function scoreSupervisor(
  userId: string,
  projectId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ScoringResult> {
  // 1. Photo compliance: entries with linked photos
  const { data: entries } = await supabase
    .from('progress_entries')
    .select('id, created_at')
    .eq('project_id', projectId)
    .eq('reported_by', userId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  const entryIds = (entries ?? []).map(e => e.id);
  const { count: photoCount } = await supabase
    .from('progress_photos')
    .select('*', { count: 'exact', head: true })
    .in('progress_entry_id', entryIds.length > 0 ? entryIds : ['__none__']);

  const totalEntries = entries?.length ?? 0;
  const photoCompliance = totalEntries > 0 ? Math.min(100, ((photoCount ?? 0) / totalEntries) * 100) : 100;

  // 2. Defect resolution speed (days from OPEN to RESOLVED)
  const { data: resolvedDefects } = await supabase
    .from('defects')
    .select('reported_at, resolved_at')
    .eq('project_id', projectId)
    .eq('reported_by', userId)
    .not('resolved_at', 'is', null)
    .gte('reported_at', periodStart)
    .lte('reported_at', periodEnd);

  const avgDays = (resolvedDefects ?? []).length > 0
    ? (resolvedDefects ?? []).reduce((s, d) => {
        const days = (new Date(d.resolved_at!).getTime() - new Date(d.reported_at).getTime()) / 86400000;
        return s + days;
      }, 0) / (resolvedDefects ?? []).length
    : 0;
  // Faster = better. Target: < 7 days. > 30 days = bad.
  const resolutionScore = avgDays === 0 ? 100 : Math.max(0, 100 - (avgDays - 7) * 3);

  // 3. Rework rate
  const { count: reworkCount } = await supabase
    .from('rework_entries')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('created_by', userId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  const reworkRate = totalEntries > 0 ? ((reworkCount ?? 0) / totalEntries) * 100 : 0;
  const reworkScore = Math.max(0, 100 - reworkRate * 5); // each % rework costs 5 pts

  // 4. Progress consistency (days with entries in period)
  const uniqueDays = new Set(
    (entries ?? []).map(e => e.created_at.split('T')[0])
  ).size;
  const workdays = Math.max(1, Math.round(
    (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86400000 * 5 / 7
  ));
  const consistencyScore = Math.min(100, (uniqueDays / workdays) * 100);

  // 5. VO cause accuracy
  const { data: vos } = await supabase
    .from('vo_entries')
    .select('cause')
    .eq('project_id', projectId)
    .eq('created_by', userId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  const classifiedVOs = (vos ?? []).filter(v => v.cause).length;
  const causeAccuracy = (vos ?? []).length > 0 ? (classifiedVOs / (vos ?? []).length) * 100 : 100;

  const metrics: SupervisorMetrics = {
    photo_compliance: Math.round(photoCompliance),
    defect_resolution_speed: Math.round(avgDays * 10) / 10,
    rework_rate: Math.round(reworkRate * 10) / 10,
    progress_consistency: Math.round(consistencyScore),
    vo_cause_accuracy: Math.round(causeAccuracy),
  };

  // Weighted composite
  const total = Math.round(
    photoCompliance * 0.25 +
    resolutionScore * 0.20 +
    reworkScore * 0.20 +
    consistencyScore * 0.20 +
    causeAccuracy * 0.15
  );

  return {
    user_id: userId,
    role: 'supervisor',
    project_id: projectId,
    period: periodStart.slice(0, 7),
    metrics,
    total_score: Math.min(100, Math.max(0, total)),
    computed_at: new Date().toISOString(),
  };
}

// ── Estimator Scoring ────────────────────────────────────────────────

export async function scoreEstimator(
  userId: string,
  projectId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ScoringResult> {
  // 1. Defect validation time (hours from OPEN to VALIDATED)
  const { data: validatedDefects } = await supabase
    .from('defects')
    .select('reported_at, status, updated_at')
    .eq('project_id', projectId)
    .in('status', ['VALIDATED', 'IN_REPAIR', 'RESOLVED', 'VERIFIED', 'ACCEPTED_BY_PRINCIPAL'])
    .gte('reported_at', periodStart)
    .lte('reported_at', periodEnd);

  // Approximate: time from reported to now as proxy for validation time
  const avgValidHours = (validatedDefects ?? []).length > 0 ? 24 : 0; // simplified
  const validationScore = Math.max(0, 100 - avgValidHours * 0.5);

  // 2. Milestone revision count (more = worse)
  const { count: revisionCount } = await supabase
    .from('milestone_revisions')
    .select('*', { count: 'exact', head: true })
    .eq('revised_by', userId)
    .gte('revised_at', periodStart)
    .lte('revised_at', periodEnd);

  const revisionScore = Math.max(0, 100 - (revisionCount ?? 0) * 10);

  // 3. Gate 2 escalation rate (HIGH/CRITICAL PO lines)
  const { data: approvalTasks } = await supabase
    .from('approval_tasks')
    .select('id')
    .eq('project_id', projectId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  const { data: pos } = await supabase
    .from('purchase_orders')
    .select('id')
    .eq('project_id', projectId)
    .gte('ordered_date', periodStart)
    .lte('ordered_date', periodEnd);

  const escalationRate = (pos ?? []).length > 0
    ? ((approvalTasks ?? []).length / (pos ?? []).length) * 100
    : 0;
  const escalationScore = Math.max(0, 100 - escalationRate * 2);

  // 4. VO cause coverage: all VOs reviewed get a bonus
  const { data: vos } = await supabase
    .from('vo_entries')
    .select('status')
    .eq('project_id', projectId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  const reviewedVOs = (vos ?? []).filter(v => v.status !== 'AWAITING').length;
  const reviewCoverage = (vos ?? []).length > 0
    ? (reviewedVOs / (vos ?? []).length) * 100
    : 100;

  const metrics: EstimatorMetrics = {
    gate1_auto_hold_rate: 0, // placeholder — requires joining request flags
    defect_validation_time: Math.round(avgValidHours),
    milestone_revision_count: revisionCount ?? 0,
    baseline_accuracy: 90, // placeholder
    escalation_rate: Math.round(escalationRate),
  };

  const total = Math.round(
    validationScore * 0.25 +
    revisionScore * 0.25 +
    escalationScore * 0.25 +
    reviewCoverage * 0.25
  );

  return {
    user_id: userId,
    role: 'estimator',
    project_id: projectId,
    period: periodStart.slice(0, 7),
    metrics,
    total_score: Math.min(100, Math.max(0, total)),
    computed_at: new Date().toISOString(),
  };
}

// ── Save Score ───────────────────────────────────────────────────────

export async function saveScore(result: ScoringResult): Promise<void> {
  await supabase.from('performance_scores').upsert({
    project_id: result.project_id,
    user_id: result.user_id,
    role: result.role,
    period: result.period,
    metrics: result.metrics,
    total_score: result.total_score,
    generated_at: result.computed_at,
  }, { onConflict: 'project_id,user_id,period' });
}

// ── Run Scoring for All Assigned Supervisors ─────────────────────────

export async function runProjectScoring(
  projectId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ supervisors: number; estimators: number }> {
  // Get all users assigned to project
  const { data: assignments } = await supabase
    .from('project_assignments')
    .select('user_id, profiles(role)')
    .eq('project_id', projectId);

  let supervisorCount = 0;
  let estimatorCount = 0;

  for (const a of assignments ?? []) {
    const role = (a.profiles as any)?.role as UserRole | undefined;
    if (!role) continue;

    try {
      if (role === 'supervisor') {
        const result = await scoreSupervisor(a.user_id, projectId, periodStart, periodEnd);
        await saveScore(result);
        supervisorCount++;
      } else if (role === 'estimator') {
        const result = await scoreEstimator(a.user_id, projectId, periodStart, periodEnd);
        await saveScore(result);
        estimatorCount++;
      }
    } catch (err: any) {
      console.warn(`Score failed for ${a.user_id}:`, err.message);
    }
  }

  return { supervisors: supervisorCount, estimators: estimatorCount };
}

// ── VO Cause Analytics ───────────────────────────────────────────────

export interface VOCauseAnalysis {
  cause: string;
  count: number;
  total_cost: number;
  pct_of_total: number;
}

export async function analyzeVOCauses(projectId: string): Promise<VOCauseAnalysis[]> {
  const { data: vos } = await supabase
    .from('vo_entries')
    .select('cause, est_cost')
    .eq('project_id', projectId);

  const causeTotals: Record<string, { count: number; cost: number }> = {};
  const total = (vos ?? []).length;

  for (const vo of vos ?? []) {
    const cause = vo.cause ?? 'unclassified';
    if (!causeTotals[cause]) causeTotals[cause] = { count: 0, cost: 0 };
    causeTotals[cause].count++;
    causeTotals[cause].cost += vo.est_cost ?? 0;
  }

  return Object.entries(causeTotals)
    .map(([cause, t]) => ({
      cause,
      count: t.count,
      total_cost: t.cost,
      pct_of_total: total > 0 ? Math.round((t.count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);
}
