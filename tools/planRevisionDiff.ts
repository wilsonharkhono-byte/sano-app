// tools/planRevisionDiff.ts — the heart of Task 2.11 (re-publish diff).
//
// Design authority: docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md §5.
//
// PURE module — no I/O, no Supabase. Given the material master a publish is
// ABOUT to write (newMasterRows), the CURRENT published master
// (currentMasterRows), and per-material activity (POs / requests / receipts),
// it classifies every material whose planned quantity is about to change and
// tells the caller which changes need an explicit human acknowledgment before
// the re-publish may proceed.
//
// WHY this exists: a re-publish silently rewrites planned quantities under
// in-flight requests/POs — the exact "signal erased by re-publish" the
// two-signal design forbids (spec §5, §1.2 truth-correctness contract). This
// turns a silent rewrite into a witnessed, classified, persisted event.
//
// CLASSIFICATION (spec §5 step 2). Only the FOUR spec classes are WARNING
// classes (each needs its own explicit tick in the acknowledgment checklist);
// ADDED / LOWER / UNCHANGED_SUMMARY are warning-free record classes the
// controller added for a complete audit trail:
//
//   RAISE_ABSOLVING_OVERAGE  ordered > planned_before AND planned_after > planned_before
//                            (raising the ceiling to cover an already-placed
//                            overage → the strongest signal; Task 2.12 will
//                            hold this behind a principal gate).
//   RAISE                    planned_after > planned_before, not absolving.
//   LOWER_BELOW_ORDERED      planned_after < ordered (the new plan is below what
//                            has already been ordered → "akan tercatat X%
//                            melebihi alokasi baru").
//   REMOVED_WITH_ACTIVITY    material present in current master, absent from the
//                            new one, but has activity → orphaned commitments.
//   ADDED                    material new to the plan (record only).
//   LOWER                    planned_after < planned_before but ≥ ordered (record only).
//   UNCHANGED_SUMMARY        reserved: no-activity changes collapse into the
//                            summary count, never an individual persisted line.
//
// ACTIVITY SCOPING (spec §5 step 1): the diff produces an INDIVIDUAL line only
// for a material that (a) has activity — any non-rejected request line,
// non-cancelled PO line, or receipt — AND (b) actually changed. Materials that
// changed but have NO activity collapse into `summary.noActivityChanged` (a
// count only); materials that did not change at all are ignored entirely.

export type PlanRevisionClassification =
  | 'RAISE_ABSOLVING_OVERAGE'
  | 'RAISE'
  | 'LOWER_BELOW_ORDERED'
  | 'REMOVED_WITH_ACTIVITY'
  | 'ADDED'
  | 'LOWER'
  | 'UNCHANGED_SUMMARY';

/**
 * The four spec §5 warning classes, in canonical (severity-narrative) order.
 * Each present class needs its own tick in BaselineScreen's acknowledgment
 * checklist before the re-publish may proceed. Order is stable so the UI and
 * the persisted summary read consistently.
 */
export const PLAN_REVISION_WARNING_CLASSES = [
  'RAISE_ABSOLVING_OVERAGE',
  'RAISE',
  'LOWER_BELOW_ORDERED',
  'REMOVED_WITH_ACTIVITY',
] as const satisfies readonly PlanRevisionClassification[];

const WARNING_SET = new Set<PlanRevisionClassification>(PLAN_REVISION_WARNING_CLASSES);

/** One material's planned quantity in a master (per-(boq,material) or pre-summed). */
export interface PlanMasterRow {
  material_id: string;
  planned_quantity: number;
}

/**
 * Per-material activity at revision time (base units), from
 * v_material_envelope_status + a receipts-existence probe:
 *   ordered   — non-cancelled SANO PO line qty (the hard "what's ordered" anchor).
 *   requested — non-rejected material request line qty.
 *   receiptsExist — any receipt line for the material.
 * A material "has activity" iff ordered > 0 OR requested > 0 OR receiptsExist.
 */
export interface MaterialActivity {
  ordered: number;
  requested: number;
  receiptsExist: boolean;
}

export interface PlanRevisionLine {
  material_id: string;
  planned_before: number;
  planned_after: number;
  ordered_at_time: number;
  requested_at_time: number;
  classification: PlanRevisionClassification;
}

export interface PlanRevisionSummary {
  raisedAbsolvingOverage: number;
  raised: number;
  loweredBelowOrdered: number;
  removedWithActivity: number;
  added: number;
  lowered: number;
  /** Materials that changed but have no activity — collapsed count only. */
  noActivityChanged: number;
  /** Count of individual lines whose classification is a warning class. */
  warningCount: number;
}

export interface PlanRevisionDiffResult {
  /** One per material that has activity AND changed (added/removed/raised/lowered). */
  lines: PlanRevisionLine[];
  /** Distinct warning classes present, in canonical order — drives the checklist. */
  warningClasses: PlanRevisionClassification[];
  summary: PlanRevisionSummary;
}

const hasActivity = (a: MaterialActivity): boolean =>
  a.ordered > 0 || a.requested > 0 || a.receiptsExist;

/**
 * Sum per-(boq_item, material) planned quantities down to one figure per
 * material_id — the grain the diff compares on. buildMasterLinesV2 emits
 * per-(boq,material) rows; both current and new masters are aggregated here so
 * a material split across several BoQ items is compared as a single ceiling.
 */
export function aggregatePlannedByMaterial(rows: PlanMasterRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.material_id) continue;
    out.set(r.material_id, (out.get(r.material_id) ?? 0) + (Number(r.planned_quantity) || 0));
  }
  return out;
}

/**
 * Map (before, after, presence, activity) → classification for a material that
 * has activity AND changed. Pure and boundary-exact:
 *   - ordered == planned_before → NOT absolving (plain RAISE).
 *   - planned_after == ordered  → NOT below (plain LOWER).
 * The caller is responsible for the activity gate; this function does not
 * re-check it (a REMOVED result is named *_WITH_ACTIVITY on that contract).
 */
export function classifyPlanChange(
  before: number,
  after: number,
  inNew: boolean,
  inCurrent: boolean,
  activity: MaterialActivity,
): PlanRevisionClassification {
  if (inCurrent && !inNew) return 'REMOVED_WITH_ACTIVITY';
  if (!inCurrent && inNew) return 'ADDED';
  // Present in both, and after !== before.
  if (after > before) {
    return activity.ordered > before ? 'RAISE_ABSOLVING_OVERAGE' : 'RAISE';
  }
  // after < before
  return activity.ordered > after ? 'LOWER_BELOW_ORDERED' : 'LOWER';
}

/**
 * Compute the classified diff between the master a publish is about to write and
 * the current published master. See the module header for the full contract.
 *
 * `activity` is keyed by material_id; a missing entry means no activity.
 */
export function computePlanRevisionDiff(
  newMasterRows: PlanMasterRow[],
  currentMasterRows: PlanMasterRow[],
  activity: Map<string, MaterialActivity>,
): PlanRevisionDiffResult {
  const newMap = aggregatePlannedByMaterial(newMasterRows);
  const currentMap = aggregatePlannedByMaterial(currentMasterRows);

  const summary: PlanRevisionSummary = {
    raisedAbsolvingOverage: 0,
    raised: 0,
    loweredBelowOrdered: 0,
    removedWithActivity: 0,
    added: 0,
    lowered: 0,
    noActivityChanged: 0,
    warningCount: 0,
  };
  const lines: PlanRevisionLine[] = [];

  // Union of both masters' materials. Activity-only materials (in neither
  // master) have no plan to revise, so they are deliberately not in the union.
  const materialIds = new Set<string>([...newMap.keys(), ...currentMap.keys()]);

  for (const materialId of materialIds) {
    const inNew = newMap.has(materialId);
    const inCurrent = currentMap.has(materialId);
    const before = currentMap.get(materialId) ?? 0;
    const after = newMap.get(materialId) ?? 0;

    // Not a revision: present in both with an identical planned quantity.
    const changed = inNew !== inCurrent || after !== before;
    if (!changed) continue;

    const act = activity.get(materialId) ?? { ordered: 0, requested: 0, receiptsExist: false };

    // Changed but no activity → collapse into the summary, never a line
    // (spec §5 step 1: materials without activity are a summary only).
    if (!hasActivity(act)) {
      summary.noActivityChanged += 1;
      continue;
    }

    const classification = classifyPlanChange(before, after, inNew, inCurrent, act);
    lines.push({
      material_id: materialId,
      planned_before: before,
      planned_after: after,
      ordered_at_time: act.ordered,
      requested_at_time: act.requested,
      classification,
    });

    switch (classification) {
      case 'RAISE_ABSOLVING_OVERAGE': summary.raisedAbsolvingOverage += 1; break;
      case 'RAISE': summary.raised += 1; break;
      case 'LOWER_BELOW_ORDERED': summary.loweredBelowOrdered += 1; break;
      case 'REMOVED_WITH_ACTIVITY': summary.removedWithActivity += 1; break;
      case 'ADDED': summary.added += 1; break;
      case 'LOWER': summary.lowered += 1; break;
      case 'UNCHANGED_SUMMARY': break; // never emitted as a line
    }
    if (WARNING_SET.has(classification)) summary.warningCount += 1;
  }

  // Distinct warning classes present, in canonical order.
  const present = new Set(
    lines.map(l => l.classification).filter(c => WARNING_SET.has(c)),
  );
  const warningClasses = PLAN_REVISION_WARNING_CLASSES.filter(c => present.has(c));

  return { lines, warningClasses, summary };
}

/**
 * For a LOWER_BELOW_ORDERED line: the already-ordered quantity as a percent of
 * the new (lower) plan — the "akan tercatat X% melebihi alokasi baru" figure
 * (spec §5). Infinity when the new plan is zero (material fully removed).
 */
export function lowerBelowOrderedPct(line: {
  ordered_at_time: number;
  planned_after: number;
}): number {
  if (!(line.planned_after > 0)) return Infinity;
  return Math.round((line.ordered_at_time / line.planned_after) * 100);
}
