// tools/analytics/materialCoverage.ts
// SANO — Material vs progres (spec 2026-09-17 §5.3.2): what was requested and
// approved against the BoQ plan, and how long after a request the work shows
// up in the daily reports. Quantities are only ever added within one catalogue
// category and one unit. Pure.
import { dateOf, daysBetween } from './weekBuckets';
import type { WorkType } from './workType';

export const WAITING_AFTER_DAYS = 14;

/** The work a catalogue category feeds, for the request-to-work lag. */
const CATEGORY_WORK: Record<string, WorkType> = {
  Struktur: 'PEMBESIAN', 'Kayu & Bekisting': 'BEKISTING', 'Material Beton': 'PENGECORAN', Dinding: 'PASANGAN', Plumbing: 'MEP',
};

export interface CatalogEntry { name: string; category: string | null; unit: string | null; is_asset?: boolean | null }
export interface PlannedLine { material_id: string | null; boq_item_id: string | null; planned_quantity: number }
export interface RequestedLine {
  material_id: string | null;
  quantity: number;
  /** material_request_headers.overall_status */
  status: string;
  created_at: string;
  allocations: Array<{ boq_item_id: string | null; allocated_quantity: number }>;
}

export interface CoverageGroup {
  /** "Struktur · kg" */
  key: string;
  category: string;
  unit: string;
  planned: number;
  /** Everything asked for and not rejected. */
  requested: number;
  approved: number;
  requestedPct: number | null;
  approvedPct: number | null;
  requestCount: number;
  workType: WorkType | null;
  firstRequest: string | null;
  firstMention: string | null;
  /** Days from the first request to the first diary mention; negative when the work came first. */
  lagDays: number | null;
  /** Requested more than 14 days ago and the work is not in the diary yet. */
  waiting: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const counts = (status: string) => status !== 'REJECTED';

function groupOf(catalog: ReadonlyMap<string, CatalogEntry>, materialId: string | null): { key: string; category: string; unit: string } | null {
  const m = materialId ? catalog.get(materialId) : null;
  if (!m || m.is_asset || !m.category || !m.unit || m.category === 'Peralatan') return null;
  return { key: `${m.category} · ${m.unit}`, category: m.category, unit: m.unit };
}

export function buildMaterialCoverage(input: {
  planned: PlannedLine[];
  requests: RequestedLine[];
  catalog: ReadonlyMap<string, CatalogEntry>;
  firstMentions: ReadonlyMap<WorkType, string>;
  today: string;
}): { groups: CoverageGroup[] } {
  const groups = new Map<string, CoverageGroup>();
  const ensure = (g: { key: string; category: string; unit: string }) => {
    if (!groups.has(g.key)) {
      groups.set(g.key, {
        ...g, planned: 0, requested: 0, approved: 0, requestedPct: null, approvedPct: null, requestCount: 0,
        workType: CATEGORY_WORK[g.category] ?? null, firstRequest: null, firstMention: null, lagDays: null, waiting: false,
      });
    }
    return groups.get(g.key) as CoverageGroup;
  };
  for (const p of input.planned) {
    const g = groupOf(input.catalog, p.material_id);
    if (g) ensure(g).planned += Number(p.planned_quantity) || 0;
  }
  for (const r of input.requests) {
    const g = groupOf(input.catalog, r.material_id);
    if (!g || !counts(r.status)) continue;
    const group = ensure(g);
    group.requested += Number(r.quantity) || 0;
    if (r.status === 'APPROVED') group.approved += Number(r.quantity) || 0;
    group.requestCount += 1;
    const date = dateOf(r.created_at);
    if (!group.firstRequest || date < group.firstRequest) group.firstRequest = date;
  }
  for (const group of groups.values()) {
    group.planned = round1(group.planned);
    group.requested = round1(group.requested);
    group.approved = round1(group.approved);
    if (group.planned > 0) {
      group.requestedPct = round1((100 * group.requested) / group.planned);
      group.approvedPct = round1((100 * group.approved) / group.planned);
    }
    group.firstMention = group.workType ? input.firstMentions.get(group.workType) ?? null : null;
    if (group.firstRequest && group.firstMention) group.lagDays = daysBetween(group.firstRequest, group.firstMention);
    group.waiting = !!group.firstRequest && !!group.workType && !group.firstMention && daysBetween(group.firstRequest, input.today) > WAITING_AFTER_DAYS;
  }
  // Groups with a plan first, largest plan first; then what was requested without a plan.
  return { groups: [...groups.values()].filter((g) => g.planned > 0 || g.requested > 0).sort((a, b) => b.planned - a.planned || b.requested - a.requested) };
}

/** Planned, requested and approved per work area for one category and unit (the claim flag reads besi this way). */
export function coverageByRow(
  input: { planned: PlannedLine[]; requests: RequestedLine[]; catalog: ReadonlyMap<string, CatalogEntry> },
  category: string,
  unit: string,
): Map<string, { planned: number; requested: number; approved: number }> {
  const rows = new Map<string, { planned: number; requested: number; approved: number }>();
  const ensure = (id: string) => { if (!rows.has(id)) rows.set(id, { planned: 0, requested: 0, approved: 0 }); return rows.get(id)!; };
  const inGroup = (materialId: string | null) => { const g = groupOf(input.catalog, materialId); return !!g && g.category === category && g.unit === unit; };
  for (const p of input.planned) if (p.boq_item_id && inGroup(p.material_id)) ensure(p.boq_item_id).planned += Number(p.planned_quantity) || 0;
  for (const r of input.requests) {
    if (!inGroup(r.material_id) || !counts(r.status)) continue;
    for (const a of r.allocations) {
      if (!a.boq_item_id) continue;
      const row = ensure(a.boq_item_id);
      row.requested += Number(a.allocated_quantity) || 0;
      if (r.status === 'APPROVED') row.approved += Number(a.allocated_quantity) || 0;
    }
  }
  for (const row of rows.values()) { row.planned = round1(row.planned); row.requested = round1(row.requested); row.approved = round1(row.approved); }
  return rows;
}
