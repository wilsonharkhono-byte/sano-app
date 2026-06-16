import type {
  BoqItem, Envelope, Milestone, GateResult, FlagLevel,
  MaterialEnvelopeStatus,
} from '../../tools/types';

const FLAG_ORDER: FlagLevel[] = ['OK', 'INFO', 'WARNING', 'HIGH', 'CRITICAL'];

/**
 * Server-side tier-aware gate check. Call from envelopes.ts checkMaterialRequest()
 * when Supabase is available. This client-side version is the fallback used
 * by PermintaanScreen for immediate UI feedback before server validation.
 */
export function computeGate1Flag(
  item: BoqItem,
  requestedQty: number,
  envelopes: Envelope[],
  milestones: Milestone[],
  /** Tier 2 envelope status from v_material_envelope_status (if available) */
  materialEnvelope?: MaterialEnvelopeStatus | null,
  /** Tier of the specific material line being checked */
  materialTier?: 1 | 2 | 3,
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
    check1a = envelopeBurnFlag(materialEnvelope, requestedQty);
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
    // ── Tier 3: spend cap (lightweight check) ─────────────────────
    check1a = { flag: 'OK', check: '1a', msg: `Tier 3 habis pakai — ${requestedQty} ${item.unit}. Spend cap dicek server-side.` };
  } else {
    // ── Tier 1: per-material remaining when available, else BoQ volume ────
    const useMaterial = tier1MaterialPlanned != null && tier1MaterialPlanned.planned > 0;
    const matRemaining = useMaterial
      ? tier1MaterialPlanned!.planned - tier1MaterialPlanned!.ordered
      : remaining;
    const sisaLabel = useMaterial
      ? `sisa material: ${matRemaining.toFixed(2)}`
      : `sisa: ${matRemaining.toFixed(2)} ${item.unit}`;
    const pct = matRemaining > 0 ? ((requestedQty - matRemaining) / matRemaining) * 100 : 999;

    if (pct > 30) {
      check1a = { flag: 'CRITICAL', check: '1a', msg: `Permintaan melebihi sisa BoQ ${pct.toFixed(0)}% (>30%). Auto-hold.` };
    } else if (pct > 15) {
      check1a = { flag: 'WARNING', check: '1a', msg: `Permintaan ${pct.toFixed(0)}% di atas sisa BoQ. Estimator harus justifikasi.` };
    } else if (pct > 5) {
      check1a = { flag: 'INFO', check: '1a', msg: `Permintaan ${pct.toFixed(0)}% di atas sisa BoQ. Estimator review.` };
    } else {
      check1a = { flag: 'OK', check: '1a', msg: `Dalam batas BoQ (${sisaLabel}).` };
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

/**
 * Burn-threshold flag for an aggregate envelope (Tier 2 material envelope or a
 * work-group envelope). Shared so the two paths apply identical thresholds.
 */
function envelopeBurnFlag(env: MaterialEnvelopeStatus, requestedQty: number): GateResult {
  const newTotal = env.total_ordered + requestedQty;
  const burnPct = env.total_planned > 0 ? (newTotal / env.total_planned) * 100 : 0;
  const remainingEnv = env.total_planned - env.total_ordered;
  const matName = env.material_name;
  const u = env.unit;

  if (burnPct > 120) {
    return { flag: 'CRITICAL', check: '1a', msg: `Envelope ${matName}: ${fmtN(newTotal)} / ${fmtN(env.total_planned)} ${u} (${burnPct.toFixed(0)}%). Melebihi +20%. Auto-hold.` };
  } else if (burnPct > 100) {
    return { flag: 'HIGH', check: '1a', msg: `Envelope ${matName} melampaui batas: ${fmtN(newTotal)} / ${fmtN(env.total_planned)} ${u} (${burnPct.toFixed(0)}%). Eskalasi.` };
  } else if (burnPct > 80) {
    return { flag: 'WARNING', check: '1a', msg: `Envelope ${matName}: ${burnPct.toFixed(0)}% terpakai (sisa ~${fmtN(remainingEnv - requestedQty)} ${u}). Mendekati batas.` };
  }
  return { flag: 'OK', check: '1a', msg: `Envelope ${matName}: ${burnPct.toFixed(0)}% (${fmtN(newTotal)} / ${fmtN(env.total_planned)} ${u}). ${env.boq_item_count} item BoQ terkait.` };
}

/**
 * Gate 1 flag for a work-group order (Tier 1 → whole work-group). Validates the
 * requested material against the group's aggregate planned demand using the same
 * burn thresholds as Tier 2. Requires a catalog material to have a baseline; a
 * group with no planned demand for the material yields a soft INFO (never a
 * fake-correct OK).
 */
export function computeWorkGroupGate1Flag(
  envelope: MaterialEnvelopeStatus | null,
  requestedQty: number,
  groupLabel: string,
): GateResult {
  if (requestedQty <= 0) {
    return { flag: 'WARNING', check: '1a', msg: 'Masukkan jumlah permintaan lebih dari 0.' };
  }
  if (!envelope || envelope.total_planned <= 0) {
    return {
      flag: 'INFO',
      check: '1a',
      msg: `Belum ada baseline material untuk grup "${groupLabel}". Tidak bisa divalidasi otomatis — estimator review manual.`,
    };
  }
  return envelopeBurnFlag(envelope, requestedQty);
}

function fmtN(n: number): string {
  return Math.round(n).toLocaleString('id-ID');
}
