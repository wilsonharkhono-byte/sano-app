import type {
  PurchaseOrderLine,
  PriceHistory,
  VendorScorecard,
  GateResult,
  FlagLevel,
  ProjectMaterialMasterLine,
  AhsLine,
} from '../../tools/types';

const FLAG_ORDER: FlagLevel[] = ['OK', 'INFO', 'WARNING', 'HIGH', 'CRITICAL'];

function worstFlag(a: FlagLevel, b: FlagLevel): FlagLevel {
  return FLAG_ORDER.indexOf(a) >= FLAG_ORDER.indexOf(b) ? a : b;
}

export interface MaterialBaselinePriceSummary {
  material_id: string;
  baseline_unit_price: number;
  min_unit_price: number;
  max_unit_price: number;
  sample_count: number;
  spread_pct: number;
}

export function summarizeAhsBaselinePrices(
  ahsLines: Array<Pick<AhsLine, 'material_id' | 'unit_price' | 'line_type'>>,
): Map<string, MaterialBaselinePriceSummary> {
  const grouped = new Map<string, number[]>();

  for (const line of ahsLines) {
    if (line.line_type !== 'material') continue;
    if (!line.material_id) continue;

    const unitPrice = Number(line.unit_price ?? 0);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;

    const list = grouped.get(line.material_id) ?? [];
    list.push(unitPrice);
    grouped.set(line.material_id, list);
  }

  const summary = new Map<string, MaterialBaselinePriceSummary>();

  for (const [materialId, prices] of grouped.entries()) {
    const sorted = [...prices].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const baseline = median(sorted);
    const spreadPct = baseline > 0 ? ((max - min) / baseline) * 100 : 0;

    summary.set(materialId, {
      material_id: materialId,
      baseline_unit_price: baseline,
      min_unit_price: min,
      max_unit_price: max,
      sample_count: sorted.length,
      spread_pct: Number(spreadPct.toFixed(1)),
    });
  }

  return summary;
}

// ── Check 2a: Baseline Deviation ──────────────────────────────────────
// Compares PO line unit price against baseline AHS planned unit cost.
export function checkBaselineDeviation(
  line: PurchaseOrderLine,
  baselineLine: ProjectMaterialMasterLine | null,
  baselinePrice: MaterialBaselinePriceSummary | null,
): GateResult {
  if (!line.unit_price || line.unit_price <= 0) {
    return { flag: 'WARNING', check: '2a', msg: `Harga satuan belum diisi untuk "${line.material_name}".` };
  }

  if (!baselinePrice || baselinePrice.baseline_unit_price <= 0) {
    return baselineLine
      ? { flag: 'INFO', check: '2a', msg: `Material "${line.material_name}" ada di baseline kuantitas, tetapi harga AHS baseline belum tersedia — review manual.` }
      : { flag: 'INFO', check: '2a', msg: `Tidak ada harga baseline estimator untuk "${line.material_name}" — review manual.` };
  }

  const baselineUnitPrice = baselinePrice.baseline_unit_price;
  const devPct = ((line.unit_price - baselineUnitPrice) / baselineUnitPrice) * 100;
  const hasRange = baselinePrice.sample_count > 1 && baselinePrice.max_unit_price > baselinePrice.min_unit_price;
  const withinRange = hasRange
    && line.unit_price >= baselinePrice.min_unit_price
    && line.unit_price <= baselinePrice.max_unit_price;
  const wideSpread = hasRange && baselinePrice.spread_pct >= 10;
  const rangeSuffix = hasRange
    ? ` Rentang AHS: Rp${fmt(baselinePrice.min_unit_price)}-${fmt(baselinePrice.max_unit_price)} (${baselinePrice.sample_count} referensi).`
    : '';

  if (withinRange) {
    return {
      flag: wideSpread ? 'INFO' : 'OK',
      check: '2a',
      msg: `Harga ${line.material_name} masih dalam rentang baseline AHS${wideSpread ? ' — cek kecocokan spec' : ''} (median Rp${fmt(baselineUnitPrice)}).${rangeSuffix}`,
    };
  }

  if (devPct > 30) {
    return { flag: 'CRITICAL', check: '2a', msg: `Harga ${line.material_name} Rp${fmt(line.unit_price)} melebihi baseline AHS Rp${fmt(baselineUnitPrice)} (+${devPct.toFixed(0)}%). Auto-hold.${rangeSuffix}` };
  }
  if (devPct > 15) {
    return { flag: 'HIGH', check: '2a', msg: `Harga ${line.material_name} Rp${fmt(line.unit_price)} di atas baseline AHS Rp${fmt(baselineUnitPrice)} (+${devPct.toFixed(0)}%). Eskalasi ke Principal.${rangeSuffix}` };
  }
  if (devPct > 5) {
    return { flag: 'WARNING', check: '2a', msg: `Harga ${line.material_name} ${devPct.toFixed(0)}% di atas baseline AHS. Estimator harus justifikasi.${rangeSuffix}` };
  }
  if (devPct < -15) {
    return { flag: 'INFO', check: '2a', msg: `Harga ${line.material_name} ${Math.abs(devPct).toFixed(0)}% di bawah baseline AHS — verifikasi kualitas/spec.${rangeSuffix}` };
  }
  return { flag: 'OK', check: '2a', msg: `Harga ${line.material_name} dalam batas baseline AHS (${devPct >= 0 ? '+' : ''}${devPct.toFixed(1)}%).${rangeSuffix}` };
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

  const vendorKey = normalizeVendor(vendor);
  const relevant = history
    .filter(h => normalizeVendor(h.vendor) === vendorKey && Number(h.unit_price ?? 0) > 0)
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
  baselinePrice: MaterialBaselinePriceSummary | null;
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
  const baseline = checkBaselineDeviation(input.line, input.baselineLine, input.baselinePrice);
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[mid];
  return (values[mid - 1] + values[mid]) / 2;
}

function normalizeVendor(value: string): string {
  return value.trim().toLowerCase();
}
