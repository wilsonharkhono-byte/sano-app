// tools/analytics/data.ts
// SANO — reads for the project analytics (spec 2026-09-17 §5.3), one function
// per card so a collapsed card costs nothing. Everything goes through RLS and
// pages past PostgREST's 1,000-row cap; a read error is thrown, never shown
// as an empty chart. The only write is the project's dates.
import { fetchAllPaged } from '../queryHelpers';
import { supabase } from '../supabase';
import { isRealCalendarDate } from '../timeWindow';
import type { RequestHeader } from './approvalFlow';
import type { DiaryReport } from './diaryActivity';
import type { CatalogEntry, PlannedLine, RequestedLine } from './materialCoverage';

type Page<T> = PromiseLike<{ data: T[] | null; error: { message?: string } | null }>;
const ID_CHUNK = 100;

export async function loadProgressEntries(projectId: string): Promise<Array<{ boq_item_id: string; quantity: number; created_at: string }>> {
  const rows = await fetchAllPaged<{ boq_item_id: string; quantity: number | string; created_at: string }>((from, to) =>
    supabase.from('progress_entries').select('boq_item_id, quantity, created_at').eq('project_id', projectId).order('created_at').order('id').range(from, to) as unknown as Page<{ boq_item_id: string; quantity: number | string; created_at: string }>);
  return rows.map((r) => ({ boq_item_id: r.boq_item_id, quantity: Number(r.quantity) || 0, created_at: r.created_at }));
}

interface ReportRow { id: string; report_no: number; revision: number | null; period_start: string; crewTotal: unknown; updates: unknown }

export async function loadDiaryData(projectId: string): Promise<{ reports: DiaryReport[]; links: Map<string, string | null> }> {
  const rows = await fetchAllPaged<ReportRow>((from, to) =>
    supabase.from('client_progress_reports')
      .select('id, report_no, revision, period_start, crewTotal:snapshot->crewTotal, updates:snapshot->updates')
      .eq('project_id', projectId).order('period_start').order('id').range(from, to) as unknown as Page<ReportRow>);
  const linkRows = await fetchAllPaged<{ report_id: string; line_index: number; stage: string | null }>((from, to) =>
    supabase.from('client_report_lines')
      .select('report_id, line_index, stage, client_progress_reports!inner(project_id)')
      .eq('status', 'CONFIRMED').eq('client_progress_reports.project_id', projectId).order('id').range(from, to) as unknown as Page<{ report_id: string; line_index: number; stage: string | null }>);
  return {
    reports: rows.map((r) => ({
      id: r.id, report_no: r.report_no, revision: r.revision, period_start: r.period_start,
      crewTotal: typeof r.crewTotal === 'number' && Number.isFinite(r.crewTotal) ? r.crewTotal : null,
      updates: Array.isArray(r.updates) ? (r.updates as DiaryReport['updates']) : [],
    })),
    links: new Map(linkRows.map((l) => [`${l.report_id}:${l.line_index}`, l.stage])),
  };
}

interface RequestLineRow {
  request_header_id: string;
  material_id: string | null;
  quantity: number | string;
  material_request_line_allocations: Array<{ boq_item_id: string | null; allocated_quantity: number | string }> | null;
}

export async function loadMaterialData(projectId: string): Promise<{ planned: PlannedLine[]; requests: RequestedLine[]; catalog: Map<string, CatalogEntry> }> {
  const { data: masters, error: masterError } = await supabase
    .from('project_material_master').select('id').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1);
  if (masterError) throw new Error(masterError.message);
  const masterId = (masters as Array<{ id: string }> | null)?.[0]?.id ?? null;
  const plannedRows = masterId
    ? await fetchAllPaged<{ material_id: string | null; boq_item_id: string | null; planned_quantity: number | string }>((from, to) =>
      supabase.from('project_material_master_lines').select('material_id, boq_item_id, planned_quantity').eq('master_id', masterId).order('id').range(from, to) as unknown as Page<{ material_id: string | null; boq_item_id: string | null; planned_quantity: number | string }>)
    : [];
  const catalogRows = await fetchAllPaged<CatalogEntry & { id: string }>((from, to) =>
    supabase.from('material_catalog').select('id, name, category, unit, is_asset').order('id').range(from, to) as unknown as Page<CatalogEntry & { id: string }>);
  const headers = await fetchAllPaged<{ id: string; created_at: string; reviewed_at: string | null; overall_status: string }>((from, to) =>
    supabase.from('material_request_headers').select('id, created_at, reviewed_at, overall_status').eq('project_id', projectId).order('created_at').order('id').range(from, to) as unknown as Page<{ id: string; created_at: string; reviewed_at: string | null; overall_status: string }>);
  const headerById = new Map(headers.map((h) => [h.id, h]));
  const requests: RequestedLine[] = [];
  for (let i = 0; i < headers.length; i += ID_CHUNK) {
    const ids = headers.slice(i, i + ID_CHUNK).map((h) => h.id);
    const { data, error } = await supabase
      .from('material_request_lines')
      .select('request_header_id, material_id, quantity, material_request_line_allocations(boq_item_id, allocated_quantity)')
      .in('request_header_id', ids);
    if (error) throw new Error(error.message);
    for (const l of (data ?? []) as unknown as RequestLineRow[]) {
      const header = headerById.get(l.request_header_id);
      if (!header) continue;
      requests.push({
        material_id: l.material_id, quantity: Number(l.quantity) || 0, status: header.overall_status, created_at: header.created_at,
        reviewed_at: header.reviewed_at ?? null,
        allocations: (l.material_request_line_allocations ?? []).map((a) => ({ boq_item_id: a.boq_item_id, allocated_quantity: Number(a.allocated_quantity) || 0 })),
      });
    }
  }
  return {
    planned: plannedRows.map((p) => ({ material_id: p.material_id, boq_item_id: p.boq_item_id, planned_quantity: Number(p.planned_quantity) || 0 })),
    requests,
    catalog: new Map(catalogRows.map(({ id, ...entry }) => [id, entry])),
  };
}

export async function loadApprovalData(projectId: string): Promise<RequestHeader[]> {
  return fetchAllPaged<RequestHeader>((from, to) =>
    supabase.from('material_request_headers').select('created_at, reviewed_at, overall_status').eq('project_id', projectId).order('created_at').order('id').range(from, to) as unknown as Page<RequestHeader>);
}

/** Null when the two dates can be saved; otherwise the sentence to show. */
export function validateProjectDates(start: string, end: string): string | null {
  if (!isRealCalendarDate(start.trim())) return 'Isi tanggal mulai dengan format TTTT-BB-HH.';
  if (!isRealCalendarDate(end.trim())) return 'Isi tanggal selesai rencana dengan format TTTT-BB-HH.';
  if (end.trim() <= start.trim()) return 'Tanggal selesai rencana harus setelah tanggal mulai.';
  return null;
}

/** Saved through the projects_manager_update policy (036): admin and principal. RLS that matches no row is an error here, not a silent success. */
export async function saveProjectDates(projectId: string, start: string, end: string): Promise<void> {
  const invalid = validateProjectDates(start, end);
  if (invalid) throw new Error(invalid);
  const { data, error } = await supabase.from('projects').update({ start_date: start.trim(), end_date: end.trim() }).eq('id', projectId).select('id');
  if (error) throw new Error(error.message);
  if (!data || (data as unknown[]).length === 0) throw new Error('Tanggal tidak tersimpan. Hanya admin atau prinsipal yang bisa mengubah tanggal proyek.');
}
