/**
 * Deterministic normalizer — no LLM calls.
 *
 * Identifies the right Analisa block for each BoQ row by MATCHING the row's
 * pre-computed cost columns (W = bekisting cost/m², R/S/T = concrete
 * material/labor/equipment cost/m³) against the per-block "Harga per ..." /
 * Jumlah totals. This avoids any "which Pengecoran block applies?" guesswork
 * because the workbook itself already encodes the answer via cell references.
 *
 * Truth-correctness gate: rows that don't reconcile within ±1 Rp are listed
 * in the Unresolved sheet, not written as Breakdown sheets.
 *
 * Usage:
 *   npm run normalize:boq:det -- <input.xlsx> [output.xlsx]
 *
 * Cost: zero. Pure local math.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { parseBoqV2 } from '../boqParserV2';
import type { BoqRowV2 } from '../boqParserV2/extractTakeoffs';
import type { HarvestedCell } from '../boqParserV2/types';
import type { AhsBlock } from '../boqParserV2/detectBlocks';
import type { RowBreakdown, BreakdownRow } from '../boqParserV2/breakdownSheetReader.types';
import { needsExpansion } from './needsExpansion';
import { writeBreakdownSheets } from './writeWorkbook';

const TOLERANCE_RP = 1;

// --- helpers ---

function buildLookup(cells: HarvestedCell[]): Map<string, HarvestedCell> {
  const m = new Map<string, HarvestedCell>();
  for (const c of cells) m.set(`${c.sheet}!${c.address}`, c);
  return m;
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function getCellNum(lookup: Map<string, HarvestedCell>, sheet: string, addr: string): number {
  return num(lookup.get(`${sheet}!${addr}`)?.value);
}

function getCellStr(lookup: Map<string, HarvestedCell>, sheet: string, addr: string): string {
  const v = lookup.get(`${sheet}!${addr}`)?.value;
  return v == null ? '' : String(v).trim();
}

// --- block model ---

interface BekistingTemplate {
  blockTitle: string;
  hargaPerM2: number;          // per-m² cost — matches RAB!W{row}
  cycleFactor: number;          // Jumlah / Harga per m²
  subItems: Array<{
    materialName: string;
    qtyPerNative: number;        // per m² per cycle
    nativeUnit: string;
    unitPrice: number;
    includedInTotal: boolean;
  }>;
}

interface ConcreteTemplate {
  blockTitle: string;
  materialCostPerM3: number;    // matches RAB!R
  laborCostPerM3: number;        // matches RAB!S
  equipCostPerM3: number;        // matches RAB!T
  subItems: Array<{
    materialName: string;
    group: 'material' | 'labor' | 'equipment';
    qtyPerNative: number;
    nativeUnit: string;
    unitPrice: number;
    specNote: string | null;
  }>;
}

interface PembesianTemplate {
  blockTitle: string;
  pricePerKg: number;           // matches RAB!AA
  besiCoeff: number;             // typically 1.05
  besiUnitPrice: number;         // typically 9000
  deckingCoeff: number;          // typically 1.0
  deckingUnitPrice: number;
  bendratCoeff: number;          // typically 0.021
  bendratUnitPrice: number;
}

function extractBekistingTemplates(
  ahsBlocks: AhsBlock[],
  lookup: Map<string, HarvestedCell>,
): BekistingTemplate[] {
  const out: BekistingTemplate[] = [];
  for (const block of ahsBlocks) {
    if (!/Bekisting/i.test(block.title)) continue;
    // Cyclic blocks (Balok/Plat/Kolom/Dinding) put Jumlah in F; Bata/Batako
    // Poer/Sloof blocks put the grand total in col I (col F is blank).
    // Pick whichever is populated.
    const jumlahF = getCellNum(lookup, 'Analisa', `F${block.jumlahRow}`);
    const jumlahI = getCellNum(lookup, 'Analisa', `I${block.jumlahRow}`);
    const jumlah = jumlahF > 0 ? jumlahF : jumlahI;
    // Harga per m² is the cell in F column one row past Jumlah. For
    // single-cycle bekisting (Bata/Batako) the row is absent — treat as
    // cycle=1 and use Jumlah itself as Harga per m².
    const hargaRow = block.jumlahRow + 1;
    const hargaFromRow = getCellNum(lookup, 'Analisa', `F${hargaRow}`);
    const harga = hargaFromRow > 0 ? hargaFromRow : jumlah;
    if (harga === 0) continue;
    // Use the LITERAL float ratio, not Math.round. AAL-5 Kolom is 9.1185,
    // AAL-5 Plat is 5.76, PD3 Kolom is 4.56. Rounding to integer breaks the
    // V × W = Σ(subitem_cost_per_m³) invariant by 1-2% and cascades into
    // wrong per-material qty for every itemized row.
    const cycleFactor = harga > 0 ? jumlah / harga : 1;
    const subItems = block.componentRows.map((r) => {
      const qty = getCellNum(lookup, 'Analisa', `B${r}`);
      const unit = getCellStr(lookup, 'Analisa', `C${r}`);
      const name = getCellStr(lookup, 'Analisa', `D${r}`);
      const price = getCellNum(lookup, 'Analisa', `E${r}`);
      const fTotal = getCellNum(lookup, 'Analisa', `F${r}`);
      // included if F-column total is populated (matches what the workbook
      // included in Jumlah — Perancah etc. show 0 in F by design).
      return {
        materialName: name,
        qtyPerNative: qty,
        nativeUnit: unit,
        unitPrice: price,
        includedInTotal: fTotal > 0,
      };
    });
    out.push({ blockTitle: block.title, hargaPerM2: harga, cycleFactor, subItems });
  }
  return out;
}

function extractConcreteTemplates(
  ahsBlocks: AhsBlock[],
  lookup: Map<string, HarvestedCell>,
): ConcreteTemplate[] {
  const out: ConcreteTemplate[] = [];
  for (const block of ahsBlocks) {
    if (!/Pengecoran Beton/i.test(block.title)) continue;
    // Sum the column F/G/H totals on the Jumlah row to get the per-m³ breakdown.
    const matCost = getCellNum(lookup, 'Analisa', `F${block.jumlahRow}`);
    const laborCost = getCellNum(lookup, 'Analisa', `G${block.jumlahRow}`);
    const equipCost = getCellNum(lookup, 'Analisa', `H${block.jumlahRow}`);
    if (matCost === 0) continue;
    const subItems: ConcreteTemplate['subItems'] = [];
    for (const r of block.componentRows) {
      const qty = getCellNum(lookup, 'Analisa', `B${r}`);
      const unit = getCellStr(lookup, 'Analisa', `C${r}`);
      const name = getCellStr(lookup, 'Analisa', `D${r}`);
      const price = getCellNum(lookup, 'Analisa', `E${r}`);
      // Group by which cost column carries the total: F=material, G=labor, H=equipment.
      const f = getCellNum(lookup, 'Analisa', `F${r}`);
      const g = getCellNum(lookup, 'Analisa', `G${r}`);
      const h = getCellNum(lookup, 'Analisa', `H${r}`);
      const group: 'material' | 'labor' | 'equipment' =
        g > 0 ? 'labor' : h > 0 ? 'equipment' : f >= 0 && /upah|borongan/i.test(name) ? 'labor' :
        /peralatan|sewa|vibrator|pump/i.test(name) ? 'equipment' : 'material';
      subItems.push({
        materialName: name,
        group,
        qtyPerNative: qty,
        nativeUnit: unit,
        unitPrice: price,
        specNote: null,
      });
    }
    out.push({
      blockTitle: block.title,
      materialCostPerM3: matCost,
      laborCostPerM3: laborCost,
      equipCostPerM3: equipCost,
      subItems,
    });
  }
  return out;
}

function extractPembesianTemplate(
  ahsBlocks: AhsBlock[],
  lookup: Map<string, HarvestedCell>,
): PembesianTemplate | null {
  const block = ahsBlocks.find((b) => /^Pembesian/i.test(b.title));
  if (!block) return null;
  // Sub-rows: row[0] = Besi beton, row[1] = decking, row[2] = bendrat.
  const findSub = (regex: RegExp) =>
    block.componentRows
      .map((r) => ({
        row: r,
        name: getCellStr(lookup, 'Analisa', `D${r}`),
        coeff: getCellNum(lookup, 'Analisa', `B${r}`),
        price: getCellNum(lookup, 'Analisa', `E${r}`),
      }))
      .find((x) => regex.test(x.name));
  const besi = findSub(/^Besi beton/i);
  const decking = findSub(/decking/i);
  const bendrat = findSub(/bendrat/i);
  if (!besi) return null;
  const pricePerKg = getCellNum(lookup, 'Analisa', `F${block.jumlahRow}`);
  return {
    blockTitle: block.title,
    pricePerKg,
    besiCoeff: besi.coeff,
    besiUnitPrice: besi.price,
    deckingCoeff: decking?.coeff ?? 0,
    deckingUnitPrice: decking?.price ?? 0,
    bendratCoeff: bendrat?.coeff ?? 0,
    bendratUnitPrice: bendrat?.price ?? 0,
  };
}

// --- per-row breakdown construction ---

interface RowCols {
  bekistingRatioM2PerM3: number;       // V column
  bekistingHargaPerM2: number;          // W column
  bekistingPeralatanPerM2: number;      // X column — Perancah / Bekisting Peralatan (some workbooks embed scaffolding here instead of as a separate BoQ line)
  concreteMatCostPerM3: number;         // R
  concreteLaborCostPerM3: number;       // S
  concreteEquipCostPerM3: number;       // T
  pembesianKgPerM3: number;             // Z
  pembesianBlendedPricePerKg: number;   // AA — blended price/kg used by the workbook
  wireMeshRatioPerM3: number;           // AC — kg of wire mesh per m³ beton (plat reinforcement, some workbooks)
  wireMeshPricePerKg: number;           // AD
  subkonPerM3: number;                  // L — direct subcontractor cost (some workbooks)
  prelimPerM3: number;                  // M — direct preliminary cost (some workbooks)
}

function readRowCols(lookup: Map<string, HarvestedCell>, sheet: string, row: number): RowCols {
  return {
    bekistingRatioM2PerM3: getCellNum(lookup, sheet, `V${row}`),
    bekistingHargaPerM2: getCellNum(lookup, sheet, `W${row}`),
    bekistingPeralatanPerM2: getCellNum(lookup, sheet, `X${row}`),
    concreteMatCostPerM3: getCellNum(lookup, sheet, `R${row}`),
    concreteLaborCostPerM3: getCellNum(lookup, sheet, `S${row}`),
    concreteEquipCostPerM3: getCellNum(lookup, sheet, `T${row}`),
    pembesianKgPerM3: getCellNum(lookup, sheet, `Z${row}`),
    pembesianBlendedPricePerKg: getCellNum(lookup, sheet, `AA${row}`),
    wireMeshRatioPerM3: getCellNum(lookup, sheet, `AC${row}`),
    wireMeshPricePerKg: getCellNum(lookup, sheet, `AD${row}`),
    subkonPerM3: getCellNum(lookup, sheet, `L${row}`),
    prelimPerM3: getCellNum(lookup, sheet, `M${row}`),
  };
}

interface DiameterWeight {
  diameter: string;
  qtyPerM3: number;
}

function readDiametersForRow(row: BoqRowV2): DiameterWeight[] {
  if (!row.recipe) return [];
  return row.recipe.components
    .filter((c) => c.materialName && /^Besi /i.test(c.materialName))
    .map((c) => ({
      diameter: c.materialName!.replace(/^Besi\s+/i, ''),
      qtyPerM3: c.quantityPerUnit,
    }));
}

interface BuildResult {
  breakdown?: RowBreakdown;
  reason?: string;
  computedUnitCost?: number;
  variance?: number;
  /** 'itemized' = per-material/sub-item; 'rolled' = 5 lump components from RAB column totals. */
  level?: 'itemized' | 'rolled';
}

/**
 * Level-1 fallback: when itemized expansion fails to reconcile (or no
 * bekisting template matches, etc.), produce a 5-line rolled breakdown
 * directly from the workbook's pre-computed cost columns:
 *   R = concrete material cost/m³        → readymix lump
 *   S = concrete labor cost/m³           → upah lump
 *   T = concrete equipment cost/m³       → peralatan lump
 *   V*W = bekisting cost/m³              → bekisting lump
 *   Z*AA = pembesian cost/m³             → pembesian lump
 * Their sum equals RAB!N{row} by construction — the workbook's own
 * arithmetic. Reconciles to source within rounding for every structural
 * row whose RAB(A) columns are populated (159/164 on AAL-5).
 */
function buildRolledBreakdown(args: {
  row: BoqRowV2;
  cols: RowCols;
  sourceUnitCost: number;
  sourceLineTotal: number;
}): BuildResult {
  const { row, cols, sourceUnitCost, sourceLineTotal } = args;
  const v = row.planned;
  const components: BreakdownRow[] = [];

  const pushLump = (
    group: BreakdownRow['group'],
    componentGroup: string,
    materialName: string,
    qtyPerBoqUnit: number,
    nativeUnit: string,
    unitPrice: number,
    nativeBasis: string,
  ) => {
    if (qtyPerBoqUnit <= 0 || unitPrice <= 0) return;
    const costPerBoqUnit = qtyPerBoqUnit * unitPrice;
    components.push({
      group, componentGroup, materialName, specNote: 'rolled lump — group total only',
      qtyPerNativeUnit: qtyPerBoqUnit, nativeUnit, nativeBasis,
      unitPrice, qtyPerBoqUnit, costPerBoqUnit,
      totalQty: qtyPerBoqUnit * v, totalCost: costPerBoqUnit * v,
    });
  };

  // Concrete: material (R), labor (S), equipment (T). These are per-m³ totals,
  // so qty = 1.0 and unit_price = the column value.
  pushLump('material', 'BETON READYMIX (Material)', 'Beton readymix K-350 (lump)', 1.0, 'm3', cols.concreteMatCostPerM3, 'per m3 beton');
  pushLump('labor',    'UPAH (Labor) — borongan',   'Upah cor + besi + bekisting (lump)', 1.0, 'm3', cols.concreteLaborCostPerM3, 'per m3 beton');
  pushLump('equipment','PERALATAN (Equipment)',     'Sewa peralatan (lump)', 1.0, 'm3', cols.concreteEquipCostPerM3, 'per m3 beton');

  // Bekisting lump: qty = V (m²/m³ ratio), unit_price = W (cost/m²).
  if (cols.bekistingHargaPerM2 > 0 && cols.bekistingRatioM2PerM3 > 0) {
    pushLump('material',
      `BEKISTING (Material) — ratio ${cols.bekistingRatioM2PerM3} m²/m³ (rolled)`,
      'Bekisting (lump — no per-material detail)',
      cols.bekistingRatioM2PerM3, 'm2', cols.bekistingHargaPerM2,
      'per m² of formwork',
    );
  }

  // Bekisting peralatan / Perancah lump: qty = V (m²/m³), unit_price = X (cost/m²).
  // Workbooks that don't separate Perancah onto its own BoQ line (e.g., PD3, I4-29)
  // carry its cost here. AAL-5 leaves X = 0 because Perancah is on a separate line.
  if (cols.bekistingPeralatanPerM2 > 0 && cols.bekistingRatioM2PerM3 > 0) {
    pushLump('material',
      `BEKISTING PERALATAN (Material) — Perancah / scaffolding (rolled)`,
      'Bekisting peralatan / Perancah (lump)',
      cols.bekistingRatioM2PerM3, 'm2', cols.bekistingPeralatanPerM2,
      'per m² of formwork (scaffolding embedded in bekisting block, col H)',
    );
  }

  // Pembesian lump: qty = Z (kg/m³), unit_price = AA (blended).
  if (cols.pembesianKgPerM3 > 0 && cols.pembesianBlendedPricePerKg > 0) {
    pushLump('material',
      `PEMBESIAN (Material) — ratio ${cols.pembesianKgPerM3.toFixed(2)} kg/m³ (rolled)`,
      'Pembesian U24 & U40 (lump — no per-diameter detail)',
      cols.pembesianKgPerM3, 'kg', cols.pembesianBlendedPricePerKg,
      'per kg finished pembesian (blended: raw besi + decking + bendrat)',
    );
  }

  // Wire mesh lump: qty = AC (kg/m³), unit_price = AD. Used for plat reinforcement
  // in workbooks that decouple wire-mesh-per-plat from the main pembesian flow.
  if (cols.wireMeshRatioPerM3 > 0 && cols.wireMeshPricePerKg > 0) {
    pushLump('material',
      'WIRE MESH (Material) (rolled)',
      'Wire mesh (lump)',
      cols.wireMeshRatioPerM3, 'kg', cols.wireMeshPricePerKg,
      'per m³ beton (plat reinforcement separate from pembesian U24/U40)',
    );
  }

  // Subkon (L) and Prelim (M) — direct cost columns some contractors populate.
  // qty = 1.0 since the column already carries the per-m³ total.
  if (cols.subkonPerM3 > 0) {
    pushLump('material', 'SUBKON (Material) (rolled)',
      'Subkon (lump)',
      1.0, 'm3', cols.subkonPerM3,
      'per m³ beton (direct subcontractor cost)',
    );
  }
  if (cols.prelimPerM3 > 0) {
    pushLump('material', 'PRELIM (Material) (rolled)',
      'Prelim (lump)',
      1.0, 'm3', cols.prelimPerM3,
      'per m³ beton (direct preliminary cost)',
    );
  }

  if (components.length === 0) {
    return { reason: 'Rolled fallback: no concrete/bekisting/pembesian columns populated.' };
  }

  const computedUnitCost = components.reduce((s, c) => s + c.costPerBoqUnit, 0);
  const variance = computedUnitCost - sourceUnitCost;
  if (Math.abs(variance) > TOLERANCE_RP) {
    return {
      reason: `Rolled fallback variance ${variance.toFixed(2)} Rp (computed ${computedUnitCost.toFixed(2)} vs source ${sourceUnitCost.toFixed(2)}). Likely a missing column (e.g. Z*AA pembesian) or non-structural row.`,
      computedUnitCost, variance,
    };
  }

  const computedLineTotal = computedUnitCost * v;
  return {
    breakdown: {
      boqCode: row.code, description: row.label, unit: row.unit,
      volume: v, unitCost: computedUnitCost, lineTotal: computedLineTotal,
      components,
      reconciliation: {
        computedUnitCost, sourceUnitCost, unitCostVariance: variance,
        computedLineTotal, sourceLineTotal,
        lineTotalVariance: computedLineTotal - sourceLineTotal,
        reconciles: true,
      },
      sourceSheet: `Breakdown ${row.code}`,
    },
    computedUnitCost, variance, level: 'rolled',
  };
}

function buildBreakdownForRow(args: {
  row: BoqRowV2;
  cols: RowCols;
  diameters: DiameterWeight[];
  bekistings: BekistingTemplate[];
  concretes: ConcreteTemplate[];
  pembesian: PembesianTemplate;
  sourceUnitCost: number;
  sourceLineTotal: number;
}): BuildResult {
  const { row, cols, diameters, bekistings, concretes, pembesian, sourceUnitCost, sourceLineTotal } = args;
  const components: BreakdownRow[] = [];
  const componentCostMatchTol = 1; // Rp 1

  // 1. Concrete — match by R/S/T cost columns.
  let concrete: ConcreteTemplate | undefined;
  for (const c of concretes) {
    if (
      Math.abs(c.materialCostPerM3 - cols.concreteMatCostPerM3) <= componentCostMatchTol &&
      Math.abs(c.laborCostPerM3 - cols.concreteLaborCostPerM3) <= componentCostMatchTol &&
      Math.abs(c.equipCostPerM3 - cols.concreteEquipCostPerM3) <= componentCostMatchTol
    ) {
      concrete = c;
      break;
    }
  }
  if (concrete) {
    for (const s of concrete.subItems) {
      const qtyPerBoqUnit = s.qtyPerNative;
      const costPerBoqUnit = qtyPerBoqUnit * s.unitPrice;
      components.push({
        group: s.group,
        componentGroup:
          s.group === 'material' ? 'BETON READYMIX (Material)' :
          s.group === 'labor' ? 'UPAH (Labor) — borongan' :
          'PERALATAN (Equipment)',
        materialName: s.materialName,
        specNote: s.specNote,
        qtyPerNativeUnit: s.qtyPerNative,
        nativeUnit: s.nativeUnit,
        nativeBasis:
          s.group === 'material' ? 'per m3 beton (waste 5%)' :
          'per m3 beton',
        unitPrice: s.unitPrice,
        qtyPerBoqUnit,
        costPerBoqUnit,
        totalQty: qtyPerBoqUnit * row.planned,
        totalCost: costPerBoqUnit * row.planned,
      });
    }
  }

  // 2. Bekisting — match by W column.
  let bekisting: BekistingTemplate | undefined;
  if (cols.bekistingHargaPerM2 > 0) {
    for (const b of bekistings) {
      if (Math.abs(b.hargaPerM2 - cols.bekistingHargaPerM2) <= componentCostMatchTol) {
        bekisting = b;
        break;
      }
    }
    if (bekisting && cols.bekistingRatioM2PerM3 > 0) {
      const factor = cols.bekistingRatioM2PerM3 / bekisting.cycleFactor;
      const elementHint = bekisting.blockTitle.replace(/.*Bekisting\s+/i, '').toUpperCase();
      for (const s of bekisting.subItems) {
        if (!s.includedInTotal) continue;
        const qtyPerBoqUnit = s.qtyPerNative * factor;
        const costPerBoqUnit = qtyPerBoqUnit * s.unitPrice;
        components.push({
          group: 'material',
          componentGroup: `BEKISTING ${elementHint} (Material) — ratio ${cols.bekistingRatioM2PerM3} m²/m³`,
          materialName: s.materialName,
          specNote: null,
          qtyPerNativeUnit: s.qtyPerNative,
          nativeUnit: s.nativeUnit,
          nativeBasis: `per m² form (cycle ${bekisting.cycleFactor})`,
          unitPrice: s.unitPrice,
          qtyPerBoqUnit,
          costPerBoqUnit,
          totalQty: qtyPerBoqUnit * row.planned,
          totalCost: costPerBoqUnit * row.planned,
        });
      }
    } else if (!bekisting) {
      return { reason: `No bekisting block matches W=${cols.bekistingHargaPerM2}` };
    }
  }

  // 3. Pembesian — per-diameter + waste + decking + bendrat.
  if (diameters.length > 0 && pembesian.besiUnitPrice > 0) {
    const totalRawKgPerM3 = diameters.reduce((s, d) => s + d.qtyPerM3, 0);
    const wasteCoeff = pembesian.besiCoeff - 1; // 1.05 - 1 = 0.05
    const componentGroup = `PEMBESIAN (Material) — ratio ${totalRawKgPerM3.toFixed(2)} kg/m³`;
    for (const d of diameters) {
      components.push({
        group: 'material',
        componentGroup,
        materialName: `Besi beton ${d.diameter}`,
        specNote: 'U24/U40 polos',
        qtyPerNativeUnit: d.qtyPerM3,
        nativeUnit: 'kg',
        nativeBasis: 'per m3 beton',
        unitPrice: pembesian.besiUnitPrice,
        qtyPerBoqUnit: d.qtyPerM3,
        costPerBoqUnit: d.qtyPerM3 * pembesian.besiUnitPrice,
        totalQty: d.qtyPerM3 * row.planned,
        totalCost: d.qtyPerM3 * pembesian.besiUnitPrice * row.planned,
      });
    }
    const wasteQty = totalRawKgPerM3 * wasteCoeff;
    components.push({
      group: 'material', componentGroup,
      materialName: 'Besi beton — waste (5%)',
      specNote: 'applied via AHS coeff 1.05',
      qtyPerNativeUnit: wasteCoeff, nativeUnit: 'kg', nativeBasis: 'per m3 beton',
      unitPrice: pembesian.besiUnitPrice,
      qtyPerBoqUnit: wasteQty,
      costPerBoqUnit: wasteQty * pembesian.besiUnitPrice,
      totalQty: wasteQty * row.planned,
      totalCost: wasteQty * pembesian.besiUnitPrice * row.planned,
    });
    const deckingQty = totalRawKgPerM3 * pembesian.deckingCoeff;
    components.push({
      group: 'material', componentGroup,
      materialName: 'Beton decking',
      specNote: 'spacer',
      qtyPerNativeUnit: pembesian.deckingCoeff, nativeUnit: 'kg-eq', nativeBasis: 'per kg besi',
      unitPrice: pembesian.deckingUnitPrice,
      qtyPerBoqUnit: deckingQty,
      costPerBoqUnit: deckingQty * pembesian.deckingUnitPrice,
      totalQty: deckingQty * row.planned,
      totalCost: deckingQty * pembesian.deckingUnitPrice * row.planned,
    });
    // Bendrat: coeff is per kg of "finished" pembesian (= raw kg). 0.021 in AAL-5.
    const bendratQty = totalRawKgPerM3 * pembesian.bendratCoeff;
    components.push({
      group: 'material', componentGroup,
      materialName: 'Bendrat (kawat ikat)',
      specNote: `${(pembesian.bendratCoeff * 100).toFixed(1)}% of besi (raw)`,
      qtyPerNativeUnit: pembesian.bendratCoeff, nativeUnit: 'kg', nativeBasis: 'per kg besi (raw)',
      unitPrice: pembesian.bendratUnitPrice,
      qtyPerBoqUnit: bendratQty,
      costPerBoqUnit: bendratQty * pembesian.bendratUnitPrice,
      totalQty: bendratQty * row.planned,
      totalCost: bendratQty * pembesian.bendratUnitPrice * row.planned,
    });
  }

  // 4. Wire mesh (AC*AD) — itemized variant. Some workbooks reinforce plat
  // with a wire-mesh material that's tracked separately from the per-diameter
  // U24/U40 rebar in the Pembesian block. AC = kg of wire mesh per m³ beton,
  // AD = Rp per kg. The workbook's column-sum invariant (field guide §4.0)
  // includes a dedicated AC*AD term, disjoint from Z*AA — verified against
  // the I4-29 workbook formula AF = R + V*W + Z*AA [+ AC*AD] where the wire
  // mesh AHS at Analisa rows 235..239 is a separate recipe from Pembesian
  // U24 & U40 at rows 228..233. The REKAP per-diameter weights are also
  // disjoint from wire mesh (REKAP records U24/U40 rebar only, while wire
  // mesh M6/M8 has its own catalog entry).
  // Emit as a single material lump with native unit kg and price = AD.
  // Without this, any row where AC*AD > 0 alongside Z*AA > 0 would short-pay
  // by AC*AD in the itemized tier and fall back to rolled.
  if (cols.wireMeshRatioPerM3 > 0 && cols.wireMeshPricePerKg > 0) {
    const qtyPerBoqUnit = cols.wireMeshRatioPerM3;
    const costPerBoqUnit = qtyPerBoqUnit * cols.wireMeshPricePerKg;
    components.push({
      group: 'material',
      componentGroup: 'WIRE MESH (Material)',
      materialName: 'Wire mesh',
      specNote: 'plat reinforcement — separate from pembesian U24/U40',
      qtyPerNativeUnit: cols.wireMeshRatioPerM3,
      nativeUnit: 'kg',
      nativeBasis: 'per m3 beton',
      unitPrice: cols.wireMeshPricePerKg,
      qtyPerBoqUnit,
      costPerBoqUnit,
      totalQty: qtyPerBoqUnit * row.planned,
      totalCost: costPerBoqUnit * row.planned,
    });
  }

  if (components.length === 0) {
    return { reason: 'No components — no Bekisting/Concrete/Pembesian template matched' };
  }

  const computedUnitCost = components.reduce((s, c) => s + c.costPerBoqUnit, 0);
  const variance = computedUnitCost - sourceUnitCost;

  if (Math.abs(variance) > TOLERANCE_RP) {
    return {
      reason: `Computed unit cost ${computedUnitCost.toFixed(2)} vs source ${sourceUnitCost.toFixed(2)} — variance ${variance.toFixed(2)} Rp`,
      computedUnitCost,
      variance,
    };
  }

  const computedLineTotal = computedUnitCost * row.planned;
  const breakdown: RowBreakdown = {
    boqCode: row.code,
    description: row.label,
    unit: row.unit,
    volume: row.planned,
    unitCost: computedUnitCost,
    lineTotal: computedLineTotal,
    components,
    reconciliation: {
      computedUnitCost,
      sourceUnitCost,
      unitCostVariance: variance,
      computedLineTotal,
      sourceLineTotal,
      lineTotalVariance: computedLineTotal - sourceLineTotal,
      reconciles: true,
    },
    sourceSheet: `Breakdown ${row.code}`,
  };
  return { breakdown, computedUnitCost, variance, level: 'itemized' };
}

// --- main ---

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: npm run normalize:boq:det -- <input.xlsx> [output.xlsx]');
    process.exit(1);
  }
  const inputPath = path.resolve(args[0]);
  const outputPath = args[1] ?? inputPath.replace(/\.xlsx$/i, '_normalized.xlsx');

  console.log(`Reading: ${inputPath}`);
  const buf = fs.readFileSync(inputPath);
  // 'auto' so we pick up multi-sheet workbooks like I4-29 (RAB A..E) — not
  // every contractor packs all BoQ rows into RAB (A).
  const result = await parseBoqV2(buf, { boqSheet: 'auto' });
  const lookup = buildLookup(result.cells);

  console.log('Extracting Analisa templates...');
  const bekistings = extractBekistingTemplates(result.ahsBlocks, lookup);
  const concretes = extractConcreteTemplates(result.ahsBlocks, lookup);
  const pembesian = extractPembesianTemplate(result.ahsBlocks, lookup);
  console.log(`  ${bekistings.length} bekisting templates, ${concretes.length} concrete templates, pembesian=${pembesian ? 'yes' : 'NO'}`);

  if (!pembesian) {
    console.error('No Pembesian U24 & U40 block found — cannot proceed.');
    process.exit(2);
  }

  const candidates = result.boqRows.filter(needsExpansion);
  console.log(`\nProcessing ${candidates.length} BoQ rows needing expansion:`);

  const breakdowns: RowBreakdown[] = [];
  const unresolved: Array<{ code: string; label: string; reason: string }> = [];
  let itemizedCount = 0;
  let rolledCount = 0;

  for (const row of candidates) {
    const cols = readRowCols(lookup, row.source_sheet, row.sourceRow);
    const diameters = readDiametersForRow(row);
    const sourceUnitCost =
      (row.cost_split
        ? row.cost_split.material + row.cost_split.labor + row.cost_split.equipment + row.cost_split.prelim
        : 0) + (row.subkon_cost_per_unit ?? 0);
    const sourceLineTotal = row.total_cost ?? 0;

    // Tier 1: try itemized expansion.
    let res = buildBreakdownForRow({
      row, cols, diameters, bekistings, concretes, pembesian, sourceUnitCost, sourceLineTotal,
    });

    // Tier 2: fall back to rolled lump breakdown from RAB(A) column totals.
    // The 5 lumps (R, S, T, V*W, Z*AA) sum to N by the workbook's own
    // arithmetic — reconciles by construction for any row with structural
    // columns populated.
    if (!res.breakdown) {
      const rolled = buildRolledBreakdown({ row, cols, sourceUnitCost, sourceLineTotal });
      if (rolled.breakdown) res = rolled;
    }

    if (res.breakdown) {
      breakdowns.push(res.breakdown);
      if (res.level === 'itemized') itemizedCount++;
      else rolledCount++;
      const icon = res.level === 'itemized' ? '✓ itemized' : '~ rolled  ';
      console.log(`  ${icon} ${row.code.padEnd(14)} ${row.label.slice(0, 35).padEnd(35)} variance=${(res.variance ?? 0).toFixed(2)} Rp`);
    } else {
      unresolved.push({ code: row.code, label: row.label, reason: res.reason ?? 'unknown' });
      console.log(`  ⚠ unresolved ${row.code.padEnd(14)} ${row.label.slice(0, 35).padEnd(35)} ${res.reason}`);
    }
  }

  console.log('');
  console.log(`Reconciled total: ${breakdowns.length} / ${candidates.length}`);
  console.log(`  ✓ itemized:  ${itemizedCount}  (per-material detail)`);
  console.log(`  ~ rolled:    ${rolledCount}  (5-line group lumps from RAB columns)`);
  console.log(`Unresolved:       ${unresolved.length}`);

  const wb = XLSX.read(buf, { cellFormula: true, cellStyles: false });
  writeBreakdownSheets(wb, breakdowns);
  if (unresolved.length > 0) {
    const rows: unknown[][] = [
      ['UNRESOLVED ROWS — deterministic templates could not reconcile'],
      [`Generated: ${new Date().toISOString()}`],
      [],
      ['Code', 'Label', 'Reason'],
      ...unresolved.map((u) => [u.code, u.label, u.reason]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Unresolved');
  }
  const outBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  fs.writeFileSync(outputPath, outBuf);
  console.log(`\nWrote: ${outputPath}`);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(10);
});
