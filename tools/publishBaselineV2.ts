import type { StagingRowV2, CostSplit } from './boqParserV2/types';
import { toNumber } from './boqParserV2/classifyComponent';
import { reconcileMaterials } from './excelParser';
import type { CatalogEntry } from './excelParser';

export interface CatalogRow {
  id: string;
  code: string;
  name: string;
  category: string;
  tier: 1 | 2 | 3;
  unit: string;
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

export async function publishBaselineV2(
  sessionId: string,
  projectId: string,
): Promise<{
  success: boolean;
  error?: string;
  boqCount?: number;
  ahsCount?: number;
  materialCount?: number;
  skippedZeroPlanned?: string[];
}> {
  const { data: stagingRowsDB, error: fetchErr } = await supabase
    .from('import_staging_rows')
    .select('*')
    .eq('session_id', sessionId)
    .neq('review_status', 'REJECTED')
    .order('row_number', { ascending: true });

  if (fetchErr) return { success: false, error: fetchErr.message };
  if (!stagingRowsDB) return { success: false, error: 'No staging rows' };

  const rows = stagingRowsDB as unknown as StagingRowV2[];

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
    .insert({ project_id: projectId, import_session_id: sessionId, is_current: true })
    .select('id')
    .single();
  if (versionErr || !versionRow) {
    return { success: false, error: versionErr?.message ?? 'version insert failed' };
  }
  const ahsVersionId = versionRow.id as string;

  // Build boq_items map (code → id) by inserting BoQ rows first. Rows with a
  // non-positive take-off volume are excluded — see zeroPlannedBoqCodes for why
  // (CHECK (planned > 0) constraint; never fabricate a quantity). The codes are
  // reported back so the omission is visible, never silent. Codes are unique
  // here because the duplicate guard above already ran.
  const skippedZeroPlanned = zeroPlannedBoqCodes(rows);
  const skipSet = new Set(skippedZeroPlanned);
  const boqInserts = rows
    .filter(r => r.row_type === 'boq')
    .map(r => r.parsed_data as { code: string; label: string; unit: string; planned: number })
    .filter(pd => !skipSet.has(pd.code))
    .map(pd => ({
      project_id: projectId,
      code: pd.code,
      label: pd.label,
      unit: pd.unit,
      planned: pd.planned,
    }));
  const { data: boqData, error: boqErr } = await supabase
    .from('boq_items')
    .upsert(boqInserts, { onConflict: 'project_id,code' })
    .select('id, code');
  if (boqErr) return { success: false, error: boqErr.message };
  const boqIdByCode = new Map<string, string>(
    (boqData ?? []).map(b => [b.code as string, b.id as string]),
  );

  // Now write ahs_lines — one batch per block.
  //
  // ahs_lines requires boq_item_id (NOT NULL, FK), tier (NOT NULL, 1|2|3) and
  // unit (NOT NULL). We only emit lines for blocks that resolve to a real BoQ
  // item: blocks not linked to any BoQ ("Blok harga tidak dipakai BoQ") and
  // blocks whose BoQ was excluded (e.g. zero-volume) carry no baseline demand,
  // and a nested parent's lines already flow into its linked child via
  // flattenBlock — so skipping the standalone insert loses nothing. tier has no
  // meaning for a disaggregated line, so we use the catalog base tier (1).
  const ahsLineInserts: Record<string, unknown>[] = [];
  for (const block of sortedBlocks) {
    const blockParsed = block.parsed_data as { title: string };
    const lines = parentCache.get(block.row_number) ?? [];
    const linkedBoqCode = (block.parsed_data as { linked_boq_code?: string | null })
      .linked_boq_code;
    const linkedBoqId = linkedBoqCode ? boqIdByCode.get(linkedBoqCode) ?? null : null;
    if (linkedBoqId == null) continue;
    for (const line of lines) {
      // Breadcrumb is stored as "block:<row>"; resolve back to the parent
      // block's staging uuid so it satisfies the uuid column (null otherwise).
      const m = /^block:(\d+)$/.exec(line.origin_parent_ahs_id ?? '');
      const originUuid = m ? blockUuidByRowNumber.get(Number(m[1])) ?? null : null;
      ahsLineInserts.push({
        ahs_version_id: ahsVersionId,
        boq_item_id: linkedBoqId,
        tier: 1,
        unit: line.unit || '',
        material_spec: line.material_name,
        coefficient: line.coefficient,
        unit_price: line.unit_price,
        line_type: line.line_type,
        description: line.material_name,
        ahs_block_title: blockParsed.title,
        origin_parent_ahs_id: originUuid,
      });
    }
  }
  if (ahsLineInserts.length > 0) {
    const { error: lineErr } = await supabase.from('ahs_lines').insert(ahsLineInserts);
    if (lineErr) return { success: false, error: lineErr.message };
  }

  return {
    success: true,
    boqCount: boqInserts.length,
    ahsCount: ahsLineInserts.length,
    materialCount: rows.filter(r => r.row_type === 'material').length,
    skippedZeroPlanned,
  };
}
