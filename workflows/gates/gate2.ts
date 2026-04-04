import type {
  PurchaseOrderLine,
  PriceHistory,
  VendorScorecard,
  GateResult,
  FlagLevel,
  ProjectMaterialMasterLine,
} from '../../tools/types';

const FLAG_ORDER: FlagLevel[] = ['OK', 'INFO', 'WARNING', 'HIGH', 'CRITICAL'];

function worstFlag(a: FlagLevel, b: FlagLevel): FlagLevel {
  return FLAG_ORDER.indexOf(a) >= FLAG_ORDER.indexOf(b) ? a : b;
}

// ── Check 2a: Baseline Deviation ──────────────────────────────────────
// Compares PO line unit price against baseline AHS planned unit cost.
export function checkBaselineDeviation(
  line: PurchaseOrderLine,
  baselineLine: ProjectMaterialMasterLine | null,
  baselineUnitPrice: number | null,
): GateResult {
  if (!line.unit_price || line.unit_price <= 0) {
    return { flag: 'WARNING', check: '2a', msg: `Harga satuan belum diisi untuk "${line.material_name}".` };
  }

  if (!baselineLine || !baselineUnitPrice || baselineUnitPrice <= 0) {
    return { flag: 'INFO', check: '2a', msg: `Tidak ada harga baseline untuk "${line.material_name}" — review manual.` };
  }

  const devPct = ((line.unit_price - baselineUnitPrice) / baselineUnitPrice) * 100;

  if (devPct > 30) {
    return { flag: 'CRITICAL', check: '2a', msg: `Harga ${line.material_name} Rp${fmt(line.unit_price)} melebihi baseline Rp${fmt(baselineUnitPrice)} (+${devPct.toFixed(0)}%). Auto-hold.` };
  }
  if (devPct > 15) {
    return { flag: 'HIGH', check: '2a', msg: `Harga ${line.material_name} Rp${fmt(line.unit_price)} di atas baseline Rp${fmt(baselineUnitPrice)} (+${devPct.toFixed(0)}%). Eskalasi ke Principal.` };
  }
  if (devPct > 5) {
    return { flag: 'WARNING', check: '2a', msg: `Harga ${line.material_name} ${devPct.toFixed(0)}% di atas baseline. Estimator harus justifikasi.` };
  }
  if (devPct < -15) {
    return { flag: 'INFO', check: '2a', msg: `Harga ${line.material_name} ${Math.abs(devPct).toFixed(0)}% di bawah baseline — verifikasi kualitas/spec.` };
  }
  return { flag: 'OK', check: '2a', msg: `Harga ${line.material_name} dalam batas baseline (${devPct >= 0 ? '+' : ''}${devPct.toFixed(1)}%).` };
}

// ── Check 2b: Historical Price Comparison ──────────────────────────────
// Compares against recent price history for same material+vendor.
export function checkHistoricalPrice(
  line: PurchaseOrderLine,
  vendor: string,
  history: PriceHistory[],
): GateResult {
  if (!line.unit_price || line.unit_price <= 0) {
    return { flag: 'INFO', check: '2b', msg: 'Harga satuan belum diisi — skip historical check.' };
  }

  const relevant = history
    .filter(h => h.vendor === vendor)
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());

  if (relevant.length === 0) {
    return { flag: 'INFO', check: '2b', msg: `Belum ada riwayat harga dari vendor "${vendor}" untuk ${line.material_name}.` };
  }

  const lastPrice = relevant[0].unit_price;
  const devPct = ((line.unit_price - lastPrice) / lastPrice) * 100;

  // Also compute average of last 3
  const recentSlice = relevant.slice(0, 3);
  const avgPrice = recentSlice.reduce((s, h) => s + h.unit_price, 0) / recentSlice.length;
  const avgDevPct = ((line.unit_price - avgPrice) / avgPrice) * 100;

  if (devPct > 25) {
    return { flag: 'HIGH', check: '2b', msg: `Harga naik ${devPct.toFixed(0)}% dari harga terakhir vendor (Rp${fmt(lastPrice)} → Rp${fmt(line.unit_price)}). Eskalasi.` };
  }
  if (devPct > 10) {
    return { flag: 'WARNING', check: '2b', msg: `Harga naik ${devPct.toFixed(0)}% dari terakhir (Rp${fmt(lastPrice)}). Rata-rata 3 terakhir: Rp${fmt(avgPrice)}.` };
  }
  if (avgDevPct > 15) {
    return { flag: 'WARNING', check: '2b', msg: `Harga ${avgDevPct.toFixed(0)}% di atas rata-rata 3 transaksi terakhir (Rp${fmt(avgPrice)}).` };
  }
  return { flag: 'OK', check: '2b', msg: `Harga konsisten dengan riwayat vendor (${devPct >= 0 ? '+' : ''}${devPct.toFixed(1)}% dari terakhir).` };
}

// ── Check 2c: Vendor Consistency / Scorecard ──────────────────────────
// Flags low-scoring vendors or missing scorecards.
export function checkVendorConsistency(
  vendor: string,
  scorecard: VendorScorecard | null,
): GateResult {
  if (!scorecard) {
    return { flag: 'INFO', check: '2c', msg: `Vendor "${vendor}" belum memiliki scorecard — evaluasi manual diperlukan.` };
  }

  if (scorecard.score < 40) {
    return { flag: 'CRITICAL', check: '2c', msg: `Vendor "${vendor}" skor ${scorecard.score}/100 — tidak direkomendasikan. Auto-hold.` };
  }
  if (scorecard.score < 60) {
    return { flag: 'HIGH', check: '2c', msg: `Vendor "${vendor}" skor ${scorecard.score}/100 — perlu justifikasi kuat untuk melanjutkan.` };
  }
  if (scorecard.score < 75) {
    return { flag: 'WARNING', check: '2c', msg: `Vendor "${vendor}" skor ${scorecard.score}/100 — pertimbangkan alternatif.` };
  }
  return { flag: 'OK', check: '2c', msg: `Vendor "${vendor}" skor baik (${scorecard.score}/100).` };
}

// ── Composite Gate 2 ──────────────────────────────────────────────────
export interface Gate2Input {
  line: PurchaseOrderLine;
  vendor: string;
  baselineLine: ProjectMaterialMasterLine | null;
  baselineUnitPrice: number | null;
  priceHistory: PriceHistory[];
  vendorScorecard: VendorScorecard | null;
}

export interface Gate2Result {
  overall: GateResult;
  checks: {
    baseline: GateResult;
    historical: GateResult;
    vendor: GateResult;
  };
  requiresPrincipal: boolean;
}

export function computeGate2(input: Gate2Input): Gate2Result {
  const baseline = checkBaselineDeviation(input.line, input.baselineLine, input.baselineUnitPrice);
  const historical = checkHistoricalPrice(input.line, input.vendor, input.priceHistory);
  const vendor = checkVendorConsistency(input.vendor, input.vendorScorecard);

  // Determine overall worst flag
  let overallFlag: FlagLevel = 'OK';
  overallFlag = worstFlag(overallFlag, baseline.flag);
  overallFlag = worstFlag(overallFlag, historical.flag);
  overallFlag = worstFlag(overallFlag, vendor.flag);

  // Find the check that produced the worst flag for the primary message
  const allChecks = [baseline, historical, vendor];
  const worst = allChecks.reduce((a, b) =>
    FLAG_ORDER.indexOf(a.flag) >= FLAG_ORDER.indexOf(b.flag) ? a : b
  );

  const requiresPrincipal = overallFlag === 'HIGH' || overallFlag === 'CRITICAL';

  return {
    overall: {
      flag: overallFlag,
      check: '2',
      msg: worst.msg,
    },
    checks: { baseline, historical, vendor },
    requiresPrincipal,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────
function fmt(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}
