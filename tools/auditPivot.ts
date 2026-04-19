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
import type {
  CostBasis,
  RefCells,
  CostSplit,
} from './boqParserV2/types';

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
  // v2-only — populated when the workbook stores a per-unit cost split
  // directly on the BoQ row (e.g. AAL-5 Material/Upah/Peralatan columns).
  // Null for v1 rows or when no such columns exist.
  costBasis: CostBasis | null;
  costSplit: CostSplit | null;
  subkonCostPerUnit: number | null;
  totalCost: number | null;
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
  // v2-only — present on rows parsed by boqParserV2, null for v1 rows
  costBasis: CostBasis | null;
  parentAhsStagingId: string | null;
  refCells: RefCells | null;
  costSplit: CostSplit | null;
  parserVersion: 'v1' | 'v2';
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
      const ext = r as unknown as {
        cost_basis: CostBasis | null;
        cost_split: CostSplit | null;
      };
      const subkon = p.subkon_cost_per_unit;
      const total = p.total_cost;
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
        costBasis: ext.cost_basis ?? null,
        costSplit: ext.cost_split ?? null,
        subkonCostPerUnit: subkon != null ? num(subkon) : null,
        totalCost: total != null ? num(total) : null,
      };
    });
}

export function extractAhsRows(rows: ImportStagingRow[]): AuditAhsRow[] {
  // Build lookups from ahs_block rows for v2:
  //   block staging_id → linked_boq_code
  //   block title → linked_boq_code (fallback when parent_ahs_staging_id is missing)
  //   block title → { titleRow, jumlahRow }
  const blockBoqCode = new Map<string, string>();
  const blockBoqCodeByTitle = new Map<string, string>();
  const blockMeta = new Map<string, { titleRow: number; jumlahRow: number }>();
  for (const r of rows) {
    if (r.row_type !== 'ahs_block') continue;
    const p = (r.parsed_data ?? {}) as Record<string, unknown>;
    const raw = (r.raw_data ?? {}) as Record<string, unknown>;
    const title = str(p.title);
    if (p.linked_boq_code) {
      blockBoqCode.set(r.id, str(p.linked_boq_code));
      if (title) blockBoqCodeByTitle.set(title, str(p.linked_boq_code));
    }
    if (title) {
      blockMeta.set(title, {
        titleRow: num(raw.titleRow),
        jumlahRow: num(raw.jumlahRow),
      });
    }
  }

  return rows
    .filter(r => r.row_type === 'ahs' && r.review_status !== 'REJECTED')
    .map(r => {
      const p = (r.parsed_data ?? {}) as Record<string, unknown>;
      const raw = (r.raw_data ?? {}) as Record<string, unknown>;
      const ext = r as unknown as {
        cost_basis: CostBasis | null;
        parent_ahs_staging_id: string | null;
        ref_cells: RefCells | null;
        cost_split: CostSplit | null;
      };
      const lineType = (str(raw.lineType, 'material') as AhsLineTypeStr);

      // v2 stores blockTitle in raw.blockTitle; v1 in raw.ahsBlockTitle
      const blockTitle = strOrNull(raw.ahsBlockTitle) ?? strOrNull(raw.blockTitle);

      // v2 stores unit_price in parsed_data; v1 in raw.unitPrice
      const unitPrice = num(raw.unitPrice) || num(p.unit_price);

      // v2 stores coefficient in parsed_data; v1 in raw.coefficient / p.usage_rate
      const coefficient = num(raw.coefficient) || num(p.coefficient) || num(p.usage_rate);

      // Resolve boqCode: v1 embeds in parsed_data.boq_code; v2 links
      // through parent ahs_block (by id or by title match)
      let boqCode = str(p.boq_code);
      if (!boqCode && ext.parent_ahs_staging_id) {
        boqCode = blockBoqCode.get(ext.parent_ahs_staging_id) ?? '';
      }
      if (!boqCode && blockTitle) {
        boqCode = blockBoqCodeByTitle.get(blockTitle) ?? '';
      }

      // v2 stores titleRow/jumlahRow on the ahs_block, not on individual rows
      const meta = blockTitle ? blockMeta.get(blockTitle) : null;
      const titleRow = raw.ahsTitleRow != null ? num(raw.ahsTitleRow) : (meta?.titleRow ?? null);
      const jumlahRow = raw.ahsJumlahRow != null ? num(raw.ahsJumlahRow) : (meta?.jumlahRow ?? null);

      return {
        stagingId: r.id,
        rowNumber: r.row_number,
        boqCode,
        blockTitle,
        titleRow,
        jumlahRow,
        lineType,
        materialCode: strOrNull(p.material_code),
        materialName: str(p.material_name),
        materialSpec: strOrNull(p.material_spec),
        tier: (num(p.tier, 2) as 1 | 2 | 3),
        coefficient,
        unit: str(p.unit),
        unitPrice,
        wasteFactor: num(p.waste_factor, num(raw.wasteFactor)),
        sourceRow: raw.sourceRow != null ? num(raw.sourceRow) : null,
        linkMethod: strOrNull(raw.linkMethod),
        reviewStatus: r.review_status,
        needsReview: r.needs_review,
        confidence: r.confidence,
        costBasis: ext.cost_basis ?? null,
        parentAhsStagingId: ext.parent_ahs_staging_id ?? null,
        refCells: ext.ref_cells ?? null,
        costSplit: ext.cost_split ?? null,
        parserVersion: ((r as unknown as { parser_version?: string }).parser_version ?? 'v1') as 'v1' | 'v2',
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
  prelim: { perUnit: number; total: number };
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
      prelim: { perUnit: 0, total: 0 },
    };

    for (const line of lines) {
      totals[line.ahs.lineType].perUnit += line.perUnitCost;
      totals[line.ahs.lineType].total += line.totalCost;
    }

    // Fallback: when the parser could not link any AHS components to this
    // BoQ row (common for AAL-5-style workbooks that chain through REKAP
    // sheets before hitting Analisa), use the cached per-unit split the
    // workbook already resolved on the BoQ row itself. Without this the
    // audit screen renders Rp 0 across all four buckets.
    if (lines.length === 0 && boq.costSplit) {
      totals.material.perUnit = boq.costSplit.material;
      totals.material.total = boq.costSplit.material * boq.planned;
      totals.labor.perUnit = boq.costSplit.labor;
      totals.labor.total = boq.costSplit.labor * boq.planned;
      totals.equipment.perUnit = boq.costSplit.equipment;
      totals.equipment.total = boq.costSplit.equipment * boq.planned;
      totals.prelim.perUnit = boq.costSplit.prelim;
      totals.prelim.total = boq.costSplit.prelim * boq.planned;
      if (boq.subkonCostPerUnit && boq.subkonCostPerUnit > 0) {
        totals.subkon.perUnit = boq.subkonCostPerUnit;
        totals.subkon.total = boq.subkonCostPerUnit * boq.planned;
      }
    }

    const perUnitTotal =
      totals.material.perUnit + totals.labor.perUnit + totals.equipment.perUnit + totals.subkon.perUnit + totals.prelim.perUnit;
    const grandTotal =
      totals.material.total + totals.labor.total + totals.equipment.total + totals.subkon.total + totals.prelim.total;

    return {
      boq,
      lines,
      material: totals.material,
      labor: totals.labor,
      equipment: totals.equipment,
      subkon: totals.subkon,
      prelim: totals.prelim,
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
  validationStatus: 'ok' | 'imbalanced' | 'has_nested' | null;
  validationDelta: number;
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
        validationStatus: null,
        validationDelta: 0,
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

  for (const bucket of buckets.values()) {
    const hasNested = bucket.components.some(c => c.ahs.costBasis === 'nested_ahs');
    // jumlahCachedValue is not available on AuditAhsRow, so we can't compute
    // expected/delta here. Validation badges rely on import_sessions.validation_report
    // fetched directly in the UI (see AuditTraceScreen). When a block has nested
    // components we still surface that here; otherwise status stays null.
    bucket.validationStatus = hasNested ? 'has_nested' : null;
    bucket.validationDelta = 0;
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
