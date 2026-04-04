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
): GateResult | null {
  if (requestedQty <= 0) {
    return { flag: 'WARNING', check: '1a', msg: 'Masukkan jumlah permintaan lebih dari 0.' };
  }

  const remaining = item.planned - item.installed;
  const tier = materialTier ?? (item.tier2_material && !item.tier1_material ? 2 : 1);
  let check1a: GateResult;

  if (tier === 2 && materialEnvelope) {
    // ── Tier 2: Server-derived envelope check (new path) ──────────────
    const newTotal = materialEnvelope.total_ordered + requestedQty;
    const burnPct = materialEnvelope.total_planned > 0
      ? (newTotal / materialEnvelope.total_planned) * 100
      : 0;
    const remainingEnv = materialEnvelope.total_planned - materialEnvelope.total_ordered;
    const matName = materialEnvelope.material_name;
    const u = materialEnvelope.unit;

    if (burnPct > 120) {
      check1a = {
        flag: 'CRITICAL',
        check: '1a',
        msg: `Envelope ${matName}: ${fmtN(newTotal)} / ${fmtN(materialEnvelope.total_planned)} ${u} (${burnPct.toFixed(0)}%). Melebihi +20%. Auto-hold.`,
      };
    } else if (burnPct > 100) {
      check1a = {
        flag: 'HIGH',
        check: '1a',
        msg: `Envelope ${matName} melampaui batas: ${fmtN(newTotal)} / ${fmtN(materialEnvelope.total_planned)} ${u} (${burnPct.toFixed(0)}%). Eskalasi.`,
      };
    } else if (burnPct > 80) {
      check1a = {
        flag: 'WARNING',
        check: '1a',
        msg: `Envelope ${matName}: ${burnPct.toFixed(0)}% terpakai (sisa ~${fmtN(remainingEnv - requestedQty)} ${u}). Mendekati batas.`,
      };
    } else {
      check1a = {
        flag: 'OK',
        check: '1a',
        msg: `Envelope ${matName}: ${burnPct.toFixed(0)}% (${fmtN(newTotal)} / ${fmtN(materialEnvelope.total_planned)} ${u}). ${materialEnvelope.boq_item_count} item BoQ terkait.`,
      };
    }
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
    // ── Tier 1: direct BoQ remaining check ────────────────────────
    const pct = remaining > 0 ? ((requestedQty - remaining) / remaining) * 100 : 999;

    if (pct > 30) {
      check1a = { flag: 'CRITICAL', check: '1a', msg: `Permintaan melebihi sisa BoQ ${pct.toFixed(0)}% (>30%). Auto-hold.` };
    } else if (pct > 15) {
      check1a = { flag: 'WARNING', check: '1a', msg: `Permintaan ${pct.toFixed(0)}% di atas sisa BoQ. Estimator harus justifikasi.` };
    } else if (pct > 5) {
      check1a = { flag: 'INFO', check: '1a', msg: `Permintaan ${pct.toFixed(0)}% di atas sisa BoQ. Estimator review.` };
    } else {
      check1a = { flag: 'OK', check: '1a', msg: `Dalam batas BoQ (sisa: ${remaining.toFixed(2)} ${item.unit}).` };
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

function fmtN(n: number): string {
  return Math.round(n).toLocaleString('id-ID');
}
