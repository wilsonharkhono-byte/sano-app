import type { StagingRowV2, CostSplit } from './boqParserV2/types';
import { toNumber } from './boqParserV2/classifyComponent';
import { reconcileMaterials } from './excelParser';
import type { CatalogEntry } from './excelParser';
import { resilientWrite } from './resilientWrite';
import { normalizeUnit, toBaseQty } from './materialUnitConversion';
import { aggregatePlannedByMaterial } from './planRevisionDiff';
import type { PlanRevisionLine, PlanRevisionSummary } from './planRevisionDiff';
import { proposedAggregatesToArray } from './ceilingRaiseGate';

/**
 * Re-publish acknowledgment payload (Task 2.11 / spec §5). Computed AND
 * acknowledged CLIENT-side (BaselineScreen) BEFORE publish is called: the
 * client fetches the current master + per-material activity, runs
 * computePlanRevisionDiff, renders the blocking checklist, and only on full
 * acknowledgment calls publish with this context. publishBaselineV2 persists
 * it as the append-only plan_revisions audit record + notifies — it does NOT
 * recompute the diff (the client's acknowledged snapshot is the record).
 *
 * INTEGRATION POINT (Task 2.12, next): diffLines may contain
 * RAISE_ABSOLVING_OVERAGE lines. In THIS task the publish proceeds after
 * acknowledgment; 2.12 will insert a principal-approval gate (a
 * PLAN_CEILING_RAISE approval_task) BEFORE the publish proceeds when any such
 * line is present. 2.12's principal gate MUST NOT trust this client-computed
 * classification: this whole record is produced by the caller, so a hostile or
 * buggy client can omit RAISE_ABSOLVING_OVERAGE lines (or mislabel them) to
 * skip the gate. The gate needs a SERVER-SIDE recompute of the diff from the
 * about-to-land master vs the current one — the client's diffLines are an
 * audit artifact, never the authority the gate keys off.
 */
export interface RevisionContext {
  diffLines: PlanRevisionLine[];
  summary: PlanRevisionSummary;
  /** ISO timestamp of when the client-side acknowledgment completed. */
  acknowledgedAt: string;
  /** The acknowledging user's id (→ plan_revisions.published_by). */
  acknowledgedBy?: string | null;
  /** Short human sentence for the PLAN_REVISED notification body. */
  notifySummaryText?: string;
}

export interface CatalogRow {
  id: string;
  code: string;
  name: string;
  category: string;
  tier: 1 | 2 | 3;
  unit: string;
  supplier_unit?: string | null;
  base_qty_per_supplier_unit?: number | null;
}

/**
 * Normalize a parsed component's quantity to the linked material's BASE unit.
 * Handles batang-denominated workbooks (future RABs may state rebar in batang
 * instead of kg): 'btg/batang/lonjor' × factor → kg. If the material's own
 * base unit IS batang (e.g. kayu usuk), the qty is already base — pass
 * through. Batang input with no resolvable factor returns an error string;
 * the caller routes the line to review, never treats it as kg (CLAUDE.md
 * §1.1: wrong numbers are worse than absent numbers).
 */
export function normalizeComponentQty(
  component: { quantityPerUnit: number; unit?: string },
  mat: { unit: string; supplier_unit?: string | null; base_qty_per_supplier_unit?: number | null } | null,
): { coefficient: number; unit: string; error: string | null } {
  const rawUnit = component.unit || '';
  if (normalizeUnit(rawUnit) !== 'batang') {
    return { coefficient: component.quantityPerUnit, unit: rawUnit, error: null };
  }
  if (mat == null) {
    return {
      coefficient: component.quantityPerUnit,
      unit: rawUnit,
      error: 'qty dalam batang tapi material tidak dikenali di katalog — perlu review manual',
    };
  }
  if (normalizeUnit(mat.unit) === 'batang') {
    return { coefficient: component.quantityPerUnit, unit: rawUnit, error: null };
  }
  const res = toBaseQty(component.quantityPerUnit, rawUnit, mat);
  if (!res.ok) return { coefficient: component.quantityPerUnit, unit: rawUnit, error: res.error };
  return { coefficient: res.qtyBase, unit: mat.unit, error: null };
}

/**
 * Resolve a free-text breakdown component name to a catalog material UUID using
 * the same exact→alias→fuzzy cascade as v1 import (reconcileMaterials). Returns
 * null when the name does not resolve to a REAL catalog entry — callers must
 * leave material_id NULL and flag the line for review rather than invent a link
 * (CLAUDE.md §1.1: wrong numbers are worse than absent numbers).
 * NOTE: `aliases` must be keyed by NORMALIZED names (lowercase, punctuation→spaces),
 * matching reconcileMaterials' internal normalize(); raw-keyed aliases never match.
 */
export function resolveCatalogId(
  name: string,
  catalog: CatalogRow[],
  aliases: Map<string, string>,
): string | null {
  // Defensive: components without a material name (cost-split residue) must not
  // reach reconcileMaterials' normalize(), which would throw on undefined.
  if (typeof name !== 'string' || !name.trim()) return null;
  const entries: CatalogEntry[] = catalog.map(c => ({
    code: c.code, name: c.name, category: c.category, tier: c.tier, unit: c.unit, aliases: [],
  }));
  const { resolved } = reconcileMaterials(
    [{ rowNumber: 0, name, spec: null, unit: '', unitPrice: 0, resolvedCode: null, matchConfidence: 0 }],
    entries,
    aliases,
  );
  const hit = resolved[0];
  if (!hit || !hit.resolvedCode || hit.matchConfidence <= 0) return null;
  const byCode = new Map(catalog.map(c => [c.code, c.id]));
  return byCode.get(hit.resolvedCode) ?? null;
}

export function topoSortBlocks(stagingRows: StagingRowV2[]): StagingRowV2[] {
  const blocks = stagingRows.filter(r => r.row_type === 'ahs_block');
  const byRowNumber = new Map<number, StagingRowV2>();
  for (const b of blocks) byRowNumber.set(b.row_number, b);

  // Build adjacency: each block depends on whatever its components reference
  const deps = new Map<number, Set<number>>();
  for (const b of blocks) deps.set(b.row_number, new Set());

  // Which block does each component belong to? Track via order:
  // components immediately after an ahs_block belong to that block until
  // the next ahs_block.
  let currentBlockRow: number | null = null;
  for (const r of stagingRows) {
    if (r.row_type === 'ahs_block') {
      currentBlockRow = r.row_number;
      continue;
    }
    if (r.row_type === 'ahs' && currentBlockRow != null && r.parent_ahs_staging_id) {
      const match = /^block:(\d+)$/.exec(r.parent_ahs_staging_id);
      if (match) {
        const parentRow = Number(match[1]);
        deps.get(currentBlockRow)?.add(parentRow);
      }
    }
  }

  // Kahn's algorithm — produce a parents-first order
  const result: StagingRowV2[] = [];
  const inDegree = new Map<number, number>();
  for (const [row, ds] of deps) inDegree.set(row, ds.size);

  // Reverse the edge direction to get parents-first: we want blocks with
  // zero incoming deps processed first.
  const reverseAdjacency = new Map<number, Set<number>>();
  for (const b of blocks) reverseAdjacency.set(b.row_number, new Set());
  for (const [child, parents] of deps) {
    for (const parent of parents) {
      reverseAdjacency.get(parent)?.add(child);
    }
  }

  const queue: number[] = [];
  for (const [row, count] of inDegree) {
    if (count === 0) queue.push(row);
  }

  while (queue.length > 0) {
    const row = queue.shift()!;
    const block = byRowNumber.get(row);
    if (block) result.push(block);
    for (const child of reverseAdjacency.get(row) ?? []) {
      const newDeg = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  if (result.length < blocks.length) {
    const stuck = blocks
      .filter(b => !result.includes(b))
      .map(b => {
        const title = (b.parsed_data as Record<string, unknown>)?.title;
        return `${title ?? '(untitled)'} (row ${b.row_number})`;
      });
    throw new Error(
      `Cycle detected in AHS nested references. Stuck blocks: ${stuck.join(', ')}`,
    );
  }

  return result;
}

export interface FlattenedLine {
  line_type: 'material' | 'labor' | 'equipment' | 'subkon' | 'prelim';
  material_name: string;
  unit: string;
  unit_price: number;
  coefficient: number;
  origin_parent_ahs_id: string | null;
}

function pd<T = unknown>(row: StagingRowV2, key: string, fallback: T): T {
  const v = (row.parsed_data as Record<string, unknown>)[key];
  return (v ?? fallback) as T;
}

function normalizeAlias(s: string): string {
  return s.toLowerCase().replace(/[()@\-/\\'"]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function flattenBlock(
  components: StagingRowV2[],
  parentCache: Map<number, FlattenedLine[]>,
): FlattenedLine[] {
  const out: FlattenedLine[] = [];
  for (const c of components) {
    const materialName = pd(c, 'material_name', '');
    const unit = pd(c, 'unit', '');
    const coefficient = toNumber(pd(c, 'coefficient', 1));
    const unitPriceRaw = toNumber(pd(c, 'unit_price', 0));

    switch (c.cost_basis) {
      case 'catalog':
      case 'takeoff_ref':
      case 'literal':
      case null: {
        const unitPrice =
          c.ref_cells?.unit_price?.cached_value != null
            ? toNumber(c.ref_cells.unit_price.cached_value)
            : unitPriceRaw;
        out.push({
          line_type: 'material',
          material_name: materialName,
          unit,
          unit_price: unitPrice,
          coefficient,
          origin_parent_ahs_id: null,
        });
        break;
      }
      case 'cross_ref': {
        const split: CostSplit = c.cost_split ?? {
          material: 0,
          labor: 0,
          equipment: 0,
          prelim: 0,
        };
        out.push({
          line_type: 'material',
          material_name: materialName,
          unit,
          unit_price: split.material,
          coefficient,
          origin_parent_ahs_id: null,
        });
        out.push({
          line_type: 'labor',
          material_name: materialName,
          unit,
          unit_price: split.labor,
          coefficient,
          origin_parent_ahs_id: null,
        });
        out.push({
          line_type: 'equipment',
          material_name: materialName,
          unit,
          unit_price: split.equipment,
          coefficient,
          origin_parent_ahs_id: null,
        });
        if (split.prelim > 0) {
          out.push({
            line_type: 'prelim',
            material_name: materialName,
            unit,
            unit_price: split.prelim,
            coefficient,
            origin_parent_ahs_id: null,
          });
        }
        break;
      }
      case 'nested_ahs': {
        const parentKey = c.parent_ahs_staging_id;
        const match = parentKey ? /^block:(\d+)$/.exec(parentKey) : null;
        const parentRowNumber = match ? Number(match[1]) : null;
        const parentLines =
          parentRowNumber != null ? parentCache.get(parentRowNumber) : null;
        if (parentLines) {
          for (const pl of parentLines) {
            out.push({
              ...pl,
              coefficient: pl.coefficient * coefficient,
              origin_parent_ahs_id: parentKey,
            });
          }
        }
        break;
      }
    }
  }
  return out;
}

import { supabase } from './supabase';
import { fetchAllPaged } from './queryHelpers';

/**
 * Load material_catalog + material_aliases, paginated. Both tables can exceed
 * Supabase's 1000-row cap on a mature catalog; an unpaginated select silently
 * drops rows past page 1, so components whose material happens to live past
 * row 1000 fail to link at publish with no visible symptom other than a
 * growing "unresolved" count — a wrong/absent link is exactly the kind of
 * confident-looking-but-wrong outcome CLAUDE.md forbids. Throws on a query
 * error instead of returning a partial catalog; the caller must fail the
 * publish loudly rather than proceed with incomplete linking data.
 */
export async function loadCatalogAndAliases(): Promise<{
  catalog: CatalogRow[];
  aliasMap: Map<string, string>;
}> {
  const catalog = await fetchAllPaged<CatalogRow>((from, to) =>
    supabase
      .from('material_catalog')
      .select('id, code, name, category, tier, unit, supplier_unit, base_qty_per_supplier_unit')
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
        data: CatalogRow[] | null;
        error: { message?: string } | null;
      }>);

  const aliasRows = await fetchAllPaged<{ alias: string; material_catalog?: { code: string } }>((from, to) =>
    supabase
      .from('material_aliases')
      .select('alias, material_catalog!inner(code)')
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
        data: { alias: string; material_catalog?: { code: string } }[] | null;
        error: { message?: string } | null;
      }>);

  const aliasMap = new Map<string, string>();
  for (const a of aliasRows) {
    const code = a.material_catalog?.code;
    if (code) aliasMap.set(normalizeAlias(a.alias), code);
  }

  return { catalog, aliasMap };
}

/**
 * Detect BoQ codes that appear more than once across the staging rows.
 *
 * The publish path upserts boq_items with onConflict 'project_id,code'. If two
 * rows carry the same code, Postgres aborts the whole statement with
 * "ON CONFLICT DO UPDATE command cannot affect row a second time". A clean
 * parse never produces duplicates (extractBoqRows disambiguates named subgroups
 * and source numbering typos), so any duplicate here means the staging rows are
 * stale — written by an older parser. Returned strings are formatted "CODE (×N)"
 * for direct use in the user-facing error.
 */
export function findDuplicateBoqCodes(rows: StagingRowV2[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.row_type !== 'boq') continue;
    const code = (r.parsed_data as { code?: string }).code ?? '';
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([c, n]) => `${c} (×${n})`);
}

/**
 * Codes of BoQ staging rows whose take-off volume is 0 (or non-positive).
 *
 * boq_items has a CHECK (planned > 0) constraint. A planned = 0 row is a source
 * line the estimator listed but took off zero quantity (e.g. a steel profile in
 * the RAB price list that this project doesn't use). It carries no baseline
 * quantity or cost and would also break downstream ratios that divide by
 * planned, so it is excluded from the published baseline rather than inserted
 * with a fabricated quantity. Returned codes let the caller report the omission
 * instead of dropping rows silently.
 */
export function zeroPlannedBoqCodes(rows: StagingRowV2[]): string[] {
  const codes: string[] = [];
  for (const r of rows) {
    if (r.row_type !== 'boq') continue;
    const pd = r.parsed_data as { code?: string; planned?: unknown };
    if (!(toNumber(pd.planned) > 0)) codes.push(pd.code ?? '');
  }
  return codes;
}

export interface BoqItemInsert {
  project_id: string;
  code: string;
  label: string;
  unit: string;
  planned: number;
  chapter: string | null;
  sub_chapter: string | null;
}

/**
 * Build the boq_items upsert record for one staged BoQ row, or null if the
 * row is missing a required field (code/label/unit/planned) and must be
 * quarantined instead. chapter/sub_chapter come from the parser's raw_data
 * (tools/boqParserV2/extractTakeoffs.ts BoqRowV2.chapter / .sub_chapter,
 * staged as raw_data.chapter / raw_data.subChapter — see
 * tools/boqParserV2/index.ts). Both are read defensively (typeof === string)
 * and default to null so an absent/malformed value never becomes `undefined`
 * on the upsert record — an explicit null overwrites a stale value from a
 * prior publish; an omitted key would not.
 */
export function buildBoqItemInsert(row: StagingRowV2, projectId: string): BoqItemInsert | null {
  const pd = row.parsed_data as { code?: string; label?: string; unit?: string; planned?: unknown };
  const planned = toNumber(pd.planned);
  if (!pd.code || !pd.label || !pd.unit || !(planned > 0)) return null;
  const raw = (row.raw_data ?? {}) as { chapter?: unknown; subChapter?: unknown };
  const chapter = typeof raw.chapter === 'string' ? raw.chapter : null;
  const sub_chapter = typeof raw.subChapter === 'string' ? raw.subChapter : null;
  return {
    project_id: projectId,
    code: pd.code,
    label: pd.label,
    unit: pd.unit,
    planned,
    chapter,
    sub_chapter,
  };
}

/**
 * An existing boq_items row's code + supersede status, as read from the DB
 * BEFORE this publish's supersede/resurrect step runs.
 */
export interface ExistingBoqCodeStatus {
  code: string;
  /** True when superseded_at is non-null (absent from a PRIOR publish). */
  superseded: boolean;
}

export interface BoqSupersedeDelta {
  /** Existing, currently-active codes NOT present in the new workbook. */
  toSupersede: string[];
  /** Existing, currently-superseded codes that REAPPEARED in the new workbook. */
  toResurrect: string[];
  /**
   * Existing, currently-active codes that are absent from `newCodes` (didn't
   * land this round) but were named in `excludeFromSupersede` — a quarantined
   * row or a resilientWrite upsert failure, not a plan change — so they were
   * held OUT of `toSupersede`. Their previous row stays active. Surfaced so
   * the caller can warn "code X failed to land; its previous row remains
   * active" instead of the drop happening silently.
   */
  excludedFromSupersede: string[];
}

/**
 * Task 3.1 — compute which existing boq_items codes should be marked
 * superseded (soft-deleted) because they're absent from this publish's
 * landed code set, and which previously-superseded codes should be
 * resurrected because they reappeared. Pure — no I/O — so the publish
 * wiring can be unit-tested without a live Supabase call. See migration
 * 074_boq_items_supersede.sql for why this is a soft marker, not a DELETE.
 *
 * Exact string match on `code`, no case/whitespace normalization: codes are
 * generated deterministically by extractTakeoffs.ts (chapter/sub-chapter/
 * item-number segments joined with '.') and never carry incidental
 * whitespace/case variance, and the boq_items upsert itself matches on exact
 * code via `onConflict: 'project_id,code'` — normalizing here would diverge
 * from what the upsert treats as "the same row" (findDuplicateBoqCodes above
 * makes the same exact-match assumption).
 *
 * `excludeFromSupersede` (default empty, Task 3.1 remediation) is the set of
 * codes that failed to LAND this round for a reason OTHER than a plan change:
 * a quarantined row (missing code/label/unit/planned) or a resilientWrite
 * upsert failure. Those codes are also absent from `newCodes` — they never
 * reached boqIdByCode — but a code in `excludeFromSupersede` is a DATA GLITCH,
 * not a decision to drop it from the plan, so its previous ACTIVE row is held
 * out of `toSupersede` (reported via `excludedFromSupersede` instead) and
 * stays visible. It is deliberately NOT resurrected either — failing/
 * quarantining this round is not evidence the code is active, so a code that
 * was already superseded before this publish just stays superseded; it
 * self-heals on the next clean re-publish.
 *
 * Contrast this with a ZERO-PLANNED code (BoQ row's take-off volume is 0 —
 * see `zeroPlannedBoqCodes`): that code is deliberately left OUT of both
 * `newCodes` and `excludeFromSupersede`, so it DOES get superseded. Going to
 * zero is a real plan change — the row must stop showing its stale nonzero
 * planned qty — so hiding it here is correct, not a bug to "fix" by adding it
 * to the exclude set.
 */
export function computeBoqSupersedeDelta(
  existing: ExistingBoqCodeStatus[],
  newCodes: Iterable<string>,
  excludeFromSupersede: Iterable<string> = [],
): BoqSupersedeDelta {
  const newSet = new Set(newCodes);
  const excludeSet = new Set(excludeFromSupersede);
  const toSupersede: string[] = [];
  const toResurrect: string[] = [];
  const excludedFromSupersede: string[] = [];
  for (const item of existing) {
    const inNewSet = newSet.has(item.code);
    if (!inNewSet && !item.superseded) {
      if (excludeSet.has(item.code)) {
        excludedFromSupersede.push(item.code);
      } else {
        toSupersede.push(item.code);
      }
    } else if (inNewSet && item.superseded) {
      toResurrect.push(item.code);
    }
  }
  return { toSupersede, toResurrect, excludedFromSupersede };
}

export interface MasterLineDraft {
  material_id: string | null;
  material_name: string;
  coefficient: number;
  isRebar: boolean;
  isWaste: boolean;
}

const WASTE_RE = /waste/i;
const REBAR_RE = /besi\s*beton|rebar|besi\s*ulir|besi\s*polos/i;

/** Classify a draft line so foldRebarWaste can group rebar + waste. */
export function classifyRebar(materialName: string): { isRebar: boolean; isWaste: boolean } {
  const isRebar = REBAR_RE.test(materialName);
  return { isRebar, isWaste: isRebar && WASTE_RE.test(materialName) };
}

/**
 * Fold the aggregate "Besi beton — waste (5%)" coefficient onto the resolved
 * rebar diameter lines of the SAME BoQ item, proportional to their
 * coefficients, then drop the waste line. If no resolved rebar line exists to
 * absorb it, the waste line is dropped (its material_id is null → not tracked
 * per-material; the unresolved report still surfaces it). Total rebar mass is
 * conserved. Operate on one BoQ item's drafts at a time.
 */
export function foldRebarWaste(drafts: MasterLineDraft[]): MasterLineDraft[] {
  const waste = drafts.filter(d => d.isWaste);
  if (waste.length === 0) return drafts;

  const rebarTargets = drafts.filter(d => d.isRebar && !d.isWaste && d.material_id != null);
  const wasteCoeff = waste.reduce((s, w) => s + w.coefficient, 0);
  const base = rebarTargets.reduce((s, r) => s + r.coefficient, 0);

  const kept = drafts.filter(d => !d.isWaste);
  if (rebarTargets.length === 0 || base <= 0) return kept;

  return kept.map(d =>
    rebarTargets.includes(d)
      ? { ...d, coefficient: d.coefficient + wasteCoeff * (d.coefficient / base) }
      : d,
  );
}

export interface MasterLineInput {
  boq_item_id: string;
  boq_planned: number;
  material_id: string | null;
  material_name: string;
  coefficient: number;
  unit: string;
  line_type: 'material' | 'labor' | 'equipment' | 'subkon' | 'prelim';
}

export interface MasterLineRecord {
  master_id: string;
  material_id: string;
  boq_item_id: string;
  planned_quantity: number;
  unit: string;
}

/**
 * Aggregate per-(boq_item, material) planned demand from flattened v2 lines.
 * planned = boq.planned × coefficient (coefficient already = qty per BoQ unit).
 * Only material lines with a resolved material_id contribute. Duplicate pairs
 * are summed. Labor/equipment and unresolved materials are excluded so the
 * material master never carries a fabricated or untraceable demand row.
 */
export function buildMasterLinesV2(
  inputs: MasterLineInput[],
  masterId: string,
): MasterLineRecord[] {
  const byPair = new Map<string, MasterLineRecord>();
  for (const i of inputs) {
    if (i.line_type !== 'material' || i.material_id == null) continue;
    const key = `${i.boq_item_id}::${i.material_id}`;
    const planned = i.boq_planned * i.coefficient;
    const existing = byPair.get(key);
    if (existing) {
      existing.planned_quantity += planned;
    } else {
      byPair.set(key, {
        master_id: masterId,
        material_id: i.material_id,
        boq_item_id: i.boq_item_id,
        planned_quantity: planned,
        unit: i.unit,
      });
    }
  }
  return [...byPair.values()];
}

export interface BaselineSnapshotRow {
  project_id: string;
  material_id: string;
  baseline_planned_qty: number;
  unit: string;
  source_master_id: string;
}

/**
 * Aggregate a master's per-(boq_item, material) lines (buildMasterLinesV2's
 * output) down to ONE row per material — the SUM of planned_quantity across
 * every BoQ item that uses it, in base units. This is the shape
 * material_baseline_snapshots stores: an immutable per-material anchor
 * (spec 2026-07-10-two-signal-overallocation-design.md §4).
 *
 * Only lines with a resolved material_id ever reach here — buildMasterLinesV2
 * already excludes null material_id / non-material line types, so the guard
 * below is defensive, not load-bearing, in case a caller passes an unfiltered
 * list.
 *
 * A material's unit is fixed in material_catalog, so every line for the same
 * material_id should agree on unit — but if they don't (stale/mixed data),
 * the material is DROPPED rather than summed under a guessed unit or an
 * arbitrarily-picked one (CLAUDE.md §1.1: wrong numbers are worse than
 * absent numbers). The caller sees one fewer snapshot row, never a wrong one.
 */
export function buildBaselineSnapshotRows(
  masterLines: MasterLineRecord[],
  projectId: string,
  masterId: string,
): BaselineSnapshotRow[] {
  const byMaterial = new Map<string, { qty: number; unit: string; unitMismatch: boolean }>();
  for (const line of masterLines) {
    if (!line.material_id) continue;
    const existing = byMaterial.get(line.material_id);
    if (!existing) {
      byMaterial.set(line.material_id, { qty: line.planned_quantity, unit: line.unit, unitMismatch: false });
    } else {
      existing.qty += line.planned_quantity;
      if (existing.unit !== line.unit) existing.unitMismatch = true;
    }
  }
  const rows: BaselineSnapshotRow[] = [];
  for (const [material_id, agg] of byMaterial) {
    if (agg.unitMismatch) continue;
    rows.push({
      project_id: projectId,
      material_id,
      baseline_planned_qty: agg.qty,
      unit: agg.unit,
      source_master_id: masterId,
    });
  }
  return rows;
}

export interface SessionLineInputs {
  ahsLineInserts: Record<string, unknown>[];
  masterLineInputs: MasterLineInput[];
  unresolvedComponents: string[];
}

/**
 * Resolve every BoQ row's normalized-breakdown components into ahs_line insert
 * records + per-(boq,material) master line inputs. Shared by the real publish
 * AND the client-side re-publish preview (previewNewMasterTotals) so the diff a
 * user acknowledges is computed from the SAME resolution the publish will write
 * — no drift between "what the checklist showed" and "what landed".
 *
 * `boqIdForCode` maps a BoQ code to its key: the real boq_item UUID in the
 * publish path (rows whose boq_item didn't land return undefined → skipped), or
 * the code itself in the preview path (identity over the publishable codes).
 * `ahsVersionId` is stamped onto ahs_line records; pass null in preview (the
 * ahs_line inserts are ignored there). Pure — no I/O.
 */
export function buildSessionLineInputs(
  rows: StagingRowV2[],
  catalog: CatalogRow[],
  catalogById: Map<string, CatalogRow>,
  aliasMap: Map<string, string>,
  ahsVersionId: string | null,
  boqIdForCode: (code: string) => string | undefined,
): SessionLineInputs {
  const ahsLineInserts: Record<string, unknown>[] = [];
  const unresolvedComponents: string[] = [];
  const masterLineInputs: MasterLineInput[] = [];
  for (const r of rows) {
    if (r.row_type !== 'boq') continue;
    const pd = r.parsed_data as {
      code?: string;
      planned?: unknown;
      recipe?: { components?: Array<{ materialName: string; quantityPerUnit: number; unitPrice: number; lineType?: string; unit?: string; referencedBlockTitle?: string | null }> };
    };
    const boqId = pd.code ? boqIdForCode(pd.code) : undefined;
    if (!boqId) continue; // row skipped (zero-planned / quarantined / invalid)
    const volume = toNumber(pd.planned);
    for (const c of pd.recipe?.components ?? []) {
      // Some components carry no material name (cost-split residue on
      // non-breakdown rows) — nothing to track, skip them.
      const name = typeof c.materialName === 'string' ? c.materialName.trim() : '';
      if (!name) continue;
      const lineType = (c.lineType ?? 'material') as 'material' | 'labor' | 'equipment' | 'subkon' | 'prelim';
      const materialId = lineType === 'material'
        ? resolveCatalogId(name, catalog, aliasMap)
        : null;
      if (lineType === 'material' && materialId == null) {
        unresolvedComponents.push(`${pd.code}: ${name}`);
      }
      // Batang-denominated components normalize to the material's base unit
      // (kg) before anything is stored; failures go to review, never guessed.
      const matRow = materialId != null ? catalogById.get(materialId) ?? null : null;
      const norm = normalizeComponentQty({ quantityPerUnit: c.quantityPerUnit, unit: c.unit }, matRow);
      if (norm.error) {
        unresolvedComponents.push(`${pd.code}: ${name} — ${norm.error}`);
        continue;
      }
      // If the qty converted (batang → kg), the price is per-batang; convert
      // to per-kg so the line total stays invariant.
      const unitPrice = norm.unit !== (c.unit || '') && norm.coefficient > 0
        ? c.unitPrice * (c.quantityPerUnit / norm.coefficient)
        : c.unitPrice;
      ahsLineInserts.push({
        ahs_version_id: ahsVersionId,
        boq_item_id: boqId,
        material_id: materialId,
        tier: 1,
        unit: norm.unit,
        material_spec: name,
        coefficient: norm.coefficient,
        usage_rate: norm.coefficient,
        unit_price: unitPrice,
        line_type: lineType,
        description: name,
        ahs_block_title: c.referencedBlockTitle ?? null,
        origin_parent_ahs_id: null,
      });
      masterLineInputs.push({
        boq_item_id: boqId,
        boq_planned: volume,
        material_id: materialId,
        material_name: name,
        coefficient: norm.coefficient,
        unit: norm.unit,
        line_type: lineType,
      });
    }
  }
  return { ahsLineInserts, masterLineInputs, unresolvedComponents };
}

/**
 * Aggregate the per-material planned totals the NEXT publish of these staging
 * rows WOULD write — the would-be new master, summed to one figure per material
 * (base units). Pure over the already-loaded catalog: no I/O. Shared by
 * previewNewMasterTotals (the 2.11 re-publish diff) AND publishBaselineV2's 2.12
 * ceiling-raise gate (its p_proposed), so the gate compares the EXACT numbers the
 * publish will land.
 *
 * Mirrors the publish's skip logic (zero-planned rows, and rows buildBoqItemInsert
 * would quarantine, are excluded) via the publishable-codes set, so membership
 * matches the real boq_items membership (modulo rare DB insert failures, which
 * surface post-publish as `warnings`). Keying master lines by BoQ code rather than
 * the real boq_item UUID is irrelevant to the result — aggregatePlannedByMaterial
 * sums by material_id only.
 */
export function buildProposedAggregatesFromStaging(
  rows: StagingRowV2[],
  catalog: CatalogRow[],
  catalogById: Map<string, CatalogRow>,
  aliasMap: Map<string, string>,
): Map<string, number> {
  const skipSet = new Set(zeroPlannedBoqCodes(rows));
  const publishable = new Set<string>();
  for (const r of rows) {
    if (r.row_type !== 'boq') continue;
    const code = (r.parsed_data as { code?: string }).code ?? '';
    if (!code || skipSet.has(code)) continue;
    if (buildBoqItemInsert(r, '') != null) publishable.add(code);
  }
  const { masterLineInputs } = buildSessionLineInputs(
    rows,
    catalog,
    catalogById,
    aliasMap,
    null,
    (code) => (publishable.has(code) ? code : undefined),
  );
  const masterLines = buildMasterLinesV2(masterLineInputs, 'proposed');
  return aggregatePlannedByMaterial(masterLines);
}

/**
 * Read-only preview of the per-material planned totals the NEXT publish of this
 * session WOULD write — WITHOUT mutating anything. The client (BaselineScreen)
 * uses it as `newMasterRows` for computePlanRevisionDiff on a re-publish, so the
 * diff-and-acknowledge checklist reflects exactly what the publish will land.
 */
export async function previewNewMasterTotals(sessionId: string): Promise<{
  totals: Map<string, number>;
  error?: string;
}> {
  const { data: stagingRowsDB, error: fetchErr } = await supabase
    .from('import_staging_rows')
    .select('*')
    .eq('session_id', sessionId)
    .neq('review_status', 'REJECTED')
    .order('row_number', { ascending: true });
  if (fetchErr) return { totals: new Map(), error: fetchErr.message };
  const rows = (stagingRowsDB ?? []) as unknown as StagingRowV2[];

  let catalog: CatalogRow[];
  let aliasMap: Map<string, string>;
  try {
    ({ catalog, aliasMap } = await loadCatalogAndAliases());
  } catch (err) {
    return { totals: new Map(), error: err instanceof Error ? err.message : String(err) };
  }
  const catalogById = new Map(catalog.map(c => [c.id, c]));
  return { totals: buildProposedAggregatesFromStaging(rows, catalog, catalogById, aliasMap) };
}

export async function publishBaselineV2(
  sessionId: string,
  projectId: string,
  options?: { revisionContext?: RevisionContext; ceilingApprovalTaskId?: string },
): Promise<{
  success: boolean;
  error?: string;
  boqCount?: number;
  ahsCount?: number;
  materialCount?: number;
  masterLineCount?: number;
  unresolvedComponentCount?: number;
  skippedZeroPlanned?: string[];
  quarantinedRows?: string[];
  warnings?: string[];
  /**
   * True when the abort was the Task 2.12 principal ceiling-raise gate
   * (server RAISE 'PLAN_CEILING_BREACH:') rather than an ordinary failure — the
   * screen branches on it to render the breach panel + escalation path.
   */
  ceilingApprovalRequired?: boolean;
  /** Task 3.1 — codes newly marked superseded_at on this re-publish. */
  supersededCount?: number;
  /** Task 3.1 — previously-superseded codes that reappeared and were resurrected. */
  resurrectedCount?: number;
}> {
  const revisionContext = options?.revisionContext;
  const { data: stagingRowsDB, error: fetchErr } = await supabase
    .from('import_staging_rows')
    .select('*')
    .eq('session_id', sessionId)
    .neq('review_status', 'REJECTED')
    .order('row_number', { ascending: true });

  if (fetchErr) return { success: false, error: fetchErr.message };
  if (!stagingRowsDB) return { success: false, error: 'No staging rows' };

  const rows = stagingRowsDB as unknown as StagingRowV2[];

  // Load the catalog + aliases so each disaggregated component can be linked to
  // a real material_id (powering per-material envelope/gate checks downstream).
  // Both tables are paginated past Supabase's 1000-row cap (see
  // loadCatalogAndAliases) — a query error here must fail the publish loudly
  // rather than proceed with a partial catalog.
  let catalog: CatalogRow[];
  let aliasMap: Map<string, string>;
  try {
    ({ catalog, aliasMap } = await loadCatalogAndAliases());
  } catch (err) {
    return {
      success: false,
      error: `material_catalog/material_aliases load failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const catalogById = new Map(catalog.map(c => [c.id, c]));

  // Translate DB uuids into row_number keys for topological sort, and keep the
  // reverse map so the nested-unfold breadcrumb (stored internally as
  // "block:<row>") can be turned back into the parent block's staging uuid when
  // we write ahs_lines.origin_parent_ahs_id (a uuid column).
  const blockRowNumberByUuid = new Map<string, number>();
  const blockUuidByRowNumber = new Map<number, string>();
  for (const r of rows) {
    if (r.row_type === 'ahs_block') {
      const id = (r as unknown as { id: string }).id;
      blockRowNumberByUuid.set(id, r.row_number);
      blockUuidByRowNumber.set(r.row_number, id);
    }
  }
  // Rewrite parent_ahs_staging_id from uuid form (DB) back to block:<row_number>
  // so topoSort + flatten can work on it.
  for (const r of rows) {
    if (r.cost_basis === 'nested_ahs' && r.parent_ahs_staging_id) {
      const parentUuid = r.parent_ahs_staging_id;
      const parentRow = blockRowNumberByUuid.get(parentUuid);
      if (parentRow != null) {
        r.parent_ahs_staging_id = `block:${parentRow}`;
      }
    }
  }

  const sortedBlocks = topoSortBlocks(rows);

  // Group components by their owning block (determined by staging row order)
  const componentsByBlock = new Map<number, StagingRowV2[]>();
  let currentBlockRow: number | null = null;
  for (const r of rows) {
    if (r.row_type === 'ahs_block') {
      currentBlockRow = r.row_number;
      componentsByBlock.set(currentBlockRow, []);
      continue;
    }
    if (r.row_type === 'ahs' && currentBlockRow != null) {
      componentsByBlock.get(currentBlockRow)?.push(r);
    }
  }

  // Flatten parents first — parent cache keyed by block row_number
  const parentCache = new Map<number, FlattenedLine[]>();
  for (const block of sortedBlocks) {
    const components = componentsByBlock.get(block.row_number) ?? [];
    parentCache.set(block.row_number, flattenBlock(components, parentCache));
  }

  // Guard BEFORE any mutation. The (project_id, code) upsert further down
  // cannot contain the same code twice in one batch — Postgres rejects it with
  // "ON CONFLICT DO UPDATE command cannot affect row a second time". A clean
  // parse never produces duplicate codes (extractBoqRows disambiguates named
  // subgroups and source numbering typos), so duplicates here mean the staging
  // rows are STALE — written by an older parser before the code derivation was
  // fixed. Fail loud with the offending codes instead of surfacing the opaque
  // Postgres error, and crucially do this BEFORE we demote/insert ahs_versions
  // so a stale session can't leave the project in a half-published state.
  // We never silently merge two distinct line items onto one code.
  const duplicateBoqCodes = findDuplicateBoqCodes(rows);
  if (duplicateBoqCodes.length > 0) {
    return {
      success: false,
      error:
        `Duplicate BoQ codes in this import: ${duplicateBoqCodes.join(', ')}. ` +
        `These staging rows were parsed by an older version that collided codes ` +
        `across named subgroups (e.g. "Sloof Elevasi -0.80" vs "Sloof & Balok ` +
        `Lantai 1"). Re-import the workbook to regenerate unique codes, then ` +
        `publish again.`,
    };
  }

  // Capture the version we're about to supersede: its id becomes the revision's
  // old_ahs_version_id, and its mere existence marks this as a RE-PUBLISH (a
  // prior published baseline exists to diff against). Master + version are
  // always created together by this path, so a current version ⟺ a current
  // master. Read BEFORE any mutation so the acknowledgment guard below can fail
  // loudly without leaving the project half-published.
  const { data: oldCurrentVersion } = await supabase
    .from('ahs_versions')
    .select('id')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .maybeSingle();
  const oldAhsVersionId = (oldCurrentVersion?.id as string | undefined) ?? null;
  const isRepublish = oldAhsVersionId != null;

  // Re-publish diff-and-acknowledge gate (Task 2.11 / spec §5): when a current
  // master exists, the CLIENT must have computed + acknowledged the plan diff
  // BEFORE calling publish. Refuse loudly here — BEFORE any mutation — so a
  // re-publish can never silently rewrite planned quantities under in-flight
  // requests/POs without a witnessed acknowledgment (spec §1.2 truth contract).
  // HONESTY BOUNDARY: this enforcement lives in the app path only. The DB does
  // NOT enforce acknowledgment — the publish is client-orchestrated across many
  // statements, so a direct table writer (service role / Dashboard / a rogue
  // client that skips this function) can still rewrite the master with no
  // revision row. The append-only plan_revisions trail records what the app
  // path acknowledged; it is not a database-level gate. Task 2.12's server-side
  // recompute is what closes that gap for ceiling raises.
  if (isRepublish && !revisionContext) {
    return {
      success: false,
      error:
        'Perubahan rencana belum di-acknowledge — hitung & konfirmasi diff sebelum re-publish ' +
        '(plan revision diff not acknowledged).',
    };
  }

  // ── Task 2.12 — principal gate on overage-absolving ceiling raises ──────
  // On a RE-PUBLISH, before the version flip, the SERVER recomputes whether this
  // publish raises the ceiling of any material currently in overage (ordered >
  // current planned). This NEVER trusts the client's 2.11 diff classification (a
  // hostile caller could omit RAISE_ABSOLVING_OVERAGE lines) — the classification
  // AND the approval verification are computed server-side by
  // assert_ceiling_raise_gate from DB state (current master plan + envelope
  // ordered). The one client-supplied input is p_proposed: the aggregated
  // per-material planned of the would-be new master — the SAME numbers this
  // publish is about to write (buildProposedAggregatesFromStaging), computed
  // BEFORE the demote so a breach aborts with ZERO rows written.
  //
  // HONESTY BOUNDARY (same accepted residual as 2.11's acknowledge guard above):
  // this gate is enforced only on the app publish path. The publish is
  // client-orchestrated across many statements with no server publish endpoint,
  // so a direct-REST / service-role writer that bypasses this function can still
  // rewrite the master without the gate. Migration 079's header documents this;
  // closing it requires a server-side publish transaction (out of scope).
  if (isRepublish) {
    const proposedAggregates = buildProposedAggregatesFromStaging(rows, catalog, catalogById, aliasMap);
    const { error: gateErr } = await supabase.rpc('assert_ceiling_raise_gate', {
      p_project_id: projectId,
      p_proposed: proposedAggregatesToArray(proposedAggregates),
      p_approval_task_id: options?.ceilingApprovalTaskId ?? null,
    });
    if (gateErr) {
      const msg = gateErr.message ?? String(gateErr);
      return {
        success: false,
        error: msg,
        // 'PLAN_CEILING_BREACH:' → the principal gate held the publish; the
        // screen renders the breach panel + escalation. Any OTHER RPC error is a
        // genuine failure (the gate could not be verified) → abort loudly, never
        // proceed past an unverified ceiling gate (truth-correctness contract).
        ceilingApprovalRequired: /PLAN_CEILING_BREACH/i.test(msg),
      };
    }
  }

  const { data: latestVersion, error: latestVersionErr } = await supabase
    .from('ahs_versions')
    .select('version')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionErr) {
    return { success: false, error: `AHS version lookup failed: ${latestVersionErr.message}` };
  }
  const nextVersion = Number(latestVersion?.version ?? 0) + 1;

  // Demote any previously current ahs_version for this project before
  // inserting the new one. Supabase doesn't give us a cross-table
  // transaction from the client, so this runs as a best-effort sequence:
  // demote → insert. If the demote fails we bail out instead of risking
  // two rows with is_current=true for the same project.
  const { error: demoteErr } = await supabase
    .from('ahs_versions')
    .update({ is_current: false })
    .eq('project_id', projectId)
    .eq('is_current', true);
  if (demoteErr) {
    return { success: false, error: `demote previous current ahs_version failed: ${demoteErr.message}` };
  }

  // Create new ahs_version for this session
  const { data: versionRow, error: versionErr } = await supabase
    .from('ahs_versions')
    .insert({ project_id: projectId, import_session_id: sessionId, version: nextVersion, is_current: true })
    .select('id')
    .single();
  if (versionErr || !versionRow) {
    return { success: false, error: versionErr?.message ?? 'version insert failed' };
  }
  const ahsVersionId = versionRow.id as string;

  // Build boq_items map (code → id) by inserting BoQ rows first. Rows with a
  // non-positive take-off volume are excluded — see zeroPlannedBoqCodes for why
  // (never fabricate a quantity). The codes are reported back so the omission is
  // visible, never silent. Codes are unique here because the duplicate guard
  // above already ran.
  //
  // Rows that drop for ANY other reason (missing code/label/unit, or a DB
  // rejection) are quarantined individually so one bad row can never reject the
  // whole batch and leave the baseline empty.
  const quarantined: string[] = [];
  // Codes dropped this round for a reason OTHER than a plan change (missing
  // required field, or a resilientWrite upsert failure below). Fed into
  // computeBoqSupersedeDelta's excludeFromSupersede so a data glitch never
  // silently supersedes that code's previous ACTIVE row — see Task 3.1
  // remediation comment at the supersede block below.
  const quarantinedCodes: string[] = [];
  const skippedZeroPlanned = zeroPlannedBoqCodes(rows);
  const skipSet = new Set(skippedZeroPlanned);
  const boqInserts: BoqItemInsert[] = [];
  for (const r of rows) {
    if (r.row_type !== 'boq') continue;
    const pd = r.parsed_data as { code?: string; planned?: unknown };
    if (skipSet.has(pd.code ?? '')) continue; // zero-planned: already reported via skippedZeroPlanned
    const insert = buildBoqItemInsert(r, projectId);
    if (!insert) {
      quarantined.push(`BoQ "${pd.code ?? '?'}": data tidak lengkap (code/label/unit/planned) — dilewati.`);
      if (pd.code) quarantinedCodes.push(pd.code);
      continue;
    }
    boqInserts.push(insert);
  }

  const { inserted: boqData, failed: boqFailed } = await resilientWrite<
    (typeof boqInserts)[number],
    { id: string; code: string }
  >(
    boqInserts,
    (batch) => supabase.from('boq_items').upsert(batch, { onConflict: 'project_id,code' }).select('id, code'),
  );
  for (const f of boqFailed) quarantined.push(`BoQ ${f.row.code}: ${f.error}`);
  const failedUpsertCodes = boqFailed.map(f => f.row.code);
  const boqIdByCode = new Map<string, string>(boqData.map(b => [b.code, b.id]));

  // Never let a hollow baseline go live. If no BoQ item landed — whatever the
  // reason each row dropped — fail loudly instead of marking the session
  // PUBLISHED with an empty baseline (which is what looked "published but empty").
  const totalBoqRows = rows.filter(r => r.row_type === 'boq').length;
  if (boqIdByCode.size === 0) {
    return {
      success: false,
      error: `Tidak ada BoQ item yang berhasil dipublish (0 dari ${totalBoqRows} baris BoQ). `
        + (quarantined.length ? `Masalah: ${quarantined.slice(0, 5).join('; ')}` : 'Periksa staging BoQ.'),
      quarantinedRows: quarantined,
    };
  }

  // ── Task 3.1 — supersede stale boq_items on re-publish ───────────────────
  // A code that existed for this project BEFORE this publish but is absent
  // from the set that just landed (boqIdByCode) is no longer part of the
  // current plan — mark it superseded_at = now() so it stops being an ACTIVE
  // plan row (Progress Summary, useProject's boq_items load, work-group and
  // allocation pickers all filter superseded_at IS NULL — see migration
  // 074_boq_items_supersede.sql). We do NOT delete it: allocations, receipts,
  // progress_entries, opname_lines, etc. may FK it, and historical resolution
  // by id must keep working. A code that reappears in this publish after
  // being superseded by an EARLIER one is resurrected (superseded_at cleared
  // back to null) — a later workbook bringing a code back means it's active
  // again.
  //
  // Diffed against LANDED codes, not workbook codes: a code that failed to
  // LAND this round — quarantined (missing code/label/unit/planned, see
  // quarantinedCodes above) or a resilientWrite upsert failure (see
  // failedUpsertCodes above) — is a DATA GLITCH, not a plan change. Its
  // previous ACTIVE row must stay active, so both code lists are passed as
  // computeBoqSupersedeDelta's `excludeFromSupersede` and a warning fires
  // below linking "code X failed to land" to "its previous row remains
  // active" so the drop is never silent. Contrast a ZERO-PLANNED code
  // (take-off volume 0, see zeroPlannedBoqCodes): that one is deliberately
  // superseded — going to zero is a real plan change and the row must stop
  // showing its stale nonzero planned qty — so it is NOT added to either
  // list. A future editor "fixing" one of these the other way would either
  // resurface stale plan data (excluding zero-planned) or hide rows on a
  // transient DB hiccup (no longer excluding quarantined/failed codes).
  //
  // Only runs on a RE-PUBLISH (isRepublish) — on a first publish nothing
  // existed before, so there is nothing to supersede or resurrect.
  //
  // Ordering: runs AFTER the boq upsert lands (boqIdByCode is confirmed
  // non-empty above) and BEFORE the ahs_lines/master build below — it only
  // needs the landed code set, nothing built from it. Relative to the rest of
  // the publish: it sits AFTER the Task 2.12 ceiling-raise gate (already ran,
  // before the version flip, near the top of this function) and BEFORE the
  // Task 2.11 plan_revisions audit write (further down) — so a supersede
  // failure can never block the version flip that already happened, and
  // never blocks the audit trail from recording what was acknowledged.
  //
  // NON-FATAL, same contract as the baseline-snapshot and plan_revisions
  // writes below: a failure here must never sink an otherwise-successful
  // publish that already wrote boq_items/ahs_lines/master_lines. Surfaced via
  // `warnings` (declared here so this step and the later snapshot/revision
  // writes share one array).
  const warnings: string[] = [];
  let supersededCount = 0;
  let resurrectedCount = 0;
  if (isRepublish) {
    try {
      const { data: existingBoqRows, error: existingErr } = await supabase
        .from('boq_items')
        .select('code, superseded_at')
        .eq('project_id', projectId);
      if (existingErr) {
        warnings.push(
          `boq_items supersede lookup failed (stale codes may remain visible): ${existingErr.message}`,
        );
      } else {
        const existing: ExistingBoqCodeStatus[] = ((existingBoqRows ?? []) as { code: string; superseded_at: string | null }[])
          .map(r => ({ code: r.code, superseded: r.superseded_at != null }));
        const { toSupersede, toResurrect, excludedFromSupersede } = computeBoqSupersedeDelta(
          existing,
          boqIdByCode.keys(),
          [...quarantinedCodes, ...failedUpsertCodes],
        );

        if (excludedFromSupersede.length > 0) {
          warnings.push(
            `${excludedFromSupersede.length} code(s) failed to land this round (quarantined or upsert ` +
            `failure, not a plan change) — previous row remains ACTIVE, not superseded: ` +
            `${excludedFromSupersede.slice(0, 5).join(', ')}`,
          );
        }

        if (toSupersede.length > 0) {
          const { error: supersedeErr } = await supabase
            .from('boq_items')
            .update({ superseded_at: new Date().toISOString() })
            .eq('project_id', projectId)
            .in('code', toSupersede);
          if (supersedeErr) {
            warnings.push(
              `boq_items supersede update failed for ${toSupersede.length} code(s) ` +
              `(stale rows remain visible as active): ${supersedeErr.message}`,
            );
          } else {
            supersededCount = toSupersede.length;
          }
        }

        if (toResurrect.length > 0) {
          const { error: resurrectErr } = await supabase
            .from('boq_items')
            .update({ superseded_at: null })
            .eq('project_id', projectId)
            .in('code', toResurrect);
          if (resurrectErr) {
            warnings.push(
              `boq_items resurrect update failed for ${toResurrect.length} code(s) ` +
              `(reappeared code(s) may stay hidden as superseded): ${resurrectErr.message}`,
            );
          } else {
            resurrectedCount = toResurrect.length;
          }
        }
      }
    } catch (err) {
      warnings.push(
        `boq_items supersede step failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Build ahs_lines + master_lines from each BoQ row's NORMALIZED BREAKDOWN
  // (the per-diameter recipe components produced from the Breakdown sheets), NOT
  // the generic Analisa blocks. This is what makes the published baseline match
  // the material take-off: per-diameter rebar (Besi D10/D13/D16…), correct
  // Bendrat / decking, with quantity = planned-volume × qty-per-unit. Rows with
  // no breakdown (prelim/earthwork/steel) carry no components → no lines.
  //
  // tier has no meaning for a disaggregated line, so we use the catalog base tier (1).
  const { ahsLineInserts, masterLineInputs, unresolvedComponents } = buildSessionLineInputs(
    rows,
    catalog,
    catalogById,
    aliasMap,
    ahsVersionId,
    (code) => boqIdByCode.get(code),
  );
  let ahsFailedCount = 0;
  if (ahsLineInserts.length > 0) {
    const { failed: ahsFailed } = await resilientWrite(
      ahsLineInserts,
      (batch) => supabase.from('ahs_lines').insert(batch),
    );
    ahsFailedCount = ahsFailed.length;
    for (const f of ahsFailed) {
      quarantined.push(`AHS line "${(f.row as { material_spec?: string }).material_spec ?? '?'}": ${f.error}`);
    }
  }

  // Create the material master header + lines so per-(BoQ,material) demand is
  // queryable (v_material_envelopes → v_material_envelope_status → gate checks).
  //
  // No rebar-waste gross-up here: the breakdown already lists net per-diameter
  // rebar plus a separate "Besi beton — waste (5%)" line (which has no catalog
  // entry, so it drops out of master_lines), exactly as the material take-off
  // reports it. Folding waste back into the diameters would diverge from it.
  const { data: master, error: masterErr } = await supabase
    .from('project_material_master')
    .insert({ project_id: projectId, ahs_version_id: ahsVersionId })
    .select('id')
    .single();
  if (masterErr || !master) return { success: false, error: `material master insert failed: ${masterErr?.message}` };

  const masterLines = buildMasterLinesV2(masterLineInputs, master.id as string);
  let masterLineFailedCount = 0;
  const failedMasterMaterialIds = new Set<string>();
  if (masterLines.length > 0) {
    const { failed: mlFailed } = await resilientWrite(
      masterLines,
      (batch) => supabase.from('project_material_master_lines').insert(batch),
    );
    masterLineFailedCount = mlFailed.length;
    for (const f of mlFailed) {
      quarantined.push(`Master line: ${f.error}`);
      // Track which materials had a line fail so their baseline snapshot is not
      // anchored on a partial/absent master row (2.10 review item ii, below).
      if (f.row.material_id) failedMasterMaterialIds.add(f.row.material_id);
    }
  }

  // Immutable per-material anchor for Signal 2 (plan drift) — written right
  // after the master lines land, aggregated from the SAME masterLines this
  // publish just built (spec 2026-07-10-two-signal-overallocation-design.md
  // §4). The upsert's ignoreDuplicates:true sends ON CONFLICT (project_id,
  // material_id) DO NOTHING, so a material's snapshot is written only by the
  // FIRST publish in which it appears — every later publish's upsert for an
  // already-snapshotted material silently no-ops, and existing snapshot rows
  // are NEVER touched by this code path (this table has no UPDATE policy at
  // all — see migration 077). A material introduced only in THIS publish (not
  // present in any earlier master) gets its snapshot from this run.
  //
  // Non-fatal by design (controller decision): the snapshot is an anchor for
  // a secondary signal, not the plan itself — a failure here must never sink
  // an otherwise-successful publish that already wrote boq_items/ahs_lines/
  // master_lines. Surfaced via `warnings` so it is visible, never silent
  // (CLAUDE.md §1.1: wrong numbers — or silently missing ones — are worse
  // than an admitted gap). `warnings` itself is declared earlier, right after
  // the Task 3.1 supersede step, so both share one array.
  // 2.10 review item (ii): gate the snapshot on master-lines success. Only
  // anchor a baseline for materials whose master lines actually LANDED — a
  // material with ANY failed master line is excluded, because its snapshot qty
  // would be partial/wrong and a wrong anchor is worse than an absent one
  // (CLAUDE.md §1.1). In the common path (masterLineFailedCount === 0) nothing
  // is excluded and every snapshot is written as before.
  const snapshotRows = buildBaselineSnapshotRows(masterLines, projectId, master.id as string)
    .filter(s => !failedMasterMaterialIds.has(s.material_id));
  if (snapshotRows.length > 0) {
    const { failed: snapshotFailed } = await resilientWrite(
      snapshotRows,
      (batch) => supabase
        .from('material_baseline_snapshots')
        .upsert(batch, { onConflict: 'project_id,material_id', ignoreDuplicates: true }),
    );
    if (snapshotFailed.length > 0) {
      warnings.push(
        `${snapshotFailed.length} material_baseline_snapshots row(s) failed to write ` +
        `(anchor only — this publish's plan itself is unaffected): ` +
        `${snapshotFailed.slice(0, 5).map(f => f.error).join('; ')}`,
      );
    }
  }

  // ── Re-publish audit trail (Task 2.11 / spec §5) ────────────────────────
  // Written AFTER the new ahs_version + master + lines land, mirroring the
  // snapshot's non-fatal contract: a failure here surfaces as a `warnings`
  // entry and NEVER sinks an otherwise-successful publish (the plan itself is
  // already committed). Only a RE-PUBLISH writes a revision — a first publish
  // revised nothing (controller decision: no row for first publish). Even a
  // no-change re-publish writes the header row (empty lines + summary) so the
  // audit trail is complete; the supervisor/principal notification fires only
  // when materials-with-activity actually changed (diffLines non-empty).
  if (isRepublish && revisionContext) {
    try {
      const { data: revisionRow, error: revErr } = await supabase
        .from('plan_revisions')
        .insert({
          project_id: projectId,
          old_ahs_version_id: oldAhsVersionId,
          new_ahs_version_id: ahsVersionId,
          published_by: revisionContext.acknowledgedBy ?? null,
          acknowledged_at: revisionContext.acknowledgedAt,
          summary: revisionContext.summary ?? {},
        })
        .select('id')
        .single();
      if (revErr || !revisionRow) {
        warnings.push(
          `plan_revisions header failed to write (audit only — plan itself unaffected): ` +
          `${revErr?.message ?? 'no row returned'}`,
        );
      } else {
        const revisionId = revisionRow.id as string;
        const lineInserts = revisionContext.diffLines.map(l => ({
          revision_id: revisionId,
          material_id: l.material_id,
          planned_before: l.planned_before,
          planned_after: l.planned_after,
          ordered_at_time: l.ordered_at_time,
          requested_at_time: l.requested_at_time,
          classification: l.classification,
        }));
        if (lineInserts.length > 0) {
          const { failed: revLineFailed } = await resilientWrite(
            lineInserts,
            (batch) => supabase.from('plan_revision_lines').insert(batch),
          );
          if (revLineFailed.length > 0) {
            warnings.push(
              `${revLineFailed.length} plan_revision_lines failed to write (audit only): ` +
              `${revLineFailed.slice(0, 3).map(f => f.error).join('; ')}`,
            );
          }
        }
        // Fan out PLAN_REVISED to supervisors + FYI to principal — only when a
        // material-with-activity actually changed. Non-fatal (the RPC is itself
        // EXCEPTION-wrapped per-enqueue; this catches an RPC-dispatch failure).
        //
        // p_raise_count gates the PRINCIPAL FYI inside the RPC (078): the
        // principal only cares about ceiling RAISES (RAISE + RAISE_ABSOLVING_
        // OVERAGE), not lowers/removes/adds. Supervisors are always notified on
        // any non-empty diff. Computed from the acknowledged summary so the
        // notification scope matches what the checklist showed.
        if (revisionContext.diffLines.length > 0) {
          const raiseCount =
            (revisionContext.summary?.raisedAbsolvingOverage ?? 0) +
            (revisionContext.summary?.raised ?? 0);
          const { error: notifyErr } = await supabase.rpc('notify_plan_revised', {
            p_project_id: projectId,
            p_revision_id: revisionId,
            p_summary: revisionContext.notifySummaryText ?? 'Rencana material proyek diperbarui.',
            p_raise_count: raiseCount,
          });
          if (notifyErr) {
            warnings.push(`notify_plan_revised failed (non-fatal): ${notifyErr.message}`);
          }
        }
      }
    } catch (err) {
      warnings.push(
        `plan revision audit write failed (non-fatal): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Task 2.12 — burn the single-use ceiling approval (post-review) ──────
  // Only after a SUCCESSFUL re-publish that USED a principal approval do we
  // consume it, so the same "yes" can't authorise a second, larger re-publish
  // (migration 079: assert_ceiling_raise_gate rejects consumed tasks). Consuming
  // AFTER success (not at gate-pass time) is deliberate — see 079's "Single-use
  // approvals" header for the rationale + the accepted crash-window residual.
  // NON-FATAL: the plan is already committed; a consume failure surfaces as a
  // warning (the residual is one reusable approval, audited by plan_revisions),
  // never sinks the publish.
  if (isRepublish && options?.ceilingApprovalTaskId) {
    const { error: consumeErr } = await supabase.rpc('consume_approval_task', {
      p_task_id: options.ceilingApprovalTaskId,
    });
    if (consumeErr) {
      warnings.push(
        `consume_approval_task failed (non-fatal — approval may remain reusable): ${consumeErr.message}`,
      );
    }
  }

  if (unresolvedComponents.length > 0) {
    console.warn(
      `publishBaselineV2: ${unresolvedComponents.length} components unresolved to catalog ` +
      `(material_id NULL, not tracked per-material):`, unresolvedComponents.slice(0, 10),
    );
  }

  if (quarantined.length > 0) {
    console.warn(`publishBaselineV2: ${quarantined.length} row(s) quarantined:`, quarantined.slice(0, 10));
  }

  if (warnings.length > 0) {
    console.warn(`publishBaselineV2: ${warnings.length} warning(s):`, warnings);
  }

  return {
    success: true,
    boqCount: boqIdByCode.size,
    ahsCount: ahsLineInserts.length - ahsFailedCount,
    materialCount: rows.filter(r => r.row_type === 'material').length,
    masterLineCount: masterLines.length - masterLineFailedCount,
    unresolvedComponentCount: unresolvedComponents.length,
    skippedZeroPlanned,
    quarantinedRows: quarantined,
    warnings,
    supersededCount,
    resurrectedCount,
  };
}
