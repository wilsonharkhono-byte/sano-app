// SAN Contractor — Schedule Layer
// Derives milestone status from real progress data.
// Status engine: ON_TRACK | AT_RISK | DELAYED | AHEAD | COMPLETE

import { supabase } from './supabase';
import type { Milestone, MilestoneStatus, BoqItem, CreateMilestoneInput, UpdateMilestoneInput } from './types';

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
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .eq('author_status', 'confirmed');

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
      .eq('id', s.milestone_id)
      .is('deleted_at', null);
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
    .select('planned_date, revised_date, label, deleted_at')
    .eq('id', milestoneId)
    .single();

  if (fetchErr || !existing || existing.deleted_at) {
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

export interface PlannedDateValidation {
  ok: boolean;
  conflictMilestoneId?: string;
  conflictDate?: string;
}

/**
 * A milestone's planned_date must be ≥ max(planned_date of its predecessors).
 * Dangling predecessor IDs are ignored.
 */
export function validatePlannedDate(
  all: Milestone[],
  dependsOn: string[],
  plannedDate: string,
): PlannedDateValidation {
  const byId = new Map(all.map(m => [m.id, m]));
  for (const predId of dependsOn) {
    const pred = byId.get(predId);
    if (!pred) continue;
    const predDate = pred.revised_date ?? pred.planned_date;
    if (plannedDate < predDate) {
      return {
        ok: false,
        conflictMilestoneId: predId,
        conflictDate: predDate,
      };
    }
  }
  return { ok: true };
}

/**
 * When milestone `deletedId` is soft-deleted, every other milestone that has
 * it in `depends_on` needs to have that reference removed. Returns the patches
 * to apply. Transitive descendants are NOT updated here — they keep their
 * other predecessors unchanged.
 */
export function cascadeCleanupDependsOn(
  all: Milestone[],
  deletedId: string,
): Array<{ id: string; depends_on: string[] }> {
  return all
    .filter(m => m.id !== deletedId && m.depends_on.includes(deletedId))
    .map(m => ({
      id: m.id,
      depends_on: m.depends_on.filter(d => d !== deletedId),
    }));
}

// ── Result type (spec §4) ────────────────────────────────────────────

export type MilestoneResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ── createMilestone ──────────────────────────────────────────────────

export async function createMilestone(
  input: CreateMilestoneInput,
): Promise<MilestoneResult<Milestone>> {
  // 1. Validate label
  const label = input.label.trim();
  if (!label) {
    return { success: false, error: 'Nama milestone wajib diisi.' };
  }

  // 2. Fetch existing project milestones (for uniqueness + cycle + date checks)
  const { data: existing, error: fetchErr } = await supabase
    .from('milestones')
    .select('*')
    .eq('project_id', input.project_id)
    .is('deleted_at', null);

  if (fetchErr) return { success: false, error: fetchErr.message };
  const existingRows: Milestone[] = existing ?? [];

  // 3. Uniqueness (case-insensitive)
  const clash = existingRows.find(
    m => m.label.trim().toLowerCase() === label.toLowerCase(),
  );
  if (clash) {
    return { success: false, error: `Milestone "${label}" sudah ada di proyek ini.` };
  }

  // 4. Predecessor project scoping
  for (const predId of input.depends_on) {
    if (!existingRows.some(m => m.id === predId)) {
      return { success: false, error: 'Predecessor milestone tidak ditemukan di proyek ini.' };
    }
  }

  // 5. Planned-date vs predecessors
  const dateCheck = validatePlannedDate(existingRows, input.depends_on, input.planned_date);
  if (!dateCheck.ok) {
    const conflict = existingRows.find(m => m.id === dateCheck.conflictMilestoneId);
    return {
      success: false,
      error: `Target tanggal harus ≥ ${dateCheck.conflictDate} (milestone "${conflict?.label ?? dateCheck.conflictMilestoneId}").`,
    };
  }

  // 6. Cycle check against a synthetic projected graph
  const synthetic: Milestone = {
    id: '__new__',
    project_id: input.project_id,
    label,
    planned_date: input.planned_date,
    revised_date: null,
    revision_reason: null,
    boq_ids: input.boq_ids,
    status: 'ON_TRACK',
    depends_on: input.depends_on,
    proposed_by: input.proposed_by ?? 'human',
    confidence_score: input.confidence_score ?? null,
    ai_explanation: input.ai_explanation ?? null,
    author_status: input.author_status ?? 'confirmed',
    deleted_at: null,
  };
  if (!validateNoCycle(existingRows, synthetic)) {
    return { success: false, error: 'Milestone ini akan membuat siklus dependensi.' };
  }

  // 7. Insert
  const { data: inserted, error: insertErr } = await supabase
    .from('milestones')
    .insert({
      project_id: input.project_id,
      label,
      planned_date: input.planned_date,
      boq_ids: input.boq_ids,
      depends_on: input.depends_on,
      proposed_by: input.proposed_by ?? 'human',
      confidence_score: input.confidence_score ?? null,
      ai_explanation: input.ai_explanation ?? null,
      author_status: input.author_status ?? 'confirmed',
      status: 'ON_TRACK',
    })
    .select()
    .single();

  if (insertErr || !inserted) {
    return { success: false, error: insertErr?.message ?? 'Gagal membuat milestone.' };
  }

  return { success: true, data: inserted as Milestone };
}

// ── updateMilestone ──────────────────────────────────────────────────

export async function updateMilestone(
  id: string,
  patch: UpdateMilestoneInput,
): Promise<MilestoneResult<Milestone>> {
  // 1. Load existing
  const { data: existing, error: loadErr } = await supabase
    .from('milestones')
    .select('*')
    .eq('id', id)
    .single();

  if (loadErr || !existing) {
    return { success: false, error: 'Milestone tidak ditemukan.' };
  }
  const current = existing as Milestone;
  if (current.deleted_at) {
    return { success: false, error: 'Milestone sudah dihapus.' };
  }

  // 2. Load siblings for validation
  const { data: siblings, error: sibErr } = await supabase
    .from('milestones')
    .select('*')
    .eq('project_id', current.project_id)
    .is('deleted_at', null);
  if (sibErr) return { success: false, error: sibErr.message };
  const all: Milestone[] = siblings ?? [];

  // 3. Compute projected row
  const projected: Milestone = {
    ...current,
    label: patch.label !== undefined ? patch.label.trim() : current.label,
    planned_date: patch.planned_date ?? current.planned_date,
    boq_ids: patch.boq_ids ?? current.boq_ids,
    depends_on: patch.depends_on ?? current.depends_on,
    author_status: patch.author_status ?? current.author_status,
  };

  if (!projected.label) {
    return { success: false, error: 'Nama milestone wajib diisi.' };
  }

  // 4. Uniqueness (exclude self)
  const clash = all.find(
    m => m.id !== id && m.label.trim().toLowerCase() === projected.label.toLowerCase(),
  );
  if (clash) {
    return { success: false, error: `Milestone "${projected.label}" sudah ada di proyek ini.` };
  }

  // 5. Project scoping of predecessors
  for (const predId of projected.depends_on) {
    if (predId === id) {
      return { success: false, error: 'Milestone ini akan membuat siklus dependensi.' };
    }
    if (!all.some(m => m.id === predId)) {
      return { success: false, error: 'Predecessor milestone tidak ditemukan di proyek ini.' };
    }
  }

  // 6. Date check
  const dateCheck = validatePlannedDate(all, projected.depends_on, projected.planned_date);
  if (!dateCheck.ok) {
    const conflict = all.find(m => m.id === dateCheck.conflictMilestoneId);
    return {
      success: false,
      error: `Target tanggal harus ≥ ${dateCheck.conflictDate} (milestone "${conflict?.label ?? dateCheck.conflictMilestoneId}").`,
    };
  }

  // 7. Cycle check
  if (!validateNoCycle(all, projected)) {
    return { success: false, error: 'Milestone ini akan membuat siklus dependensi.' };
  }

  // 8. Write
  const updatePayload: Record<string, unknown> = {};
  if (patch.label !== undefined) updatePayload.label = projected.label;
  if (patch.planned_date !== undefined) updatePayload.planned_date = projected.planned_date;
  if (patch.boq_ids !== undefined) updatePayload.boq_ids = projected.boq_ids;
  if (patch.depends_on !== undefined) updatePayload.depends_on = projected.depends_on;
  if (patch.author_status !== undefined) updatePayload.author_status = projected.author_status;

  const { data: updated, error: updateErr } = await supabase
    .from('milestones')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (updateErr || !updated) {
    return { success: false, error: updateErr?.message ?? 'Gagal memperbarui milestone.' };
  }
  return { success: true, data: updated as Milestone };
}

// ── deleteMilestone ──────────────────────────────────────────────────

export async function deleteMilestone(
  id: string,
): Promise<MilestoneResult<{ cleanedReferences: number }>> {
  // 1. Load target
  const { data: target, error: loadErr } = await supabase
    .from('milestones')
    .select('*')
    .eq('id', id)
    .single();

  if (loadErr || !target) {
    return { success: false, error: 'Milestone tidak ditemukan.' };
  }
  const current = target as Milestone;
  if (current.deleted_at) {
    return { success: false, error: 'Milestone sudah dihapus.' };
  }

  // 2. Load siblings for cascade
  const { data: siblings, error: sibErr } = await supabase
    .from('milestones')
    .select('*')
    .eq('project_id', current.project_id)
    .is('deleted_at', null);
  if (sibErr) return { success: false, error: sibErr.message };

  const cleanups = cascadeCleanupDependsOn(siblings ?? [], id);

  // 3. Soft-delete target
  const nowIso = new Date().toISOString();
  const { error: deleteErr } = await supabase
    .from('milestones')
    .update({ deleted_at: nowIso })
    .eq('id', id);
  if (deleteErr) return { success: false, error: deleteErr.message };

  // 4. Apply cascade patches
  for (const patch of cleanups) {
    const { error: patchErr } = await supabase
      .from('milestones')
      .update({ depends_on: patch.depends_on })
      .eq('id', patch.id);
    if (patchErr) console.warn('cascade cleanup failed for', patch.id, patchErr.message);
  }

  return { success: true, data: { cleanedReferences: cleanups.length } };
}

// ── createMilestonesBulk ─────────────────────────────────────────────

export async function createMilestonesBulk(
  projectId: string,
  drafts: CreateMilestoneInput[],
): Promise<MilestoneResult<Milestone[]>> {
  if (drafts.length === 0) return { success: true, data: [] };

  const payload = drafts.map(d => ({
    project_id: projectId,
    label: d.label.trim(),
    planned_date: d.planned_date,
    boq_ids: d.boq_ids,
    depends_on: d.depends_on,
    proposed_by: d.proposed_by ?? 'ai',
    confidence_score: d.confidence_score ?? null,
    ai_explanation: d.ai_explanation ?? null,
    author_status: d.author_status ?? 'draft',
    status: 'ON_TRACK',
  }));

  const { data, error } = await supabase
    .from('milestones')
    .insert(payload)
    .select();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Gagal membuat draf milestone.' };
  }
  return { success: true, data: data as Milestone[] };
}
