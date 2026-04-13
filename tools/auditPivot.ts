// Audit Trace — pure pivot helpers over import_staging_rows.
//
// Used by AuditTraceScreen during REVIEW to give estimators an editable,
// material-first / BoQ-first / AHS-first view of what the parser read
// before baseline publish. All functions are pure — they derive views
// from the raw ImportStagingRow[] and compute totals/subtotals in-memory.
//
// Price math convention (matches publishBaseline + derivation.ts):
//   per-unit cost  = coefficient × unit_price × (1 + waste_factor)
//   per-BoQ total  = per-unit × planned_qty
//   per-material   = Σ (per-BoQ total) across every AHS line that uses it

import type { ImportStagingRow } from './types';

export type AhsLineTypeStr = 'material' | 'labor' | 'equipment' | 'subkon';

export interface AuditBoqRow {
  stagingId: string;
  rowNumber: number;
  code: string;
  label: string;
  unit: string;
  planned: number;
  chapter: string | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  reviewStatus: string;
  needsReview: boolean;
  confidence: number;
}

export interface AuditAhsRow {
  stagingId: string;
  rowNumber: number;
  boqCode: string;
  blockTitle: string | null;
  titleRow: number | null;
  jumlahRow: number | null;
  lineType: AhsLineTypeStr;
  materialCode: string | null;
  materialName: string;
  materialSpec: string | null;
  tier: 1 | 2 | 3;
  coefficient: number;
  unit: string;
  unitPrice: number;
  wasteFactor: number;
  sourceRow: number | null;
  linkMethod: string | null;
  reviewStatus: string;
  needsReview: boolean;
  confidence: number;
}

export interface AuditMaterialRow {
  stagingId: string;
  rowNumber: number;
  code: string;
  name: string;
  category: string;
  tier: 1 | 2 | 3;
  unit: string;
  refUnitPrice: number;
  sourceRow: number | null;
  reviewStatus: string;
  needsReview: boolean;
  confidence: number;
}

// ─── Extractors ───────────────────────────────────────────────────────

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function str(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  return String(value);
}

function strOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.length > 0 ? s : null;
}

export function extractBoqRows(rows: ImportStagingRow[]): AuditBoqRow[] {
  return rows
    .filter(r => r.row_type === 'boq' && r.review_status !== 'REJECTED')
    .map(r => {
      const p = (r.parsed_data ?? {}) as Record<string, unknown>;
      const raw = (r.raw_data ?? {}) as Record<string, unknown>;
      return {
        stagingId: r.id,
        rowNumber: r.row_number,
        code: str(p.code),
        label: str(p.label),
        unit: str(p.unit),
        planned: num(p.planned),
        chapter: strOrNull(raw.chapter),
        sourceSheet: strOrNull(raw.sourceSheet),
        sourceRow: raw.sourceRow != null ? num(raw.sourceRow) : null,
        reviewStatus: r.review_status,
        needsReview: r.needs_review,
        confidence: r.confidence,
      };
    });
}

export function extractAhsRows(rows: ImportStagingRow[]): AuditAhsRow[] {
  return rows
    .filter(r => r.row_type === 'ahs' && r.review_status !== 'REJECTED')
    .map(r => {
      const p = (r.parsed_data ?? {}) as Record<string, unknown>;
      const raw = (r.raw_data ?? {}) as Record<string, unknown>;
      const lineType = (str(raw.lineType, 'material') as AhsLineTypeStr);
      return {
        stagingId: r.id,
        rowNumber: r.row_number,
        boqCode: str(p.boq_code),
        blockTitle: strOrNull(raw.ahsBlockTitle),
        titleRow: raw.ahsTitleRow != null ? num(raw.ahsTitleRow) : null,
        jumlahRow: raw.ahsJumlahRow != null ? num(raw.ahsJumlahRow) : null,
        lineType,
        materialCode: strOrNull(p.material_code),
        materialName: str(p.material_name),
        materialSpec: strOrNull(p.material_spec),
        tier: (num(p.tier, 2) as 1 | 2 | 3),
        coefficient: num(raw.coefficient, num(p.usage_rate)),
        unit: str(p.unit),
        unitPrice: num(raw.unitPrice),
        wasteFactor: num(p.waste_factor, num(raw.wasteFactor)),
        sourceRow: raw.sourceRow != null ? num(raw.sourceRow) : null,
        linkMethod: strOrNull(raw.linkMethod),
        reviewStatus: r.review_status,
        needsReview: r.needs_review,
        confidence: r.confidence,
      };
    });
}

export function extractMaterialRows(rows: ImportStagingRow[]): AuditMaterialRow[] {
  return rows
    .filter(r => r.row_type === 'material' && r.review_status !== 'REJECTED')
    .map(r => {
      const p = (r.parsed_data ?? {}) as Record<string, unknown>;
      const raw = (r.raw_data ?? {}) as Record<string, unknown>;
      return {
        stagingId: r.id,
        rowNumber: r.row_number,
        code: str(p.code),
        name: str(p.name),
        category: str(p.category),
        tier: (num(p.tier, 2) as 1 | 2 | 3),
        unit: str(p.unit),
        refUnitPrice: num(p.reference_unit_price),
        sourceRow: raw.excelRowNumber != null ? num(raw.excelRowNumber) : null,
        reviewStatus: r.review_status,
        needsReview: r.needs_review,
        confidence: r.confidence,
      };
    });
}

// ─── Pivot views ──────────────────────────────────────────────────────

function normalize(key: string): string {
  return key.trim().toLowerCase();
}

// Per-unit cost for one AHS component line (before multiplying by BoQ qty).
export function perUnitCost(ahs: Pick<AuditAhsRow, 'coefficient' | 'unitPrice' | 'wasteFactor'>): number {
  return ahs.coefficient * ahs.unitPrice * (1 + ahs.wasteFactor);
}

export function perUnitQuantity(ahs: Pick<AuditAhsRow, 'coefficient' | 'wasteFactor'>): number {
  return ahs.coefficient * (1 + ahs.wasteFactor);
}

// ─── Pivot 1: By Material ─────────────────────────────────────────────

export interface MaterialUsageLine {
  ahs: AuditAhsRow;
  boq: AuditBoqRow | null;
  perUnitQty: number;     // coef × (1+waste)   per 1 unit of BoQ
  totalQty: number;       // perUnitQty × boq.planned
  perUnitCost: number;    // coef × price × (1+waste)   per 1 unit of BoQ
  totalCost: number;      // perUnitCost × boq.planned
}

export interface MaterialUsage {
  material: AuditMaterialRow | null;  // null = material referenced in AHS but no catalog row
  materialKey: string;                  // resolved by code or by name
  displayName: string;
  displayUnit: string;
  displayRefPrice: number;
  lines: MaterialUsageLine[];
  grandQty: number;
  grandCost: number;
  hasOrphan: boolean;                   // true if any line has no matching BoQ
}

export function pivotByMaterial(
  boqRows: AuditBoqRow[],
  ahsRows: AuditAhsRow[],
  materialRows: AuditMaterialRow[],
): MaterialUsage[] {
  const boqByCode = new Map(boqRows.map(b => [normalize(b.code), b]));
  const materialByCode = new Map<string, AuditMaterialRow>();
  const materialByName = new Map<string, AuditMaterialRow>();
  for (const m of materialRows) {
    if (m.code) materialByCode.set(normalize(m.code), m);
    if (m.name) materialByName.set(normalize(m.name), m);
  }

  const buckets = new Map<string, MaterialUsage>();

  // Only 'material' line types feed the material pivot; labor/equipment/subkon
  // are shown under their own lens inside the BoQ and AHS tabs.
  for (const ahs of ahsRows) {
    if (ahs.lineType !== 'material') continue;

    const resolved =
      (ahs.materialCode ? materialByCode.get(normalize(ahs.materialCode)) : null)
      ?? materialByName.get(normalize(ahs.materialName))
      ?? null;

    const key = resolved
      ? `mat:${resolved.stagingId}`
      : `name:${normalize(ahs.materialName)}`;

    const boq = ahs.boqCode ? boqByCode.get(normalize(ahs.boqCode)) ?? null : null;
    const planned = boq?.planned ?? 0;
    const pUnitQty = perUnitQuantity(ahs);
    const pUnitCost = perUnitCost(ahs);

    const line: MaterialUsageLine = {
      ahs,
      boq,
      perUnitQty: pUnitQty,
      totalQty: pUnitQty * planned,
      perUnitCost: pUnitCost,
      totalCost: pUnitCost * planned,
    };

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        material: resolved,
        materialKey: key,
        displayName: resolved?.name ?? ahs.materialName,
        displayUnit: resolved?.unit ?? ahs.unit,
        displayRefPrice: resolved?.refUnitPrice ?? ahs.unitPrice,
        lines: [],
        grandQty: 0,
        grandCost: 0,
        hasOrphan: false,
      };
      buckets.set(key, bucket);
    }
    bucket.lines.push(line);
    bucket.grandQty += line.totalQty;
    bucket.grandCost += line.totalCost;
    if (!boq) bucket.hasOrphan = true;
  }

  return Array.from(buckets.values()).sort((a, b) => b.grandCost - a.grandCost);
}

// ─── Pivot 2: By BoQ Item ─────────────────────────────────────────────

export interface BoqLineView {
  ahs: AuditAhsRow;
  perUnitCost: number;
  totalCost: number;
}

export interface BoqBreakdown {
  boq: AuditBoqRow;
  lines: BoqLineView[];
  material: { perUnit: number; total: number };
  labor: { perUnit: number; total: number };
  equipment: { perUnit: number; total: number };
  subkon: { perUnit: number; total: number };
  perUnitTotal: number;
  grandTotal: number;
}

export function pivotByBoq(
  boqRows: AuditBoqRow[],
  ahsRows: AuditAhsRow[],
): BoqBreakdown[] {
  const ahsByCode = new Map<string, AuditAhsRow[]>();
  for (const ahs of ahsRows) {
    const key = normalize(ahs.boqCode);
    const bucket = ahsByCode.get(key) ?? [];
    bucket.push(ahs);
    ahsByCode.set(key, bucket);
  }

  return boqRows.map(boq => {
    const lines = (ahsByCode.get(normalize(boq.code)) ?? []).map(ahs => {
      const pUnit = perUnitCost(ahs);
      return {
        ahs,
        perUnitCost: pUnit,
        totalCost: pUnit * boq.planned,
      };
    });

    const totals = {
      material: { perUnit: 0, total: 0 },
      labor: { perUnit: 0, total: 0 },
      equipment: { perUnit: 0, total: 0 },
      subkon: { perUnit: 0, total: 0 },
    };

    for (const line of lines) {
      totals[line.ahs.lineType].perUnit += line.perUnitCost;
      totals[line.ahs.lineType].total += line.totalCost;
    }

    const perUnitTotal =
      totals.material.perUnit + totals.labor.perUnit + totals.equipment.perUnit + totals.subkon.perUnit;
    const grandTotal =
      totals.material.total + totals.labor.total + totals.equipment.total + totals.subkon.total;

    return {
      boq,
      lines,
      material: totals.material,
      labor: totals.labor,
      equipment: totals.equipment,
      subkon: totals.subkon,
      perUnitTotal,
      grandTotal,
    };
  });
}

// ─── Pivot 3: By AHS Block ────────────────────────────────────────────

export interface AhsBlockLineView {
  ahs: AuditAhsRow;
  perUnitCost: number;
}

export interface AhsBlockView {
  blockKey: string;
  title: string;
  titleRow: number | null;
  linkedBoqCodes: string[];
  components: AhsBlockLineView[];
  totals: {
    material: number;
    labor: number;
    equipment: number;
    subkon: number;
    grand: number;
  };
}

export function pivotByAhsBlock(ahsRows: AuditAhsRow[]): AhsBlockView[] {
  const buckets = new Map<string, AhsBlockView>();

  for (const ahs of ahsRows) {
    const title = ahs.blockTitle ?? '(tanpa judul)';
    const key = `${title}|${ahs.titleRow ?? 'x'}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        blockKey: key,
        title,
        titleRow: ahs.titleRow,
        linkedBoqCodes: [],
        components: [],
        totals: { material: 0, labor: 0, equipment: 0, subkon: 0, grand: 0 },
      };
      buckets.set(key, bucket);
    }

    if (ahs.boqCode && !bucket.linkedBoqCodes.includes(ahs.boqCode)) {
      bucket.linkedBoqCodes.push(ahs.boqCode);
    }

    const pUnit = perUnitCost(ahs);
    // Deduplicate components that appear once per linked BoQ code — within
    // one block, the same component row shows up multiple times in staging
    // if the block links to multiple BoQ items. For the block view we want
    // to see each component once.
    const alreadyListed = bucket.components.some(
      c =>
        c.ahs.sourceRow === ahs.sourceRow
        && c.ahs.materialName === ahs.materialName
        && c.ahs.lineType === ahs.lineType,
    );
    if (!alreadyListed) {
      bucket.components.push({ ahs, perUnitCost: pUnit });
      bucket.totals[ahs.lineType] += pUnit;
      bucket.totals.grand += pUnit;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => b.totals.grand - a.totals.grand);
}

// ─── Formatting helpers ──────────────────────────────────────────────

export function formatRupiah(value: number): string {
  if (!Number.isFinite(value)) return 'Rp 0';
  const rounded = Math.round(value);
  return `Rp ${rounded.toLocaleString('id-ID')}`;
}

export function formatQuantity(value: number, maxFraction = 3): string {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFraction,
  });
}
