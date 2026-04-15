// SAN Contractor — Schedule Layer
// Derives milestone status from real progress data.
// Status engine: ON_TRACK | AT_RISK | DELAYED | AHEAD | COMPLETE

import { supabase } from './supabase';
import type { Milestone, MilestoneStatus, BoqItem } from './types';

// ── Status Engine ────────────────────────────────────────────────────

interface MilestoneProgress {
  milestone: Milestone;
  linked_items: BoqItem[];
  avg_progress: number;
  days_remaining: number;
  expected_progress_pct: number; // what % should be done by now based on time elapsed
}

export function deriveMilestoneStatus(mp: MilestoneProgress): MilestoneStatus {
  const { avg_progress, days_remaining, expected_progress_pct } = mp;

  // Already past deadline
  if (days_remaining < 0) {
    return avg_progress >= 100 ? 'COMPLETE' : 'DELAYED';
  }

  // Fully done ahead of schedule
  if (avg_progress >= 100) return 'AHEAD';

  // Behind expected pace by more than 20%
  if (avg_progress < expected_progress_pct - 20) {
    return days_remaining <= 7 ? 'DELAYED' : 'AT_RISK';
  }

  // Ahead of expected pace by more than 15%
  if (avg_progress > expected_progress_pct + 15) return 'AHEAD';

  return 'ON_TRACK';
}

// ── Compute Expected Progress ─────────────────────────────────────
// Based on how much of the milestone window has elapsed.

function computeExpectedProgress(milestone: Milestone): number {
  const today = new Date();
  const planned = new Date(milestone.planned_date);

  // Assume milestones start 30 days before their planned date
  const windowDays = 30;
  const startDate = new Date(planned.getTime() - windowDays * 86400000);
  const elapsed = (today.getTime() - startDate.getTime()) / 86400000;
  const pct = Math.max(0, Math.min(100, (elapsed / windowDays) * 100));
  return Math.round(pct);
}

// ── Derive All Milestone Statuses ────────────────────────────────────

export async function deriveMilestoneStatuses(projectId: string): Promise<
  Array<{ milestone_id: string; computed_status: MilestoneStatus; avg_progress: number }>
> {
  const { data: milestones } = await supabase
    .from('milestones')
    .select('*')
    .eq('project_id', projectId);

  const { data: boqItems } = await supabase
    .from('boq_items')
    .select('id, progress')
    .eq('project_id', projectId);

  if (!milestones || !boqItems) return [];

  const boqMap = new Map((boqItems).map(b => [b.id, b.progress]));

  return milestones.map(m => {
    const linkedProgress = (m.boq_ids ?? [])
      .map((id: string) => boqMap.get(id) ?? 0);
    const avgProgress = linkedProgress.length > 0
      ? Math.round(linkedProgress.reduce((s: number, p: number) => s + p, 0) / linkedProgress.length)
      : 0;

    const today = new Date();
    const planned = new Date(m.revised_date ?? m.planned_date);
    const daysRemaining = Math.round((planned.getTime() - today.getTime()) / 86400000);
    const expectedProgress = computeExpectedProgress(m);

    const mp: MilestoneProgress = {
      milestone: m,
      linked_items: [],
      avg_progress: avgProgress,
      days_remaining: daysRemaining,
      expected_progress_pct: expectedProgress,
    };

    return {
      milestone_id: m.id,
      computed_status: deriveMilestoneStatus(mp),
      avg_progress: avgProgress,
    };
  });
}

// ── Sync Milestone Statuses Back to DB ──────────────────────────────

export async function syncMilestoneStatuses(projectId: string): Promise<number> {
  const statuses = await deriveMilestoneStatuses(projectId);
  let updated = 0;

  for (const s of statuses) {
    const { error } = await supabase
      .from('milestones')
      .update({ status: s.computed_status })
      .eq('id', s.milestone_id);
    if (!error) updated++;
  }
  return updated;
}

// ── Milestone Revision Log ───────────────────────────────────────────

export async function reviseMilestone(
  milestoneId: string,
  newDate: string,
  reason: string,
  userId: string,
  projectId: string,
): Promise<{ success: boolean; error?: string }> {
  // Load existing milestone to record old date
  const { data: existing, error: fetchErr } = await supabase
    .from('milestones')
    .select('planned_date, revised_date, label')
    .eq('id', milestoneId)
    .single();

  if (fetchErr || !existing) {
    return { success: false, error: 'Milestone tidak ditemukan.' };
  }

  const { error: updateErr } = await supabase
    .from('milestones')
    .update({
      revised_date: newDate,
      revision_reason: reason,
    })
    .eq('id', milestoneId);

  if (updateErr) return { success: false, error: updateErr.message };

  // Write audit log entry
  await supabase.from('activity_log').insert({
    project_id: projectId,
    user_id: userId,
    type: 'permintaan', // reuse closest type; production would add 'milestone_revision'
    label: `Milestone "${existing.label}" direvisi: ${existing.revised_date ?? existing.planned_date} → ${newDate}. Alasan: ${reason}`,
    flag: 'WARNING',
  });

  return { success: true };
}

// ── Project Health Summary ───────────────────────────────────────────

export interface ProjectHealthSummary {
  overall_progress: number;
  on_track: number;
  at_risk: number;
  delayed: number;
  ahead: number;
  complete: number;
  total_milestones: number;
  health: 'GREEN' | 'AT_RISK' | 'RED';
}

export async function computeProjectHealth(projectId: string): Promise<ProjectHealthSummary> {
  const statuses = await deriveMilestoneStatuses(projectId);

  const { data: boqItems } = await supabase
    .from('boq_items')
    .select('progress')
    .eq('project_id', projectId);

  const items = boqItems ?? [];
  const overallProgress = items.length > 0
    ? Math.round(items.reduce((s: number, b: { progress: number }) => s + b.progress, 0) / items.length)
    : 0;

  const counts = {
    on_track: statuses.filter(s => s.computed_status === 'ON_TRACK').length,
    at_risk: statuses.filter(s => s.computed_status === 'AT_RISK').length,
    delayed: statuses.filter(s => s.computed_status === 'DELAYED').length,
    ahead: statuses.filter(s => s.computed_status === 'AHEAD').length,
    complete: statuses.filter(s => s.computed_status === 'COMPLETE').length,
  };

  const health: 'GREEN' | 'AT_RISK' | 'RED' =
    counts.delayed > 0 ? 'RED' :
    counts.at_risk > 0 ? 'AT_RISK' :
    'GREEN';

  return {
    overall_progress: overallProgress,
    ...counts,
    total_milestones: statuses.length,
    health,
  };
}

// ── Graph Utilities (spec §4) ────────────────────────────────────────

/**
 * Kahn's algorithm topological sort over `depends_on` edges.
 * Tie-breaks by planned_date ascending.
 * On cycle detection, logs a warning and returns input in date order.
 */
export function topologicalSort(milestones: Milestone[]): Milestone[] {
  if (milestones.length === 0) return [];

  const byId = new Map(milestones.map(m => [m.id, m]));
  const inDegree = new Map<string, number>();
  const successors = new Map<string, string[]>();

  for (const m of milestones) {
    inDegree.set(m.id, 0);
    successors.set(m.id, []);
  }

  for (const m of milestones) {
    for (const predId of m.depends_on) {
      if (!byId.has(predId)) continue; // ignore dangling edge
      inDegree.set(m.id, (inDegree.get(m.id) ?? 0) + 1);
      successors.get(predId)!.push(m.id);
    }
  }

  const cmp = (a: Milestone, b: Milestone) =>
    a.planned_date.localeCompare(b.planned_date);

  const ready: Milestone[] = milestones
    .filter(m => (inDegree.get(m.id) ?? 0) === 0)
    .sort(cmp);

  const out: Milestone[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    out.push(next);
    for (const succId of successors.get(next.id) ?? []) {
      const d = (inDegree.get(succId) ?? 0) - 1;
      inDegree.set(succId, d);
      if (d === 0) {
        const succ = byId.get(succId)!;
        // insert sorted
        const idx = ready.findIndex(r => cmp(succ, r) < 0);
        if (idx < 0) ready.push(succ);
        else ready.splice(idx, 0, succ);
      }
    }
  }

  if (out.length !== milestones.length) {
    console.warn('topologicalSort: cycle detected, falling back to date order');
    return [...milestones].sort(cmp);
  }

  return out;
}

/**
 * Returns true iff the projected post-edit graph (existing + updated) has no cycle.
 * DFS-based. The updated milestone replaces any existing entry with the same id,
 * or is appended if new.
 */
export function validateNoCycle(existing: Milestone[], updated: Milestone): boolean {
  const projected: Milestone[] = existing
    .filter(m => m.id !== updated.id)
    .concat(updated);

  const byId = new Map(projected.map(m => [m.id, m]));

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const m of projected) color.set(m.id, WHITE);

  const visit = (id: string): boolean => {
    if (color.get(id) === GRAY) return false; // back-edge ⇒ cycle
    if (color.get(id) === BLACK) return true;
    color.set(id, GRAY);
    const node = byId.get(id);
    if (node) {
      for (const predId of node.depends_on) {
        if (predId === id) return false; // self-loop
        if (!byId.has(predId)) continue; // dangling
        if (!visit(predId)) return false;
      }
    }
    color.set(id, BLACK);
    return true;
  };

  for (const m of projected) {
    if (!visit(m.id)) return false;
  }
  return true;
}
