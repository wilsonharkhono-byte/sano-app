// SANO — Client Progress Report assembly
// Aggregates the Daily Site Log + existing quantitative data into a curated
// draft, renders numbering, and freezes a snapshot on issue.
// NOTE: 'client_progress_report' is intentionally NOT a ReportType — this path
// never routes through generateReport()/exportReportToPdf().

import { supabase } from './supabase';
import type { MilestoneStatus } from './types';

const STATUS_LABELS: Record<MilestoneStatus, string> = {
  ON_TRACK: 'Sesuai Jadwal',
  AHEAD: 'Lebih Cepat',
  AT_RISK: 'Perlu Perhatian',
  DELAYED: 'Terlambat',
  COMPLETE: 'Selesai',
};

// Worst-first severity for rolling many milestone statuses into one label.
const SEVERITY: MilestoneStatus[] = ['DELAYED', 'AT_RISK', 'ON_TRACK', 'AHEAD', 'COMPLETE'];

export function mapMilestoneStatusToLabel(status: MilestoneStatus): string {
  return STATUS_LABELS[status] ?? 'Sesuai Jadwal';
}

export function deriveProjectStatusLabel(statuses: MilestoneStatus[]): string {
  if (statuses.length === 0) return 'Sesuai Jadwal';
  for (const s of SEVERITY) {
    if (statuses.includes(s)) return mapMilestoneStatusToLabel(s);
  }
  return 'Sesuai Jadwal';
}

export async function installedAsOf(projectId: string, isoDateEnd: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('progress_entries')
    .select('boq_item_id, quantity, created_at')
    .eq('project_id', projectId)
    .lte('created_at', isoDateEnd);
  if (error) throw error;

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(row.boq_item_id, (map.get(row.boq_item_id) ?? 0) + (row.quantity ?? 0));
  }
  return map;
}

function overallProgress(boqItems: Array<{ id: string; planned: number }>, installed: Map<string, number>): number {
  const withPlan = boqItems.filter((b) => b.planned > 0);
  if (withPlan.length === 0) return 0;
  const sum = withPlan.reduce((s, b) => s + Math.min(100, ((installed.get(b.id) ?? 0) / b.planned) * 100), 0);
  return sum / withPlan.length;
}

export async function computeWeeklyProgressDelta(
  projectId: string,
  boqItems: Array<{ id: string; planned: number }>,
  startIso: string,
  endIso: string,
): Promise<number> {
  // Overall progress as of midnight opening the period start vs. end-of-day of the period end.
  const [atStart, atEnd] = await Promise.all([
    installedAsOf(projectId, `${startIso}T00:00:00`),
    installedAsOf(projectId, `${endIso}T23:59:59`),
  ]);
  return overallProgress(boqItems, atEnd) - overallProgress(boqItems, atStart);
}
