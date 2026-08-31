import type {
  BoqItem, Envelope, Milestone, GateResult, FlagLevel,
  MaterialEnvelopeStatus,
} from '../../tools/types';
import {
  buildOverageResult, makeOverageComponents, type QtyFormatter,
} from '../../tools/requestOverage';

const FLAG_ORDER: FlagLevel[] = ['OK', 'INFO', 'WARNING', 'HIGH', 'CRITICAL'];

/**
 * Client-side tier-aware gate check used by PermintaanScreen for immediate UI
 * feedback before server validation. The authoritative twin is migration 069's
 * compute_tier*_flag family (the server always re-decides on submit).
 *
 * (This used to say "call from envelopes.ts checkMaterialRequest()". That
 * function was dead and was deleted on 2026-08-31 — see the note where it lived
 * in tools/envelopes.ts.)
 */
export function computeGate1Flag(
  item: BoqItem,
  requestedQty: number,
  envelopes: Envelope[],
  milestones: Milestone[],
  /** Tier 2 envelope status from v_material_envelope_status (if available) */
  materialEnvelope?: MaterialEnvelopeStatus | null,
  /** Tier of the specific material line being checked */
  materialTier?: 1 | 2 | 3 | 4,
  /** Name of the material being requested — used for composition compatibility check */
  requestedMaterialName?: string,
  /**
   * Per-(BoQ item, material) planned + ordered for THIS material, from
   * get_boq_material_status. When present, the Tier-1 check measures the request
   * against the material's own remaining instead of the BoQ row's volume — the
   * fix for "2 kg of D13 vs a 1.65 m³ row reads as 21% over".
   */
  tier1MaterialPlanned?: { planned: number; ordered: number } | null,
): GateResult | null {
  if (requestedQty <= 0) {
    return { flag: 'WARNING', check: '1a', msg: 'Masukkan jumlah permintaan lebih dari 0.' };
  }

  // ── Check 1e: Material composition compatibility ───────────────────────
  // Validate that the requested material is appropriate for the selected BoQ item
  // by checking against tier1_material and tier2_material fields.
  if (requestedMaterialName && (item.tier1_material || item.tier2_material)) {
    const normalize = (s: string) =>
      s.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const reqNorm = normalize(requestedMaterialName);
    const expectedMaterials = [item.tier1_material, item.tier2_material]
      .filter(Boolean) as string[];

    // Build keyword tokens from expected materials (min 3 chars to skip noise words)
    const expectedTokens = expectedMaterials
      .flatMap(m => normalize(m).split(' '))
      .filter(t => t.length >= 3);

    // Check if any expected token appears in the requested material name
    const hasMatch = expectedTokens.some(token => reqNorm.includes(token)) ||
      expectedMaterials.some(em => normalize(em).includes(reqNorm.split(' ').filter(t => t.length >= 3).join(' ')));

    if (!hasMatch) {
      const tierLabels = expectedMaterials.join(' / ');
      return {
        flag: 'WARNING',
        check: '1e',
        msg: `Material "${requestedMaterialName}" tidak sesuai komposisi BoQ "${item.code} — ${item.label}". Diharapkan: ${tierLabels}. Pastikan material yang diminta sudah benar.`,
      };
    }
  }

  const remaining = item.planned - item.installed;
  const tier = materialTier ?? (item.tier2_material && !item.tier1_material ? 2 : 1);
  let check1a: GateResult;

  if (tier === 2 && materialEnvelope) {
    // ── Tier 2: Server-derived envelope check (new path) ──────────────
    check1a = buildProjectEnvelopeOverageResult(materialEnvelope, requestedQty);
  } else if (tier === 2 && !materialEnvelope) {
    // ── Tier 2 fallback: legacy envelope model ──────────────────────
    const envKey = (item.tier2_material ?? '').split('+').map(s => s.trim());
    const env = envelopes.find(e => envKey.some(k => e.material_name.includes(k)));

    if (env) {
      const afterReq = env.received + requestedQty;
      const adjustedCap = env.planned * env.ai_adjustment;
      const overPct = ((afterReq - adjustedCap) / adjustedCap) * 100;

      if (overPct > 40) {
        check1a = { flag: 'CRITICAL', check: '1a', msg: `Envelope ${env.material_name}: total ${afterReq.toFixed(0)} ${env.unit} melebihi cap ${adjustedCap.toFixed(0)} (+${overPct.toFixed(0)}%). Auto-hold.` };
      } else if (overPct > 25) {
        check1a = { flag: 'WARNING', check: '1a', msg: `Envelope ${env.material_name}: total ${afterReq.toFixed(0)} vs cap ${adjustedCap.toFixed(0)} ${env.unit} (+${overPct.toFixed(0)}%). Review.` };
      } else if (overPct > 15) {
        check1a = { flag: 'INFO', check: '1a', msg: `Envelope ${env.material_name}: laju konsumsi tinggi.` };
      } else {
        check1a = { flag: 'OK', check: '1a', msg: `Envelope ${env.material_name}: dalam batas (${afterReq.toFixed(0)} / ${adjustedCap.toFixed(0)} ${env.unit}).` };
      }
    } else {
      check1a = { flag: 'INFO', check: '1a', msg: `Material Tier 2 — belum ada envelope data. Review manual.` };
    }
  } else if (tier === 3) {
    // ── Tier 3: budget envelope (checked server-side) ──────────────
    check1a = { flag: 'OK', check: '1a', msg: `Tier 3 habis pakai — ${requestedQty} ${item.unit}. Budget envelope dicek server-side.` };
  } else if (tier === 4) {
    // ── Tier 4: untracked consumables — always passes ──────────────
    check1a = { flag: 'OK', check: '1a', msg: `Tier 4 consumable — tidak dilacak anggaran.` };
  } else {
    // ── Tier 1: per-material remaining when available, else BoQ volume ────
    const useMaterial = tier1MaterialPlanned != null && tier1MaterialPlanned.planned > 0;
    const matRemaining = useMaterial
      ? tier1MaterialPlanned!.planned - tier1MaterialPlanned!.ordered
      : remaining;
    const sisaLabel = useMaterial
      ? `sisa material: ${matRemaining.toFixed(2)}`
      : `sisa: ${matRemaining.toFixed(2)} ${item.unit}`;
    // "sisa material" when measuring a specific material's remaining (kg/zak/…),
    // "sisa BoQ" when falling back to the row's take-off volume — so a kg request
    // isn't described against the BoQ's m³ allocation.
    const sisaNoun = useMaterial ? 'sisa material' : 'sisa BoQ';
    const pct = matRemaining > 0 ? ((requestedQty - matRemaining) / matRemaining) * 100 : 999;

    if (pct > 30) {
      check1a = { flag: 'CRITICAL', check: '1a', msg: `Permintaan melebihi ${sisaNoun} ${pct.toFixed(0)}% (>30%). Auto-hold.` };
    } else if (pct > 15) {
      check1a = { flag: 'WARNING', check: '1a', msg: `Permintaan ${pct.toFixed(0)}% di atas ${sisaNoun}. Estimator harus justifikasi.` };
    } else if (pct > 5) {
      check1a = { flag: 'INFO', check: '1a', msg: `Permintaan ${pct.toFixed(0)}% di atas ${sisaNoun}. Estimator review.` };
    } else {
      check1a = { flag: 'OK', check: '1a', msg: `Dalam batas ${useMaterial ? 'material' : 'BoQ'} (${sisaLabel}).` };
    }
  }

  // Check 1d — Schedule Pace
  let check1d: GateResult | null = null;
  const milestone = milestones.find(m => m.boq_ids.includes(item.id));

  if (milestone) {
    const today = new Date();
    const mDate = new Date(milestone.planned_date);
    const daysOut = Math.round((mDate.getTime() - today.getTime()) / 86400000);
    const orderedPct = item.planned > 0 ? ((item.installed + requestedQty) / item.planned) * 100 : 0;

    if (daysOut < 0) {
      check1d = {
        flag: 'WARNING',
        check: '1d',
        msg: `Milestone "${milestone.label}" sudah terlewat ${Math.abs(daysOut)} hari. Permintaan tetap boleh diajukan, tetapi estimator harus review percepatan/jadwal.`,
      };
    } else if (daysOut <= 7 && orderedPct < 50) {
      check1d = { flag: 'WARNING', check: '1d', msg: `Milestone "${milestone.label}" dalam ${daysOut} hari tapi hanya ${orderedPct.toFixed(0)}% material dipesan.` };
    } else if (daysOut > 14) {
      check1d = { flag: 'INFO', check: '1d', msg: `Permintaan >2 minggu sebelum milestone "${milestone.label}" (${daysOut} hari).` };
    } else {
      check1d = { flag: 'OK', check: '1d', msg: `Permintaan sesuai jadwal milestone "${milestone.label}" (${daysOut} hari lagi).` };
    }
  } else {
    check1d = { flag: 'INFO', check: '1d', msg: 'Item belum tergabung dalam milestone — review jadwal manual.' };
  }

  // Return worst flag with extra
  if (check1d) {
    const worstIdx = Math.max(FLAG_ORDER.indexOf(check1a.flag), FLAG_ORDER.indexOf(check1d.flag));
    const worst = FLAG_ORDER.indexOf(check1a.flag) >= FLAG_ORDER.indexOf(check1d.flag) ? check1a : check1d;
    const other = worst === check1a ? check1d : check1a;
    return { ...worst, extra: other };
  }

  return check1a;
}

/** Wrap the gate1 EnvelopeUnitDisplay formatting into the requestOverage
 * QtyFormatter shape so the running-total copy keeps its "X batang (Y kg)"
 * rendering for rebar while the burn math stays base-unit. */
function displayFmt(display?: EnvelopeUnitDisplay | null): QtyFormatter {
  return (n, unit) => fmtEnvOne(n, unit, display);
}

/**
 * Signal-1 soft heads-up for the PROJECT envelope (Tier 2 / Tier 3 quantity
 * grain). projected = di-PO (total_ordered) + permintaan berjalan
 * (total_requested) + permintaan ini. Severity caps at WARNING (spec §3); copy
 * is the running total. No baseline → explicit "Tidak ada alokasi pembanding".
 *
 * SERVER TWIN — compute_tier2_flag in migration 069 (which reads
 * v_material_envelope_status.total_ordered (PO) + a re-derived other-open-
 * requests leg). Both cap at WARNING; keep the two in lockstep.
 */
export function buildProjectEnvelopeOverageResult(
  envelope: MaterialEnvelopeStatus | null,
  requestedQty: number,
  display?: EnvelopeUnitDisplay | null,
): GateResult {
  if (!envelope || Number(envelope.total_planned ?? 0) <= 0) {
    return {
      flag: 'INFO',
      check: '1a',
      msg: 'Tidak ada alokasi pembanding — material belum punya rencana (envelope) di proyek. Estimator review manual.',
    };
  }
  const c = makeOverageComponents({
    grainLabel: 'Proyek',
    poOrdered: Number(envelope.total_ordered ?? 0),
    otherOpen: Number(envelope.total_requested ?? 0),
    thisRequest: requestedQty,
    planned: Number(envelope.total_planned ?? 0),
    unit: envelope.unit,
  });
  const extra: GateResult | undefined = envelope.boq_item_count > 0
    ? { flag: 'INFO', check: 'scope', msg: `${envelope.boq_item_count} item BoQ dihitung proporsional.` }
    : undefined;
  return buildOverageResult(c, '1a', { infoBand: true, extra, fmt: displayFmt(display) });
}

/**
 * Gate 1 soft heads-up for a work-group order (Tier 1 → whole work-group).
 * Validates the requested material against the group's aggregate planned demand.
 * Severity caps at WARNING (spec §3 — request time never hard-blocks on
 * quantity); copy is the running total, grain named ("Grup: <label>"). A group
 * with no planned demand yields a soft INFO (never a fake-correct OK).
 *
 * PO LEG AT GROUP GRAIN (changed 2026-08-31, migration 094):
 * The group-grain envelope now carries SPLIT legs. `total_ordered` is genuinely
 * PO-ordered demand (allocations linked to a non-CANCELLED PO) and
 * `total_requested` is the open remainder — see getWorkGroupEnvelope, which
 * takes both from get_workgroup_material_envelopes (086). Before this, a single
 * request-based figure was mirrored into both fields and the PO segment was
 * suppressed (poOrdered = null) because the grain genuinely could not see PO
 * quantity. It can now, so the running total names all three parts.
 *
 * ⚠ SEVERITY IS UNCHANGED BY THAT SPLIT — and must stay so. projected is still
 * ordered + requested + this request, which is exactly the old single figure
 * plus this request (086's ordered + requested sums to the pre-split
 * total_ordered by construction; the identity is 086's verification query).
 * Only the COPY gains a "Sudah di-PO …" segment. Anyone re-pointing the burn to
 * the PO leg alone would silently halve a live gate input.
 *
 * When the PROJECT envelope is passed it is still appended for project-grain PO
 * context — a different scope from the group, so it does not duplicate the
 * group's own PO segment and it does NOT change severity.
 *
 * SERVER TWIN — compute_tier1_workgroup_flag in migration 069 keeps the same
 * total-demand burn and the INFO-on-missing-baseline rule, capped at WARNING.
 * The progressPaceFlag advisory (1d) below is CLIENT-ONLY (never HIGH/CRITICAL,
 * so it never promotes AUTO_HOLD) — the server enforces only the burn check.
 */
export function computeWorkGroupGate1Flag(
  envelope: MaterialEnvelopeStatus | null,
  requestedQty: number,
  groupLabel: string,
  display?: EnvelopeUnitDisplay | null,
  projectEnvelope?: MaterialEnvelopeStatus | null,
): GateResult {
  if (requestedQty <= 0) {
    return { flag: 'WARNING', check: '1a', msg: 'Masukkan jumlah permintaan lebih dari 0.' };
  }
  if (!envelope || envelope.total_planned <= 0) {
    return {
      flag: 'INFO',
      check: '1a',
      msg: `Tidak ada alokasi pembanding untuk grup "${groupLabel}". Belum ada baseline material — estimator review manual.`,
    };
  }

  // 1a — group envelope burn. projected = sudah di-PO (group) + permintaan
  // berjalan (group) + permintaan ini. The sum is identical to the pre-094
  // single-figure burn; the split only names the parts (see the ⚠ above).
  const c = makeOverageComponents({
    grainLabel: `Grup: ${groupLabel}`,
    poOrdered: Number(envelope.total_ordered ?? 0),
    otherOpen: Number(envelope.total_requested ?? 0),
    thisRequest: requestedQty,
    planned: Number(envelope.total_planned ?? 0),
    unit: envelope.unit,
  });
  const burn = buildOverageResult(c, '1a', { infoBand: false, fmt: displayFmt(display) });

  // Project-wide PO context (display only) — a WIDER scope than the group, so it
  // answers a different question than the group's own di-PO segment above.
  if (projectEnvelope && Number(projectEnvelope.total_planned ?? 0) > 0) {
    const projPo = Number(projectEnvelope.total_ordered ?? 0);
    const projPlanned = Number(projectEnvelope.total_planned ?? 0);
    burn.msg += ` (Proyek: sudah di-PO ${fmtEnvOne(projPo, projectEnvelope.unit, display)} dari rencana ${fmtEnvOne(projPlanned, projectEnvelope.unit, display)}).`;
  }

  // 1d — progress pace: is this order running ahead of physical progress?
  // Material is ordered ahead of installation (normal), so only the GAP between
  // ordered% and installed% is flagged — small early orders never trip it.
  const pace = progressPaceFlag(envelope, requestedQty);
  if (!pace) return burn;
  const burnWorse = FLAG_ORDER.indexOf(burn.flag) >= FLAG_ORDER.indexOf(pace.flag);
  const worst = burnWorse ? burn : pace;
  const other = burnWorse ? pace : burn;
  // Preserve the overage components on the returned result regardless of which
  // sub-result ranks worst, so the reason-required predicate still sees them.
  return { ...worst, extra: other, overage: burn.overage };
}

/**
 * Advisory linking material orders to physical progress: flags when the ordered
 * share of the group's planned material runs well ahead of the installed share
 * (progress). Returns null within a normal procurement lead so small early
 * orders (at 0% progress) never trip it.
 *
 * "Ordered" here means ALL committed demand — total_ordered (on a live PO) plus
 * total_requested (in flight) — not the PO leg alone. Pre-094 the group envelope
 * carried one combined figure in total_ordered; reading only that field after
 * the 094 split would quietly narrow this advisory to PO'd quantity and stop
 * flagging a group whose stock-piling is all sitting in the approval queue.
 */
function progressPaceFlag(env: MaterialEnvelopeStatus, requestedQty: number): GateResult | null {
  if (env.total_planned <= 0) return null;
  const installedPct = ((env.total_installed ?? 0) / env.total_planned) * 100;
  const committed = Number(env.total_ordered ?? 0) + Number(env.total_requested ?? 0);
  const orderedPct = ((committed + requestedQty) / env.total_planned) * 100;
  const ahead = orderedPct - installedPct;
  if (ahead <= 40) return null; // within a reasonable lead — no flag
  const msg = `Pemesanan ${orderedPct.toFixed(0)}% dari rencana, tapi progres terpasang baru ${installedPct.toFixed(0)}% `
    + `(memesan ${ahead.toFixed(0)}% di depan progres). Material berisiko menumpuk — pastikan sesuai jadwal.`;
  return { flag: ahead > 70 ? 'WARNING' : 'INFO', check: '1d', msg };
}

function fmtN(n: number): string {
  return Math.round(n).toLocaleString('id-ID');
}

/**
 * Display descriptor for showing an envelope (stored in base units, e.g. kg for
 * rebar) in the SUPPLIER unit the user orders in (batang). The burn math stays
 * base-unit — percentages are unit-invariant — this only reformats the shown
 * numbers. `factor` = base units per one supplier unit (kg per batang).
 */
export interface EnvelopeUnitDisplay {
  factor: number | null;
  supplierUnit: string;
}

function fmtBatang(kg: number, display?: EnvelopeUnitDisplay | null): string {
  return display?.factor && display.factor > 0
    ? (kg / display.factor).toLocaleString('id-ID', { maximumFractionDigits: 2 })
    : fmtN(kg);
}

/** "X batang (X kg)" when a factor exists, else "X kg". */
function fmtEnvOne(kg: number, baseUnit: string, display?: EnvelopeUnitDisplay | null): string {
  if (display?.factor && display.factor > 0) {
    return `${fmtBatang(kg, display)} ${display.supplierUnit} (${fmtN(kg)} ${baseUnit})`;
  }
  return `${fmtN(kg)} ${baseUnit}`;
}
