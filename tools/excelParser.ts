// SANO — Excel BoQ Parser Engine
// Parses real Indonesian construction RAB (Rencana Anggaran Biaya) workbooks.
// Handles: RAB sheets (BoQ), Analisa (AHS), Material price list, Upah (labor rates).
// Includes AI anomaly detection for coefficient/price deviations.

import * as XLSX from 'xlsx';
import type {
  AhsLineType,
  ImportAnomalyType,
  AnomalySeverity,
} from './types';

// ═══════════════════════════════════════════════════════════════════════
// PARSED OUTPUT TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface ParsedWorkbook {
  projectInfo: ProjectInfo;
  boqItems: ParsedBoqItem[];
  ahsBlocks: ParsedAhsBlock[];
  materials: ParsedExcelMaterial[];
  laborRates: ParsedLaborRate[];
  markupFactors: ParsedMarkupFactor[];
  anomalies: ParsedAnomaly[];
  /** Maps AHS "Jumlah" row number → AHS block index */
  ahsRowMap: Map<number, number>;
  /** Maps RAB row → AHS block indices it references */
  rabToAhsLinks: Map<number, AhsLinkage>;
}

export interface ProjectInfo {
  fileName: string;
  sheetNames: string[];
  rabSheets: string[];
  ahsSheet: string | null;
  materialSheet: string | null;
  upahSheet: string | null;
}

export interface ParsedBoqItem {
  /** Generated hierarchical code: e.g., "II-03" */
  code: string;
  label: string;
  unit: string;
  volume: number;
  chapter: string;
  chapterIndex: string;
  sectionLabel: string | null;
  parentCode: string | null;
  sortOrder: number;
  elementCode: string | null;
  costBreakdown: {
    material: number;
    labor: number;
    equipment: number;
    subkon: number;
    prelim: number;
  };
  internalUnitPrice: number;
  clientUnitPrice: number;
  compositeFactors: {
    formwork_ratio: number;
    rebar_ratio: number;
    wiremesh_ratio: number;
  } | null;
  /** Source Excel row (1-based) */
  sourceRow: number;
  /** Name of the RAB sheet this came from */
  sourceSheet: string;
  /** RAB row references to Analisa rows (parsed from formulas) */
  ahsReferences: AhsReference[];
}

export interface AhsReference {
  component: 'material' | 'labor' | 'equipment' | 'composite_concrete' | 'composite_formwork' | 'composite_rebar' | 'composite_wiremesh';
  ahsRow: number;
  column: string;
}

export interface AhsLinkage {
  directRefs: AhsReference[];
  ahsBlockIndices: number[];
}

export interface ParsedAhsBlock {
  title: string;
  titleRow: number;
  jumlahRow: number;
  components: ParsedAhsComponent[];
  totals: {
    material: number;
    labor: number;
    equipment: number;
  };
  sourceSheet: string;
}

export interface ParsedAhsComponent {
  coefficient: number;
  rawCoefficient: string;
  unit: string;
  description: string;
  unitPrice: number;
  subtotal: number;
  lineType: AhsLineType;
  sourceRow: number;
  /** Detected waste factor if coefficient contains multiplication (e.g., 0.3*1.2) */
  wasteFactor: number;
  /** Reference to Material! or Upah! sheet cell */
  priceRef: string | null;
}

export interface ParsedExcelMaterial {
  rowNumber: number;
  name: string;
  spec: string | null;
  unit: string;
  unitPrice: number;
  /** Resolved catalog code after fuzzy matching */
  resolvedCode: string | null;
  /** Confidence of the match (0-1) */
  matchConfidence: number;
}

export interface ParsedLaborRate {
  rowNumber: number;
  description: string;
  unit: string;
  rate: number;
}

export interface ParsedMarkupFactor {
  category: string;
  factor: number;
  sortOrder: number;
}

export interface ParsedAnomaly {
  type: ImportAnomalyType;
  severity: AnomalySeverity;
  sourceSheet: string;
  sourceRow: number;
  description: string;
  expectedValue: string | null;
  actualValue: string | null;
  context: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════
// STANDARD REFERENCE DATA (for AI anomaly detection)
// ═══════════════════════════════════════════════════════════════════════

/** Standard coefficient ranges for common AHS components (per m2 or per m3) */
const STANDARD_COEFFICIENTS: Record<string, { min: number; max: number; unit: string }> = {
  // Bata merah per m2 dinding
  'bata merah': { min: 50, max: 80, unit: 'pcs' },
  'bata ringan': { min: 7, max: 10, unit: 'pcs' },
  // Semen per m2 plesteran
  'semen': { min: 0.15, max: 0.5, unit: 'zak' },
  // Pasir per m2 plesteran
  'pasir': { min: 0.02, max: 0.1, unit: 'm3' },
  // Besi per m3 beton
  'besi beton': { min: 60, max: 200, unit: 'kg' },
  // Bekisting per m3 beton (ratio)
  'bekisting': { min: 3.0, max: 12.0, unit: 'm2/m3' },
};

/** Standard formwork ratios (m2 formwork per m3 concrete) by element type */
const FORMWORK_RATIO_RANGES: Record<string, { min: number; max: number }> = {
  kolom: { min: 5.0, max: 9.0 },
  balok: { min: 5.5, max: 10.0 },
  plat: { min: 3.0, max: 6.0 },
  sloof: { min: 4.0, max: 8.0 },
  poer: { min: 3.0, max: 6.0 },
  tangga: { min: 6.0, max: 12.0 },
};

/** Standard rebar ratios (kg rebar per m3 concrete) by element type */
const REBAR_RATIO_RANGES: Record<string, { min: number; max: number }> = {
  kolom: { min: 80, max: 200 },
  balok: { min: 100, max: 250 },
  plat: { min: 50, max: 120 },
  sloof: { min: 80, max: 180 },
  poer: { min: 60, max: 150 },
  tangga: { min: 70, max: 160 },
};

/** Normal waste factor range */
const WASTE_FACTOR_RANGE = { min: 0.02, max: 0.25 };

// ═══════════════════════════════════════════════════════════════════════
// MAIN PARSER
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse a complete BoQ workbook (RAB Excel file).
 * This is the main entry point — call with the file buffer or path.
 */
export function parseBoqWorkbook(
  fileInput: ArrayBuffer | string,
  fileName: string,
  options?: { skipGrouping?: boolean },
): ParsedWorkbook {
  const workbook = typeof fileInput === 'string'
    ? XLSX.readFile(fileInput, { cellFormula: true, cellNF: true })
    : XLSX.read(fileInput, { cellFormula: true, cellNF: true });

  const sheetNames = workbook.SheetNames;

  // Classify sheets
  const rabSheets = sheetNames.filter(n =>
    /^RAB\s*\(/i.test(n) || /^RAB$/i.test(n),
  );
  const ahsSheet = sheetNames.find(n => /analisa/i.test(n)) ?? null;
  const materialSheet = sheetNames.find(n => /^material$/i.test(n)) ?? null;
  const upahSheet = sheetNames.find(n => /^upah$/i.test(n)) ?? null;
  const rekapSheet = sheetNames.find(n => /^REKAP\s+RAB$/i.test(n)) ?? null;

  const projectInfo: ProjectInfo = {
    fileName,
    sheetNames,
    rabSheets,
    ahsSheet,
    materialSheet,
    upahSheet,
  };

  const anomalies: ParsedAnomaly[] = [];

  // 1. Parse Material & Upah sheets first (needed for AHS price resolution)
  const materials = materialSheet
    ? parseMaterialSheet(workbook.Sheets[materialSheet], materialSheet)
    : [];
  const laborRates = upahSheet
    ? parseUpahSheet(workbook.Sheets[upahSheet], upahSheet)
    : [];

  // Build price lookup maps for AHS validation
  const materialPriceMap = buildMaterialPriceMap(materials);
  const laborPriceMap = buildLaborPriceMap(laborRates);

  // 2. Parse AHS (Analisa) sheet
  const ahsBlocks: ParsedAhsBlock[] = [];
  const ahsRowMap = new Map<number, number>();
  if (ahsSheet) {
    const parsed = parseAnalisaSheet(
      workbook.Sheets[ahsSheet],
      ahsSheet,
      materialPriceMap,
      laborPriceMap,
      anomalies,
    );
    ahsBlocks.push(...parsed.blocks);
    parsed.blocks.forEach((block, idx) => {
      ahsRowMap.set(block.jumlahRow, idx);
    });
  }

  // 3. Parse markup factors from REKAP RAB
  const markupFactors: ParsedMarkupFactor[] = rekapSheet
    ? parseRekapMarkup(workbook.Sheets[rekapSheet])
    : [];

  // 4. Parse RAB sheets (BoQ items) with formula tracing
  const boqItems: ParsedBoqItem[] = [];
  const rabToAhsLinks = new Map<number, AhsLinkage>();
  let globalSortOrder = 0;

  for (const sheetName of rabSheets) {
    const sheet = workbook.Sheets[sheetName];
    const parsed = parseRabSheet(
      sheet,
      sheetName,
      ahsRowMap,
      ahsBlocks,
      globalSortOrder,
      anomalies,
    );
    boqItems.push(...parsed.items);
    parsed.links.forEach((v, k) => rabToAhsLinks.set(k, v));
    globalSortOrder += parsed.items.length;
  }

  disambiguateBoqLabels(boqItems);

  // 5. Optionally group with keyword fallback (sync).
  //    For AI-driven grouping, callers should use applyBoqGrouping() after parse.
  if (options?.skipGrouping === false) {
    applyBoqGrouping({ projectInfo, boqItems, ahsBlocks, materials, laborRates, markupFactors, anomalies, ahsRowMap, rabToAhsLinks });
  }

  // 6. Run AI anomaly checks on the (possibly grouped) parsed data
  runAnomalyChecks(boqItems, ahsBlocks, materials, anomalies);

  return {
    projectInfo,
    boqItems,
    ahsBlocks,
    materials,
    laborRates,
    markupFactors,
    anomalies,
    ahsRowMap,
    rabToAhsLinks,
  };
}

export function disambiguateBoqLabels(items: ParsedBoqItem[]): ParsedBoqItem[] {
  const groups = new Map<string, ParsedBoqItem[]>();

  for (const item of items) {
    const key = [normalize(item.label), item.unit].join('|');
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const uniqueContexts = new Set(
      group
        .map(item => normalize(getBoqDisambiguationContext(item) ?? ''))
        .filter(Boolean),
    );
    const usedLabels = new Set<string>();
    const contextCounts = new Map<string, number>();

    for (const item of group) {
      const baseContext = getBoqDisambiguationContext(item)
        ?? (item.elementCode ? `Elemen ${item.elementCode}` : `Baris ${item.sourceRow}`);
      const seenCount = (contextCounts.get(baseContext) ?? 0) + 1;
      contextCounts.set(baseContext, seenCount);

      let finalContext = baseContext;
      if (uniqueContexts.size <= 1) {
        finalContext = item.elementCode ? `${baseContext} · ${item.elementCode}` : `${baseContext} · ${item.code}`;
      } else if (seenCount > 1) {
        finalContext = item.elementCode ? `${baseContext} · ${item.elementCode}` : `${baseContext} · ${item.code}`;
      }

      let candidate = `${item.label} — ${finalContext}`;
      let serial = 2;
      while (usedLabels.has(normalize(candidate))) {
        candidate = `${item.label} — ${finalContext} · ${serial}`;
        serial++;
      }

      usedLabels.add(normalize(candidate));
      item.label = candidate;
    }
  }

  return items;
}

function getBoqDisambiguationContext(item: ParsedBoqItem): string | null {
  const candidates = [item.sectionLabel, item.chapter, item.sourceSheet].filter(Boolean) as string[];

  for (const raw of candidates) {
    const floorContext = extractFloorContext(raw);
    if (floorContext) return floorContext;
  }

  for (const raw of candidates) {
    const cleaned = compactSectionContext(raw);
    if (!cleaned) continue;
    if (normalize(cleaned) === normalize(item.label)) continue;
    return cleaned;
  }

  return null;
}

function extractFloorContext(raw: string): string | null {
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) return null;

  if (/\bsemi\s*basement\b/i.test(compact)) return 'Semi Basement';
  if (/\b(basement|basemen)\b/i.test(compact)) return 'Basement';
  if (/\b(mezzanine|mezanin)\b/i.test(compact)) return 'Mezzanine';
  if (/\b(ground\s*floor|lantai\s*dasar|gf)\b/i.test(compact)) return 'Lantai Dasar';
  if (/\b(dak|roof|atap)\b/i.test(compact)) return 'Dak / Atap';

  const floorMatch = compact.match(/(?:lantai|lt\.?|floor|level|lvl)\s*([a-z0-9]+)/i);
  if (floorMatch?.[1]) {
    return `Lantai ${formatFloorToken(floorMatch[1])}`;
  }

  return null;
}

function formatFloorToken(token: string): string {
  const cleaned = token.replace(/[^\da-z]/gi, '').trim();
  if (!cleaned) return token.trim();
  if (/^\d+$/.test(cleaned)) return cleaned;
  return cleaned.toUpperCase();
}

function compactSectionContext(raw: string): string {
  return raw
    .replace(/^pekerjaan\s+/i, '')
    .replace(/^fisik\s+/i, '')
    .replace(/^struktur\s+/i, '')
    .replace(/^arsitektur\s+/i, '')
    .replace(/^mekanikal\s+elektrikal\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════
// MATERIAL SHEET PARSER
// ═══════════════════════════════════════════════════════════════════════

function parseMaterialSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
): ParsedExcelMaterial[] {
  const results: ParsedExcelMaterial[] = [];
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');

  // Find header row (look for "MATERIALS" or "HARGA" in first 10 rows)
  let headerRow = -1;
  for (let r = 0; r <= Math.min(10, range.e.r); r++) {
    let rowFingerprint = '';
    for (let c = 0; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || typeof cell.v !== 'string') continue;
      const fingerprint = normalizeHeaderText(String(cell.v));
      rowFingerprint += ` ${fingerprint}`;
      if (fingerprint.includes('materials') || fingerprint.includes('material') || fingerprint.includes('bahan')) {
        headerRow = r;
        break;
      }
    }
    if (headerRow < 0 && /harganet|harga/.test(rowFingerprint) && /\bsat\b|\bunit\b/.test(rowFingerprint)) {
      headerRow = r;
    }
    if (headerRow >= 0) break;
  }

  if (headerRow < 0) return results;

  // Detect column layout by scanning header row
  const colMap = detectMaterialColumns(sheet, headerRow, range.e.c);

  // Parse data rows
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const nameCell = sheet[XLSX.utils.encode_cell({ r, c: colMap.name })];
    if (!nameCell || !nameCell.v) continue;

    const rawName = String(nameCell.v).trim();
    if (!rawName || rawName.length < 2) continue;

    const specCell = colMap.spec >= 0
      ? sheet[XLSX.utils.encode_cell({ r, c: colMap.spec })]
      : null;
    const unitCell = sheet[XLSX.utils.encode_cell({ r, c: colMap.unit })];
    const priceCell = sheet[XLSX.utils.encode_cell({ r, c: colMap.price })];

    results.push({
      rowNumber: r + 1,
      name: normalizeConcreteGrade(rawName),
      spec: specCell ? String(specCell.v ?? '').trim() || null : null,
      unit: unitCell ? String(unitCell.v ?? '').trim() : '',
      unitPrice: priceCell ? Number(priceCell.v ?? 0) : 0,
      resolvedCode: null,
      matchConfidence: 0,
    });
  }

  // Dedupe rows that collapsed to the same name+unit after concrete
  // grade normalization (e.g. three "fc' 30 MPa" rows → one "K-350").
  // Keep the highest-priced variant — usually the premium spec.
  return dedupeByNameUnit(results);
}

function dedupeByNameUnit(rows: ParsedExcelMaterial[]): ParsedExcelMaterial[] {
  const winners = new Map<string, ParsedExcelMaterial>();
  for (const row of rows) {
    const key = `${row.name.toLowerCase()}|${row.unit.toLowerCase()}`;
    const existing = winners.get(key);
    if (!existing || row.unitPrice > existing.unitPrice) {
      winners.set(key, row);
    }
  }
  const kept = new Set(winners.values());
  return rows.filter(r => kept.has(r));
}

const CONCRETE_MPA_TO_K: Record<string, number> = {
  '15':   175,
  '17.5': 200,
  '20':   250,
  '22.5': 275,
  '25':   300,
  '27.5': 325,
  '30':   350,
  '32.5': 400,
  '35':   450,
  '40':   500,
};

export function normalizeConcreteGrade(name: string): string {
  const match = name.match(/fc\s*['\u2019]?\s*(\d+(?:[.,]\d+)?)\s*mpa/i);
  if (!match) return name;
  const mpa = match[1].replace(',', '.');
  const k = CONCRETE_MPA_TO_K[mpa];
  if (!k) return name;
  return name.replace(match[0], `K-${k}`).replace(/\s+/g, ' ').trim();
}

function detectMaterialColumns(
  sheet: XLSX.WorkSheet,
  headerRow: number,
  maxCol: number,
): { name: number; spec: number; unit: number; price: number } {
  let name = 1; // default B
  let spec = -1;
  let unit = 5; // default F
  let price = 6; // default G

  for (let c = 0; c <= maxCol; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    if (!cell) continue;
    const rawVal = String(cell.v ?? '');
    const val = rawVal.toLowerCase();
    const fingerprint = normalizeHeaderText(rawVal);
    if ((/material|bahan|uraian/i.test(val) || /materials|material|bahan|uraian/.test(fingerprint)) && !/sub/i.test(val)) name = c;
    if (/produk|model|tipe|spec/i.test(val) || /produk|model|tipe|spec/.test(fingerprint)) spec = c;
    if (/^sat/i.test(val) || val === 'unit' || fingerprint === 'sat' || fingerprint === 'unit') unit = c;
    if (/harga|price|net/i.test(val) || /harganet|harga|price|net/.test(fingerprint)) price = c;
  }

  return { name, spec, unit, price };
}

// ═══════════════════════════════════════════════════════════════════════
// UPAH (LABOR) SHEET PARSER
// ═══════════════════════════════════════════════════════════════════════

function parseUpahSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
): ParsedLaborRate[] {
  const results: ParsedLaborRate[] = [];
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');

  // Find header (look for "PEKERJAAN" or "UPAH")
  let headerRow = -1;
  for (let r = 0; r <= Math.min(10, range.e.r); r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'string' && /pekerjaan|uraian/i.test(cell.v)) {
        headerRow = r;
        break;
      }
    }
    if (headerRow >= 0) break;
  }

  if (headerRow < 0) return results;

  // Detect columns
  let descCol = 1, unitCol = 2, rateCol = 3;
  for (let c = 0; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    if (!cell) continue;
    const val = String(cell.v ?? '').toLowerCase();
    if (/pekerjaan|uraian/i.test(val)) descCol = c;
    if (/^sat/i.test(val)) unitCol = c;
    if (/upah|harga|rate/i.test(val)) rateCol = c;
  }

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const descCell = sheet[XLSX.utils.encode_cell({ r, c: descCol })];
    if (!descCell || !descCell.v) continue;

    const description = String(descCell.v).trim();
    if (!description || description.length < 2) continue;

    const unitCell = sheet[XLSX.utils.encode_cell({ r, c: unitCol })];
    const rateCell = sheet[XLSX.utils.encode_cell({ r, c: rateCol })];

    results.push({
      rowNumber: r + 1,
      description,
      unit: unitCell ? String(unitCell.v ?? '').trim() : '',
      rate: rateCell ? Number(rateCell.v ?? 0) : 0,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// ANALISA (AHS) SHEET PARSER
// ═══════════════════════════════════════════════════════════════════════

interface AnalisaParseResult {
  blocks: ParsedAhsBlock[];
}

function parseAnalisaSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  materialPriceMap: Map<string, number>,
  laborPriceMap: Map<string, number>,
  anomalies: ParsedAnomaly[],
): AnalisaParseResult {
  const blocks: ParsedAhsBlock[] = [];
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');

  // AHS blocks are sequential, separated by blank rows.
  // Block structure:
  //   Title row: col B has the analysis title (e.g., "1 m2 Bekisting Bata Merah...")
  //   Component rows: col B=coefficient, C=unit, D=description, E=unit price, F=mat subtotal, G=labor subtotal, H=equip subtotal
  //   Jumlah row: col E="Jumlah", F=SUM(F), G=SUM(G), H=SUM(H), I=total

  let currentBlock: {
    title: string;
    titleRow: number;
    components: ParsedAhsComponent[];
  } | null = null;

  // Skip header rows (usually rows 1-9)
  const startRow = findAhsStartRow(sheet, range.e.r);

  for (let r = startRow; r <= range.e.r; r++) {
    const cellB = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
    const cellD = sheet[XLSX.utils.encode_cell({ r, c: 3 })];
    const cellE = sheet[XLSX.utils.encode_cell({ r, c: 4 })];

    // Check if this is a "Jumlah" (total) row — closes the current block
    if (cellE && typeof cellE.v === 'string' && /jumlah/i.test(String(cellE.v))) {
      if (currentBlock) {
        const cellF = sheet[XLSX.utils.encode_cell({ r, c: 5 })];
        const cellG = sheet[XLSX.utils.encode_cell({ r, c: 6 })];
        const cellH = sheet[XLSX.utils.encode_cell({ r, c: 7 })];

        blocks.push({
          title: currentBlock.title,
          titleRow: currentBlock.titleRow + 1, // 1-based
          jumlahRow: r + 1, // 1-based
          components: currentBlock.components,
          totals: {
            material: Number(cellF?.v ?? 0),
            labor: Number(cellG?.v ?? 0),
            equipment: Number(cellH?.v ?? 0),
          },
          sourceSheet: sheetName,
        });
        currentBlock = null;
      }
      continue;
    }

    // Check if this is a title row (starts a new block)
    // Title rows: col B has descriptive text (not a number), col D is usually empty
    if (cellB && !cellD) {
      const bVal = cellB.v;
      if (typeof bVal === 'string' && bVal.trim().length > 5 && isAhsTitleRow(bVal)) {
        // Close any unclosed block
        if (currentBlock && currentBlock.components.length > 0) {
          blocks.push({
            title: currentBlock.title,
            titleRow: currentBlock.titleRow + 1,
            jumlahRow: currentBlock.titleRow + 1, // no jumlah found
            components: currentBlock.components,
            totals: { material: 0, labor: 0, equipment: 0 },
            sourceSheet: sheetName,
          });
        }

        currentBlock = {
          title: bVal.trim(),
          titleRow: r,
          components: [],
        };
        continue;
      }
    }

    // Check if this is a component row within a block
    if (currentBlock && cellB && cellD) {
      const coeff = Number(cellB.v ?? 0);
      if (coeff === 0 && typeof cellB.v !== 'number') continue;

      const cellC = sheet[XLSX.utils.encode_cell({ r, c: 2 })];
      const cellF = sheet[XLSX.utils.encode_cell({ r, c: 5 })];
      const cellG = sheet[XLSX.utils.encode_cell({ r, c: 6 })];
      const cellH = sheet[XLSX.utils.encode_cell({ r, c: 7 })];

      const description = String(cellD.v ?? '').trim();
      const unitPrice = Number(cellE?.v ?? 0);
      const matSubtotal = Number(cellF?.v ?? 0);
      const laborSubtotal = Number(cellG?.v ?? 0);
      const equipSubtotal = Number(cellH?.v ?? 0);

      // Determine line type from which subtotal column has a value
      let lineType: AhsLineType = 'material';
      if (laborSubtotal > 0 && matSubtotal === 0) lineType = 'labor';
      else if (equipSubtotal > 0 && matSubtotal === 0 && laborSubtotal === 0) lineType = 'equipment';

      // Also check description keywords for labor detection
      if (lineType === 'material' && isLaborDescription(description)) {
        lineType = 'labor';
      }

      // Parse waste factor from formula if coefficient cell has a formula like "=0.3*1.2"
      const wasteFactor = extractWasteFactor(cellB);

      // Get price reference (formula pointing to Material! or Upah!)
      const priceRef = cellE?.f ? String(cellE.f) : null;

      currentBlock.components.push({
        coefficient: Math.abs(coeff),
        rawCoefficient: cellB.f ? String(cellB.f) : String(coeff),
        unit: cellC ? String(cellC.v ?? '').trim() : '',
        description,
        unitPrice,
        subtotal: matSubtotal || laborSubtotal || equipSubtotal,
        lineType,
        sourceRow: r + 1,
        wasteFactor,
        priceRef,
      });
    }
  }

  return { blocks };
}

function findAhsStartRow(sheet: XLSX.WorkSheet, maxRow: number): number {
  // Look for the header row with "URAIAN PEKERJAAN" or "HARGA SATUAN"
  for (let r = 0; r <= Math.min(15, maxRow); r++) {
    for (let c = 0; c <= 10; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'string' && /uraian pekerjaan|harga satuan/i.test(cell.v)) {
        return r + 1;
      }
    }
  }
  return 9; // default: row 10 (0-based index 9)
}

function isAhsTitleRow(text: string): boolean {
  // AHS titles typically start with "1 m2 ...", "1 m3 ...", "1 m1 ...", "1 kg ...", etc.
  return /^\d+\s*(m[123]|kg|ls|bh|pcs|titik|set|unit)\s+/i.test(text.trim())
    || /^(pekerjaan|pasangan|pemasangan|pengecoran|pembetonan|pembesian)/i.test(text.trim());
}

function isLaborDescription(desc: string): boolean {
  const laborKeywords = [
    'tukang', 'pekerja', 'mandor', 'kepala tukang',
    'upah', 'borongan', 'tenaga', 'buruh',
    'pasang', 'cor ', 'pengecoran',
  ];
  const lower = desc.toLowerCase();
  return laborKeywords.some(kw => lower.includes(kw));
}

function extractWasteFactor(cell: XLSX.CellObject): number {
  if (!cell.f) return 0;
  const formula = String(cell.f);
  // Match patterns like "=0.3*1.2" or "=0.06*1.2" → waste factor is 0.2 (20%)
  const match = formula.match(/\*\s*(1\.\d+)\s*$/);
  if (match) {
    return Number(match[1]) - 1; // 1.2 → 0.2, 1.1 → 0.1
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════
// RAB (BoQ) SHEET PARSER
// ═══════════════════════════════════════════════════════════════════════

interface RabParseResult {
  items: ParsedBoqItem[];
  links: Map<number, AhsLinkage>;
}

/** Roman numeral detection */
const ROMAN_RE = /^(I{1,3}|IV|VI{0,3}|IX|X{0,3}I{0,3}|X{0,3}V?I{0,3})\.?\s*$/;
const ROMAN_MAP: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9,
  X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15,
};

function parseRabSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  ahsRowMap: Map<number, number>,
  ahsBlocks: ParsedAhsBlock[],
  sortOrderOffset: number,
  anomalies: ParsedAnomaly[],
): RabParseResult {
  const items: ParsedBoqItem[] = [];
  const links = new Map<number, AhsLinkage>();
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');

  // RAB header is always row 7 (0-based index 6)
  const headerRow = findRabHeaderRow(sheet, range.e.r);
  const colMap = detectRabColumns(sheet, headerRow, range.e.c);

  let currentChapter = '';
  let currentChapterIndex = '';
  let currentSectionLabel: string | null = null;
  let itemCounter = 0;
  let sortOrder = sortOrderOffset;

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const cellA = sheet[XLSX.utils.encode_cell({ r, c: colMap.no })];
    const cellB = sheet[XLSX.utils.encode_cell({ r, c: colMap.uraian })];

    if (!cellB || !cellB.v) continue;
    const description = String(cellB.v).trim();
    if (!description) continue;

    // Check if this is a chapter header (Roman numeral in col A)
    const aVal = cellA ? String(cellA.v ?? '').trim().replace('.', '') : '';
    if (aVal && ROMAN_RE.test(aVal + '.')) {
      currentChapter = description;
      currentChapterIndex = aVal;
      currentSectionLabel = null;
      itemCounter = 0;
      continue;
    }

    // Check if this is a subtotal row
    if (/^sub\s*total/i.test(description) || /^jumlah/i.test(description)) {
      continue;
    }

    // Check if this is a sub-chapter header (text in B, no volume)
    const volumeCell = sheet[XLSX.utils.encode_cell({ r, c: colMap.volume })];
    const unitCell = sheet[XLSX.utils.encode_cell({ r, c: colMap.unit })];
    const volume = Number(volumeCell?.v ?? 0);
    const unit = unitCell ? String(unitCell.v ?? '').trim() : '';

    if (!unit && volume === 0 && description.length > 3) {
      // Sub-chapter / section header (e.g., "PEKERJAAN FISIK LANTAI 1")
      if (!currentChapter) {
        currentChapter = description;
        currentChapterIndex = aVal || 'I';
        currentSectionLabel = null;
      } else {
        currentSectionLabel = description;
      }
      continue;
    }

    // This is a work item — has unit and volume
    if (!unit) continue;

    itemCounter++;
    sortOrder++;

    const code = `${currentChapterIndex || 'I'}-${String(itemCounter).padStart(2, '0')}`;

    // Read element code (col G typically)
    const elementCodeCell = colMap.elementCode >= 0
      ? sheet[XLSX.utils.encode_cell({ r, c: colMap.elementCode })]
      : null;
    const elementCode = elementCodeCell ? String(elementCodeCell.v ?? '').trim() || null : null;

    // Read cost breakdown
    const matCost = readNumericCell(sheet, r, colMap.material);
    const laborCost = readNumericCell(sheet, r, colMap.labor);
    const equipCost = readNumericCell(sheet, r, colMap.equipment);
    const subkonCost = readNumericCell(sheet, r, colMap.subkon);
    const prelimCost = readNumericCell(sheet, r, colMap.prelim);

    // Read internal & client unit prices
    const internalUP = readNumericCell(sheet, r, colMap.internalUnitPrice);
    const clientUP = readNumericCell(sheet, r, colMap.clientUnitPrice);

    // Read composite factors for structural items
    const formworkRatio = readNumericCell(sheet, r, colMap.formworkRatio);
    const rebarRatio = readNumericCell(sheet, r, colMap.rebarRatio);
    const wiremeshRatio = readNumericCell(sheet, r, colMap.wiremeshRatio);
    const hasComposite = formworkRatio > 0 || rebarRatio > 0 || wiremeshRatio > 0;

    // Trace AHS references from formulas
    const ahsRefs = traceAhsReferences(sheet, r, colMap);
    const ahsBlockIndices = resolveAhsBlockIndices(ahsRefs, ahsRowMap);

    const linkage: AhsLinkage = { directRefs: ahsRefs, ahsBlockIndices };
    links.set(r + 1, linkage);

    // Flag zero volume items
    if (volume === 0) {
      anomalies.push({
        type: 'zero_quantity',
        severity: 'WARNING',
        sourceSheet: sheetName,
        sourceRow: r + 1,
        description: `BoQ item "${description}" has zero volume`,
        expectedValue: '> 0',
        actualValue: '0',
        context: { code, label: description },
      });
    }

    items.push({
      code,
      label: description,
      unit,
      volume,
      chapter: currentChapter,
      chapterIndex: currentChapterIndex,
      sectionLabel: currentSectionLabel,
      parentCode: null,
      sortOrder,
      elementCode,
      costBreakdown: {
        material: matCost,
        labor: laborCost,
        equipment: equipCost,
        subkon: subkonCost,
        prelim: prelimCost,
      },
      internalUnitPrice: internalUP,
      clientUnitPrice: clientUP,
      compositeFactors: hasComposite
        ? { formwork_ratio: formworkRatio, rebar_ratio: rebarRatio, wiremesh_ratio: wiremeshRatio }
        : null,
      sourceRow: r + 1,
      sourceSheet: sheetName,
      ahsReferences: ahsRefs,
    });
  }

  return { items, links };
}

function findRabHeaderRow(sheet: XLSX.WorkSheet, maxRow: number): number {
  for (let r = 0; r <= Math.min(15, maxRow); r++) {
    for (let c = 0; c <= 5; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'string' && /uraian pekerjaan/i.test(cell.v)) {
        return r;
      }
    }
  }
  return 6; // default: row 7 (0-based index 6)
}

interface RabColumnMap {
  no: number;
  uraian: number;
  unit: number;
  volume: number;
  clientUnitPrice: number;
  clientTotal: number;
  elementCode: number;
  material: number;
  labor: number;
  equipment: number;
  subkon: number;
  prelim: number;
  internalUnitPrice: number;
  internalTotal: number;
  formworkRatio: number;
  rebarRatio: number;
  wiremeshRatio: number;
  // Composite AHS reference columns (for formula tracing)
  betonMaterial: number;
  bekistingMaterial: number;
  besiMaterial: number;
}

function detectRabColumns(
  sheet: XLSX.WorkSheet,
  headerRow: number,
  maxCol: number,
): RabColumnMap {
  // Default positions based on analysis of all 3 files
  const defaults: RabColumnMap = {
    no: 0,           // A
    uraian: 1,       // B
    unit: 2,         // C (SAT)
    volume: 7,       // H (actual volume, source of truth)
    clientUnitPrice: 4, // E
    clientTotal: 5,     // F
    elementCode: 6,     // G
    material: 8,     // I
    labor: 9,        // J
    equipment: 10,   // K
    subkon: 11,      // L
    prelim: 12,      // M
    internalUnitPrice: 13, // N
    internalTotal: 14,     // O
    formworkRatio: 21,  // V
    rebarRatio: 25,     // Z
    wiremeshRatio: 28,  // AC
    betonMaterial: 17,  // R
    bekistingMaterial: 22, // W
    besiMaterial: 26,   // AA
  };

  // Try to refine by scanning header text
  for (let c = 0; c <= Math.min(maxCol, 40); c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    if (!cell) continue;
    const val = String(cell.v ?? '').toLowerCase();

    if (val === 'no' || val === 'no.') defaults.no = c;
    else if (/uraian/i.test(val)) defaults.uraian = c;
    else if (/^sat/i.test(val) && c < 5) defaults.unit = c;
  }

  return defaults;
}

function readNumericCell(sheet: XLSX.WorkSheet, row: number, col: number): number {
  if (col < 0) return 0;
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return 0;
  const val = Number(cell.v ?? 0);
  return isNaN(val) ? 0 : val;
}

// ═══════════════════════════════════════════════════════════════════════
// CROSS-SHEET REFERENCE RESOLVER
// ═══════════════════════════════════════════════════════════════════════

/**
 * Trace formula references from a RAB row to Analisa sheet.
 * Parses formulas like "Analisa!$F$96" to extract the AHS row reference.
 */
function traceAhsReferences(
  sheet: XLSX.WorkSheet,
  row: number,
  colMap: RabColumnMap,
): AhsReference[] {
  const refs: AhsReference[] = [];

  // Check material cost column (I) → direct AHS reference
  addRefIfFormula(sheet, row, colMap.material, 'material', refs);
  // Check labor cost column (J)
  addRefIfFormula(sheet, row, colMap.labor, 'labor', refs);
  // Check equipment cost column (K)
  addRefIfFormula(sheet, row, colMap.equipment, 'equipment', refs);

  // Check structural composite columns
  addRefIfFormula(sheet, row, colMap.betonMaterial, 'composite_concrete', refs);
  addRefIfFormula(sheet, row, colMap.bekistingMaterial, 'composite_formwork', refs);
  addRefIfFormula(sheet, row, colMap.besiMaterial, 'composite_rebar', refs);

  return refs;
}

function addRefIfFormula(
  sheet: XLSX.WorkSheet,
  row: number,
  col: number,
  component: AhsReference['component'],
  refs: AhsReference[],
): void {
  if (col < 0) return;
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell || !cell.f) return;

  const formula = String(cell.f);
  // Match patterns: Analisa!$F$96, Analisa!$G$150, 'Analisa'!$F$44
  const match = formula.match(/(?:'?Analisa'?!)\$?([A-Z]+)\$?(\d+)/i);
  if (match) {
    refs.push({
      component,
      ahsRow: parseInt(match[2], 10),
      column: match[1],
    });
  }
}

/**
 * Given AHS row references, resolve to AHS block indices using the jumlah row map.
 */
function resolveAhsBlockIndices(
  refs: AhsReference[],
  ahsRowMap: Map<number, number>,
): number[] {
  const indices = new Set<number>();
  for (const ref of refs) {
    // The reference might point to the jumlah row directly
    const directMatch = ahsRowMap.get(ref.ahsRow);
    if (directMatch !== undefined) {
      indices.add(directMatch);
      continue;
    }
    // Or it might point to a row within the block — find the closest jumlah row after it
    const entries = Array.from(ahsRowMap.entries());
    for (let i = 0; i < entries.length; i++) {
      const [jumlahRow, blockIdx] = entries[i];
      if (jumlahRow >= ref.ahsRow && jumlahRow - ref.ahsRow < 30) {
        indices.add(blockIdx);
        break;
      }
    }
  }
  return Array.from(indices);
}

// ═══════════════════════════════════════════════════════════════════════
// REKAP RAB — MARKUP FACTOR PARSER
// ═══════════════════════════════════════════════════════════════════════

function parseRekapMarkup(sheet: XLSX.WorkSheet): ParsedMarkupFactor[] {
  const factors: ParsedMarkupFactor[] = [];
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');

  // Markup factors are typically in column N-O of REKAP RAB, rows 2-9
  // Column N = category name, Column O = factor value
  // But layout varies — scan for numeric values > 1.0 and < 2.0 in a pattern

  for (let r = 0; r <= Math.min(20, range.e.r); r++) {
    for (let c = 10; c <= Math.min(range.e.c, 20); c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      const val = Number(cell.v ?? 0);

      // Markup factors are typically 1.10 - 1.50
      if (val >= 1.05 && val <= 2.0) {
        // Look for a category label to the left
        let category = '';
        for (let lc = c - 1; lc >= 0; lc--) {
          const labelCell = sheet[XLSX.utils.encode_cell({ r, c: lc })];
          if (labelCell && typeof labelCell.v === 'string' && labelCell.v.trim().length > 3) {
            category = String(labelCell.v).trim();
            break;
          }
        }

        if (category) {
          factors.push({
            category,
            factor: val,
            sortOrder: factors.length,
          });
        }
      }
    }
  }

  return factors;
}

// ═══════════════════════════════════════════════════════════════════════
// MATERIAL RECONCILIATION (fuzzy matching + alias resolution)
// ═══════════════════════════════════════════════════════════════════════

export interface CatalogEntry {
  code: string;
  name: string;
  category: string;
  tier: 1 | 2 | 3;
  unit: string;
  aliases: string[];
}

/**
 * Reconcile Excel material names against the material catalog.
 * Uses exact match → alias match → fuzzy match cascade.
 */
export function reconcileMaterials(
  excelMaterials: ParsedExcelMaterial[],
  catalog: CatalogEntry[],
  aliases: Map<string, string>, // alias_lower → catalog_code
): { resolved: ParsedExcelMaterial[]; unresolved: ParsedExcelMaterial[] } {
  const catalogByName = new Map(catalog.map(c => [normalize(c.name), c]));
  const catalogByCode = new Map(catalog.map(c => [c.code.toLowerCase(), c]));

  const resolved: ParsedExcelMaterial[] = [];
  const unresolved: ParsedExcelMaterial[] = [];

  for (const mat of excelMaterials) {
    const norm = normalize(mat.name);

    // 1. Exact name match
    const exact = catalogByName.get(norm);
    if (exact) {
      resolved.push({ ...mat, resolvedCode: exact.code, matchConfidence: 1.0 });
      continue;
    }

    // 2. Alias match
    const aliasCode = aliases.get(norm);
    if (aliasCode) {
      const aliasEntry = catalogByCode.get(aliasCode.toLowerCase());
      if (aliasEntry) {
        resolved.push({ ...mat, resolvedCode: aliasEntry.code, matchConfidence: 0.95 });
        continue;
      }
    }

    // 3. Fuzzy match (token overlap)
    const bestMatch = fuzzyMatch(norm, catalog);
    if (bestMatch && bestMatch.score >= 0.6) {
      resolved.push({
        ...mat,
        resolvedCode: bestMatch.entry.code,
        matchConfidence: bestMatch.score,
      });
      continue;
    }

    // Unresolved — auto-generate a deterministic code from name + spec so
    // publish succeeds. matchConfidence stays 0 so the anomaly still fires
    // and the row is flagged needs_review.
    unresolved.push({
      ...mat,
      resolvedCode: autoMaterialCode(mat.name, mat.spec),
      matchConfidence: 0,
    });
  }

  return { resolved, unresolved };
}

export function autoMaterialCode(name: string, spec?: string | null): string {
  const slug = (s: string): string =>
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const nameSlug = slug(name || 'UNKNOWN');
  const specSlug = spec ? slug(spec) : '';
  const parts = ['AUTO', nameSlug, specSlug].filter(Boolean);
  return parts.join('-').slice(0, 60);
}

function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/[()@\-\/\\'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMERIC_TOKEN = /^\d+([.,]\d+)?$/;
const FUZZY_THRESHOLD = 0.8;

function extractDimensionTokens(tokens: string[]): string[] {
  return tokens.filter(t => NUMERIC_TOKEN.test(t));
}

function fuzzyMatch(
  query: string,
  catalog: CatalogEntry[],
): { entry: CatalogEntry; score: number } | null {
  const queryTokenArr = query.split(' ').filter(t => t.length > 1);
  if (queryTokenArr.length === 0) return null;

  const queryDims = extractDimensionTokens(queryTokenArr);

  let bestScore = 0;
  let bestEntry: CatalogEntry | null = null;

  for (const entry of catalog) {
    const entryTokenArr = normalize(entry.name).split(' ').filter(t => t.length > 1);
    if (entryTokenArr.length === 0) continue;

    // Dimension guard: if query has size/grade numbers (e.g. "10 cm",
    // "8 inch", "u24"), catalog must contain every one of them. Prevents
    // "Pipa PVC 8" collapsing into a different-sized PVC entry.
    const entryDims = extractDimensionTokens(entryTokenArr);
    if (queryDims.length > 0) {
      const allPresent = queryDims.every(d => entryDims.includes(d));
      if (!allPresent) continue;
    }

    // Exact token overlap only — substring matches are too permissive
    // ("batako".includes("bata") was wrongly matching batako to bata ringan).
    let overlap = 0;
    for (const t of queryTokenArr) {
      if (entryTokenArr.includes(t)) overlap++;
    }

    // Jaccard-like score: unique tokens in union
    const allTokens = new Set([...queryTokenArr, ...entryTokenArr]);
    const score = overlap / allTokens.size;

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestEntry && bestScore >= FUZZY_THRESHOLD ? { entry: bestEntry, score: bestScore } : null;
}

// ═══════════════════════════════════════════════════════════════════════
// AI ANOMALY DETECTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Run anomaly checks across parsed data.
 * Detects: coefficient deviations, price outliers, missing components,
 * unusual waste factors, structural ratio deviations.
 */
function runAnomalyChecks(
  boqItems: ParsedBoqItem[],
  ahsBlocks: ParsedAhsBlock[],
  materials: ParsedExcelMaterial[],
  anomalies: ParsedAnomaly[],
): void {
  // 1. Check AHS coefficients against standard ranges
  for (const block of ahsBlocks) {
    for (const comp of block.components) {
      if (comp.lineType !== 'material') continue;
      checkCoefficientDeviation(block, comp, anomalies);
      checkWasteFactor(block, comp, anomalies);
    }

    // 2. Check for missing components in concrete AHS blocks
    checkMissingComponents(block, anomalies);
  }

  // 3. Check structural ratios on BoQ items
  for (const item of boqItems) {
    if (item.compositeFactors) {
      checkStructuralRatios(item, anomalies);
    }
  }

  // 4. Check for potential duplicate BoQ items
  checkDuplicateItems(boqItems, anomalies);

  // 5. Check material prices for outliers (within the same file)
  checkPriceOutliers(materials, anomalies);
}

function checkCoefficientDeviation(
  block: ParsedAhsBlock,
  comp: ParsedAhsComponent,
  anomalies: ParsedAnomaly[],
): void {
  const descLower = comp.description.toLowerCase();

  for (const [keyword, range] of Object.entries(STANDARD_COEFFICIENTS)) {
    if (!descLower.includes(keyword)) continue;

    // Strip waste factor to get base coefficient
    const baseCoeff = comp.wasteFactor > 0
      ? comp.coefficient / (1 + comp.wasteFactor)
      : comp.coefficient;

    if (baseCoeff < range.min * 0.5 || baseCoeff > range.max * 2.0) {
      anomalies.push({
        type: 'coefficient_deviation',
        severity: baseCoeff < range.min * 0.3 || baseCoeff > range.max * 3.0 ? 'HIGH' : 'WARNING',
        sourceSheet: block.sourceSheet,
        sourceRow: comp.sourceRow,
        description: `Coefficient for "${comp.description}" in "${block.title}" is ${baseCoeff.toFixed(2)} ${comp.unit}, expected ${range.min}-${range.max} ${range.unit}`,
        expectedValue: `${range.min}-${range.max} ${range.unit}`,
        actualValue: `${baseCoeff.toFixed(2)} ${comp.unit}`,
        context: {
          ahsTitle: block.title,
          materialName: comp.description,
          wasteFactor: comp.wasteFactor,
        },
      });
    }
    break;
  }
}

function checkWasteFactor(
  block: ParsedAhsBlock,
  comp: ParsedAhsComponent,
  anomalies: ParsedAnomaly[],
): void {
  if (comp.wasteFactor <= 0) return;

  if (comp.wasteFactor < WASTE_FACTOR_RANGE.min || comp.wasteFactor > WASTE_FACTOR_RANGE.max) {
    anomalies.push({
      type: 'waste_factor_unusual',
      severity: comp.wasteFactor > 0.5 ? 'HIGH' : 'WARNING',
      sourceSheet: block.sourceSheet,
      sourceRow: comp.sourceRow,
      description: `Waste factor ${(comp.wasteFactor * 100).toFixed(0)}% for "${comp.description}" in "${block.title}" is outside normal range (${WASTE_FACTOR_RANGE.min * 100}-${WASTE_FACTOR_RANGE.max * 100}%)`,
      expectedValue: `${WASTE_FACTOR_RANGE.min * 100}-${WASTE_FACTOR_RANGE.max * 100}%`,
      actualValue: `${(comp.wasteFactor * 100).toFixed(0)}%`,
      context: { ahsTitle: block.title, materialName: comp.description },
    });
  }
}

function checkMissingComponents(
  block: ParsedAhsBlock,
  anomalies: ParsedAnomaly[],
): void {
  const titleLower = block.title.toLowerCase();
  const compDescs = block.components.map(c => c.description.toLowerCase());

  // Concrete work should have: concrete, rebar/iron, and formwork
  if (/beton|cor |kolom|balok|plat|sloof|poer/i.test(titleLower)) {
    const hasConcrete = compDescs.some(d => /beton|readymix|ready mix|semen/i.test(d));
    const hasRebar = compDescs.some(d => /besi|rebar|begel|sengkang/i.test(d));

    if (!hasConcrete && block.components.length > 0) {
      anomalies.push({
        type: 'missing_component',
        severity: 'WARNING',
        sourceSheet: block.sourceSheet,
        sourceRow: block.titleRow,
        description: `AHS "${block.title}" appears to be concrete work but has no concrete/cement component`,
        expectedValue: 'Concrete/cement component',
        actualValue: 'Not found',
        context: { ahsTitle: block.title, components: compDescs.slice(0, 5) },
      });
    }
  }

  // Masonry work should have: bricks and mortar/cement
  if (/dinding|bata|pasangan/i.test(titleLower) && !/plester|acian/i.test(titleLower)) {
    const hasBricks = compDescs.some(d => /bata|batu|block/i.test(d));
    const hasMortar = compDescs.some(d => /semen|mortar|campuran/i.test(d));

    if (hasBricks && !hasMortar) {
      anomalies.push({
        type: 'missing_component',
        severity: 'INFO',
        sourceSheet: block.sourceSheet,
        sourceRow: block.titleRow,
        description: `AHS "${block.title}" has bricks but no mortar/cement binding component`,
        expectedValue: 'Mortar or cement component',
        actualValue: 'Not found',
        context: { ahsTitle: block.title },
      });
    }
  }
}

function checkStructuralRatios(
  item: ParsedBoqItem,
  anomalies: ParsedAnomaly[],
): void {
  if (!item.compositeFactors) return;

  const labelLower = item.label.toLowerCase();

  // Determine element type from label
  let elementType = '';
  if (/kolom/i.test(labelLower)) elementType = 'kolom';
  else if (/balok/i.test(labelLower)) elementType = 'balok';
  else if (/plat|slab/i.test(labelLower)) elementType = 'plat';
  else if (/sloof/i.test(labelLower)) elementType = 'sloof';
  else if (/poer|footplat|pondasi/i.test(labelLower)) elementType = 'poer';
  else if (/tangga/i.test(labelLower)) elementType = 'tangga';

  if (!elementType) return;

  // Check formwork ratio
  const fwRange = FORMWORK_RATIO_RANGES[elementType];
  if (fwRange && item.compositeFactors.formwork_ratio > 0) {
    const ratio = item.compositeFactors.formwork_ratio;
    if (ratio < fwRange.min * 0.5 || ratio > fwRange.max * 2.0) {
      anomalies.push({
        type: 'ratio_deviation',
        severity: 'WARNING',
        sourceSheet: item.sourceSheet,
        sourceRow: item.sourceRow,
        description: `Formwork ratio ${ratio.toFixed(1)} m2/m3 for "${item.label}" (${elementType}) is outside expected range ${fwRange.min}-${fwRange.max}`,
        expectedValue: `${fwRange.min}-${fwRange.max} m2/m3`,
        actualValue: `${ratio.toFixed(1)} m2/m3`,
        context: { elementType, boqCode: item.code },
      });
    }
  }

  // Check rebar ratio
  const rbRange = REBAR_RATIO_RANGES[elementType];
  if (rbRange && item.compositeFactors.rebar_ratio > 0) {
    const ratio = item.compositeFactors.rebar_ratio;
    if (ratio < rbRange.min * 0.5 || ratio > rbRange.max * 2.0) {
      anomalies.push({
        type: 'ratio_deviation',
        severity: 'WARNING',
        sourceSheet: item.sourceSheet,
        sourceRow: item.sourceRow,
        description: `Rebar ratio ${ratio.toFixed(0)} kg/m3 for "${item.label}" (${elementType}) is outside expected range ${rbRange.min}-${rbRange.max}`,
        expectedValue: `${rbRange.min}-${rbRange.max} kg/m3`,
        actualValue: `${ratio.toFixed(0)} kg/m3`,
        context: { elementType, boqCode: item.code },
      });
    }
  }
}

function checkDuplicateItems(
  items: ParsedBoqItem[],
  anomalies: ParsedAnomaly[],
): void {
  const seen = new Map<string, ParsedBoqItem>();

  for (const item of items) {
    const key = [
      normalize(item.label),
      item.unit,
      normalize(item.chapter),
      normalize(item.sectionLabel ?? ''),
    ].join('|');
    const existing = seen.get(key);

    if (existing && existing.sourceSheet === item.sourceSheet) {
      anomalies.push({
        type: 'duplicate_item',
        severity: 'INFO',
        sourceSheet: item.sourceSheet,
        sourceRow: item.sourceRow,
        description: `Potential duplicate BoQ item: "${item.label}" (${item.unit}) also appears at row ${existing.sourceRow}`,
        expectedValue: null,
        actualValue: null,
        context: {
          item1Row: existing.sourceRow,
          item2Row: item.sourceRow,
          label: item.label,
        },
      });
    }

    seen.set(key, item);
  }
}

function checkPriceOutliers(
  materials: ParsedExcelMaterial[],
  anomalies: ParsedAnomaly[],
): void {
  if (materials.length < 3) return;

  // Group by similar unit for comparison
  const byUnit = new Map<string, ParsedExcelMaterial[]>();
  for (const mat of materials) {
    if (mat.unitPrice <= 0) continue;
    const key = mat.unit.toLowerCase();
    const list = byUnit.get(key) ?? [];
    list.push(mat);
    byUnit.set(key, list);
  }

  // Check for prices that are 10x or 0.1x the median within their unit group
  const unitEntries = Array.from(byUnit.entries());
  for (let ui = 0; ui < unitEntries.length; ui++) {
    const [unit, group] = unitEntries[ui];
    if (group.length < 3) continue;
    const prices = group.map(m => m.unitPrice).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];

    for (const mat of group) {
      if (mat.unitPrice > median * 10 || mat.unitPrice < median * 0.1) {
        anomalies.push({
          type: 'price_deviation',
          severity: 'WARNING',
          sourceSheet: 'Material',
          sourceRow: mat.rowNumber,
          description: `Price for "${mat.name}" (${fmtRp(mat.unitPrice)}/${mat.unit}) deviates significantly from median (${fmtRp(median)}/${unit})`,
          expectedValue: `~${fmtRp(median)}/${unit}`,
          actualValue: `${fmtRp(mat.unitPrice)}/${unit}`,
          context: { materialName: mat.name },
        });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// STAGING CONVERSION — transforms parsed data into import_staging_rows
// ═══════════════════════════════════════════════════════════════════════

import { scoreConfidence, needsReview } from './baseline';
import type { ParsedBoqRow, ParsedAhsRow, ParsedMaterialRow } from './baseline';

/**
 * Convert parsed workbook into staging rows ready for insertion.
 * This bridges the parser output to the existing baseline.ts pipeline.
 */
export function convertToStagingRows(parsed: ParsedWorkbook): Array<{
  row_number: number;
  row_type: 'boq' | 'ahs' | 'material';
  raw_data: object;
  parsed_data: object;
  confidence: number;
  needs_review: boolean;
}> {
  const rows: Array<{
    row_number: number;
    row_type: 'boq' | 'ahs' | 'material';
    raw_data: object;
    parsed_data: object;
    confidence: number;
    needs_review: boolean;
  }> = [];

  let rowNum = 1;

  // BoQ items
  for (const item of parsed.boqItems) {
    const parsedData: ParsedBoqRow = {
      code: item.code,
      label: item.label,
      unit: item.unit,
      planned: item.volume,
    };

    const conf = scoreConfidence(
      { ...parsedData, chapter: item.chapter, volume: item.volume },
      ['code', 'label', 'unit', 'planned'],
    );

    rows.push({
      row_number: rowNum++,
      row_type: 'boq',
      raw_data: {
        sourceSheet: item.sourceSheet,
        sourceRow: item.sourceRow,
        chapter: item.chapter,
        chapterIndex: item.chapterIndex,
        sectionLabel: item.sectionLabel,
        elementCode: item.elementCode,
        costBreakdown: item.costBreakdown,
        compositeFactors: item.compositeFactors,
        internalUnitPrice: item.internalUnitPrice,
        clientUnitPrice: item.clientUnitPrice,
        ahsReferences: item.ahsReferences,
      },
      parsed_data: parsedData,
      confidence: conf,
      needs_review: needsReview(conf),
    });
  }

  const blockLinkMap = resolveAhsBlockLinks(parsed);

  // AHS lines — flatten blocks into individual component lines
  for (let blockIdx = 0; blockIdx < parsed.ahsBlocks.length; blockIdx++) {
    const block = parsed.ahsBlocks[blockIdx];
    const linkInfo = blockLinkMap.get(blockIdx) ?? {
      boqCodes: [] as string[],
      linkMethod: 'unresolved' as const,
    };
    const targetBoqCodes = linkInfo.boqCodes.length > 0 ? linkInfo.boqCodes : [''];

    for (const comp of block.components) {
      for (const boqCode of targetBoqCodes) {
        const parsedData: ParsedAhsRow = {
          boq_code: boqCode,
          material_code: null,
          material_name: comp.description,
          material_spec: null,
          tier: determineTier(comp),
          usage_rate: comp.coefficient,
          unit: comp.unit,
          waste_factor: comp.wasteFactor,
        };

        const conf = scoreConfidence(
          parsedData as unknown as Record<string, unknown>,
          ['boq_code', 'material_name', 'usage_rate', 'unit'],
        );

        rows.push({
          row_number: rowNum++,
          row_type: 'ahs',
          raw_data: {
            ahsBlockTitle: block.title,
            ahsTitleRow: block.titleRow,
            ahsJumlahRow: block.jumlahRow,
            lineType: comp.lineType,
            coefficient: comp.coefficient,
            rawCoefficient: comp.rawCoefficient,
            unitPrice: comp.unitPrice,
            subtotal: comp.subtotal,
            wasteFactor: comp.wasteFactor,
            priceRef: comp.priceRef,
            sourceRow: comp.sourceRow,
            linkMethod: linkInfo.linkMethod,
            linkedBoqCodes: linkInfo.boqCodes,
          },
          parsed_data: parsedData,
          confidence: conf,
          needs_review: needsReview(conf) || !boqCode || linkInfo.linkMethod !== 'direct',
        });
      }
    }
  }

  // Materials
  for (const mat of parsed.materials) {
    const parsedData: ParsedMaterialRow = {
      code: mat.resolvedCode ?? '',
      name: mat.name,
      category: '',
      tier: 2,
      unit: mat.unit,
      reference_unit_price: mat.unitPrice,
    };

    const conf = mat.resolvedCode
      ? mat.matchConfidence
      : scoreConfidence(
          parsedData as unknown as Record<string, unknown>,
          ['code', 'name', 'unit'],
        );

    rows.push({
      row_number: rowNum++,
      row_type: 'material',
      raw_data: {
        excelRowNumber: mat.rowNumber,
        spec: mat.spec,
        originalName: mat.name,
        resolvedCode: mat.resolvedCode,
        matchConfidence: mat.matchConfidence,
      },
      parsed_data: parsedData,
      confidence: conf,
      needs_review: needsReview(conf) || !mat.resolvedCode,
    });
  }

  return rows;
}

function determineTier(comp: ParsedAhsComponent): 1 | 2 | 3 {
  const desc = comp.description.toLowerCase();

  // Tier 1: structural, high-value
  if (/ready\s*mix|beton|besi beton|rebar|wiremesh|wire mesh|baja|wf |h-beam|hollow|atap|pipa/i.test(desc)) {
    return 1;
  }

  // Tier 3: consumables, low-value
  if (/paku|minyak|air kerja|oli|kuas|amplas|lem|selotip|tali/i.test(desc)) {
    return 3;
  }

  // Tier 2: everything else (bricks, cement, sand, plywood, etc.)
  return 2;
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER UTILITIES
// ═══════════════════════════════════════════════════════════════════════

function resolveAhsBlockLinks(parsed: ParsedWorkbook): Map<number, {
  boqCodes: string[];
  linkMethod: 'direct' | 'heuristic' | 'unresolved';
}> {
  const directMap = new Map<number, Set<string>>();

  for (const item of parsed.boqItems) {
    const linkedBlocks = parsed.rabToAhsLinks.get(item.sourceRow);
    if (!linkedBlocks) continue;
    for (const blockIdx of linkedBlocks.ahsBlockIndices) {
      const list = directMap.get(blockIdx) ?? new Set<string>();
      list.add(item.code);
      directMap.set(blockIdx, list);
    }
  }

  const result = new Map<number, {
    boqCodes: string[];
    linkMethod: 'direct' | 'heuristic' | 'unresolved';
  }>();

  for (let blockIdx = 0; blockIdx < parsed.ahsBlocks.length; blockIdx++) {
    const directCodes = Array.from(directMap.get(blockIdx) ?? []).sort();
    if (directCodes.length > 0) {
      result.set(blockIdx, {
        boqCodes: directCodes,
        linkMethod: 'direct',
      });
      continue;
    }

    const heuristicCodes = findLikelyBoqCodesForAhsBlock(parsed.ahsBlocks[blockIdx], parsed.boqItems);
    if (heuristicCodes.length > 0) {
      result.set(blockIdx, {
        boqCodes: heuristicCodes,
        linkMethod: 'heuristic',
      });
      continue;
    }

    result.set(blockIdx, {
      boqCodes: [],
      linkMethod: 'unresolved',
    });
  }

  return result;
}

function findLikelyBoqCodesForAhsBlock(
  block: ParsedAhsBlock,
  boqItems: ParsedBoqItem[],
): string[] {
  const blockTokens = buildTitleMatchTokens(block.title);
  if (blockTokens.length < 2) return [];

  let best: { code: string; score: number; shared: number } | null = null;
  let secondBestScore = 0;

  for (const item of boqItems) {
    const itemTokens = buildTitleMatchTokens([item.label, item.sectionLabel ?? ''].filter(Boolean).join(' '));
    if (itemTokens.length === 0) continue;

    const shared = countSharedTokens(blockTokens, itemTokens);
    if (shared < 2) continue;

    const score = (shared * 2) / (blockTokens.length + itemTokens.length);
    if (!best || score > best.score) {
      secondBestScore = best?.score ?? 0;
      best = { code: item.code, score, shared };
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!best) return [];
  const scoreGap = best.score - secondBestScore;
  const isStrongEnough =
    (best.shared >= 3 && best.score >= 0.32 && scoreGap >= 0.08) ||
    (best.shared >= 2 && best.score >= 0.5 && scoreGap >= 0.15);

  return isStrongEnough ? [best.code] : [];
}

function buildTitleMatchTokens(text: string): string[] {
  const stripped = normalize(text)
    .replace(/^\d+\s*(m1|m2|m3|kg|ls|bh|pcs|titik|set|unit)\b/, ' ')
    .replace(/\b(fc|slump|non|fly|ash|self|consolidating|concrete|scc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const stopwords = new Set([
    'pekerjaan', 'pasangan', 'pemasangan', 'pengecoran', 'pembetonan', 'pembesian',
    'untuk', 'dan', 'atau', 'dengan', 'yang', 'pada', 'dari', 'area', 'proyek',
    'fisik', 'sistem', 'finish', 'spesi', 'campuran',
  ]);

  const tokens = stripped
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length > 1 && !stopwords.has(token));

  return Array.from(new Set(tokens));
}

function countSharedTokens(left: string[], right: string[]): number {
  const remaining = [...right];
  let shared = 0;

  for (const token of left) {
    const matchIndex = remaining.findIndex(candidate => roughlyEqualToken(token, candidate));
    if (matchIndex >= 0) {
      shared++;
      remaining.splice(matchIndex, 1);
    }
  }
  return shared;
}

function normalizeHeaderText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function roughlyEqualToken(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length <= 2 || right.length <= 2) return false;
  if (left.includes(right) || right.includes(left)) return true;

  const maxLen = Math.max(left.length, right.length);
  const allowedDistance = maxLen >= 8 ? 2 : 1;
  return levenshteinDistance(left, right) <= allowedDistance;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    for (let j = 0; j <= right.length; j++) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function buildMaterialPriceMap(materials: ParsedExcelMaterial[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of materials) {
    map.set(normalize(m.name), m.unitPrice);
  }
  return map;
}

function buildLaborPriceMap(rates: ParsedLaborRate[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rates) {
    map.set(normalize(r.description), r.rate);
  }
  return map;
}

function fmtRp(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

// ═══════════════════════════════════════════════════════════════════════
// BOQ ITEM GROUPING — Consolidates granular items into broader categories
// ═══════════════════════════════════════════════════════════════════════

/**
 * Work type archetypes for BoQ grouping.
 * Items are classified by matching their label (then section/chapter context)
 * against these patterns. First match wins, so more specific patterns come first.
 */
const WORK_TYPE_ARCHETYPES: Array<{
  type: string;
  label: (floor: string | null) => string;
  keywords: string[];
  excludeKeywords?: string[];
}> = [
  // ── Foundation / below grade ──────────────────────────────────────
  { type: 'tiang_pancang',
    keywords: ['tiang pancang', 'bore pile', 'mini pile', 'spun pile', 'cerucuk', 'strauss pile'],
    label: () => 'Pekerjaan Tiang Pancang' },
  { type: 'pondasi',
    keywords: ['pondasi', 'pile cap', 'poer', 'tapak', 'footplate', 'foot plate', 'plat tapak', 'cakar ayam', 'pit lift'],
    label: () => 'Struktur Pondasi Beton' },
  { type: 'sloof',
    keywords: ['sloof', 'tie beam', 'balok bawah'],
    label: (f) => f ? `Sloof & Balok Pengikat ${f}` : 'Sloof & Balok Pengikat' },

  // ── Structural — floor specific ───────────────────────────────────
  { type: 'kolom',
    keywords: ['kolom', 'column', 'tiang beton'],
    excludeKeywords: ['bekist', 'besi', 'pembesian', 'tulangan'],
    label: (f) => f ? `Struktur Kolom Beton ${f}` : 'Struktur Kolom Beton' },
  { type: 'balok_plat',
    keywords: ['balok', 'plat lantai', 'pelat', 'ring balok', 'ring balk', 'shear wall', 'dinding geser',
               'konsol', 'canopy', 'kanopi', 'overtopping', 'topping', 'plat beton'],
    excludeKeywords: ['bekist', 'besi', 'pembesian', 'tulangan'],
    label: (f) => f ? `Struktur Beton ${f} (Balok dan Plat)` : 'Struktur Beton (Balok dan Plat)' },
  { type: 'tangga',
    keywords: ['tangga', 'bordes', 'stair'],
    label: (f) => f ? `Struktur Tangga ${f}` : 'Struktur Tangga' },
  { type: 'dak',
    keywords: ['dak beton', 'roof slab', 'plat atap', 'plat dak'],
    label: () => 'Struktur Dak / Plat Atap' },

  // ── Structural support work ───────────────────────────────────────
  { type: 'bekisting',
    keywords: ['bekisting', 'formwork', 'cetakan beton'],
    label: (f) => f ? `Bekisting Struktur ${f}` : 'Bekisting Struktur' },
  { type: 'pembesian',
    keywords: ['pembesian', 'tulangan', 'besi beton', 'besi ulir', 'besi polos', 'wiremesh', 'wire mesh'],
    label: (f) => f ? `Pembesian Struktur ${f}` : 'Pembesian Struktur' },
  { type: 'pengecoran',
    keywords: ['pengecoran', 'cor beton', 'ready mix', 'readymix'],
    label: (f) => f ? `Pengecoran Beton ${f}` : 'Pengecoran Beton' },

  // ── Architectural — masonry & plaster ─────────────────────────────
  { type: 'bata',
    keywords: ['pasangan bata', 'bata merah', 'batako', 'bata ringan', 'hebel',
               'dinding bata', 'pasangan dinding', 'roster', 'dinding partisi'],
    label: (f) => f ? `Pasangan Dinding ${f}` : 'Pasangan Dinding' },
  { type: 'plester',
    keywords: ['plester', 'acian', 'plesteran', 'benangan', 'tali air', 'sponengan'],
    label: (f) => f ? `Plesteran & Acian ${f}` : 'Plesteran & Acian' },

  // ── Architectural — finishes ──────────────────────────────────────
  { type: 'lantai',
    keywords: ['keramik', 'granit', 'granite', 'homogeneous', 'vinyl', 'parquet',
               'rabat beton', 'floor hardener', 'step nosing', 'lantai keramik'],
    label: (f) => f ? `Pekerjaan Lantai ${f}` : 'Pekerjaan Lantai' },
  { type: 'plafond',
    keywords: ['plafond', 'plafon', 'ceiling', 'gypsum board', 'grc board', 'kalsiboard'],
    label: (f) => f ? `Pekerjaan Plafond ${f}` : 'Pekerjaan Plafond' },
  { type: 'cat',
    keywords: ['cat tembok', 'pengecatan', 'cat kayu', 'cat besi', 'coating', 'cat dinding'],
    label: (f) => f ? `Pengecatan ${f}` : 'Pengecatan' },
  { type: 'waterproof',
    keywords: ['waterproof', 'water proof', 'membrane', 'kedap air'],
    label: (f) => f ? `Waterproofing ${f}` : 'Waterproofing' },
  { type: 'kusen',
    keywords: ['kusen', 'pintu', 'jendela', 'ventilasi', 'partisi kaca'],
    label: (f) => f ? `Kusen, Pintu & Jendela ${f}` : 'Kusen, Pintu & Jendela' },
  { type: 'sanitair',
    keywords: ['sanitair', 'kloset', 'wastafel', 'shower', 'bathtub', 'floor drain', 'closet duduk'],
    label: (f) => f ? `Perlengkapan Sanitair ${f}` : 'Perlengkapan Sanitair' },
  { type: 'railing',
    keywords: ['railing', 'railling', 'handrail', 'pegangan tangga', 'pagar besi'],
    label: (f) => f ? `Railing & Pagar ${f}` : 'Railing & Pagar' },

  // ── Roof ──────────────────────────────────────────────────────────
  { type: 'atap',
    keywords: ['atap', 'genteng', 'kuda kuda', 'kuda-kuda', 'rangka atap', 'zincalume',
               'spandek', 'reng', 'usuk', 'nok', 'lisplang', 'talang', 'bubungan'],
    label: () => 'Pekerjaan Atap & Penutup' },

  // ── Civil / earthwork ─────────────────────────────────────────────
  { type: 'galian',
    keywords: ['galian', 'buang tanah', 'bowplank', 'bouwplank', 'land clearing',
               'pembersihan lahan', 'potong tanah'],
    label: () => 'Pekerjaan Tanah & Galian' },
  { type: 'urugan',
    keywords: ['urugan', 'timbunan', 'pemadatan', 'sirtu', 'pasir urug', 'tanah urug',
               'sub base', 'base course', 'lantai kerja'],
    label: () => 'Urugan & Pematangan Tanah' },

  // ── MEP ───────────────────────────────────────────────────────────
  { type: 'mep_pipa',
    keywords: ['instalasi pipa', 'instalasi air', 'plumbing', 'air bersih', 'air kotor',
               'drainase', 'riol', 'septictank', 'septic tank', 'saluran air', 'pipa pvc', 'pipa ppr'],
    label: (f) => f ? `Instalasi Perpipaan ${f}` : 'Instalasi Perpipaan' },
  { type: 'mep_listrik',
    keywords: ['instalasi listrik', 'elektrikal', 'electrical', 'panel listrik', 'stop kontak',
               'saklar', 'titik lampu', 'grounding', 'instalasi daya'],
    label: (f) => f ? `Instalasi Elektrikal ${f}` : 'Instalasi Elektrikal' },
  { type: 'mep_ac',
    keywords: ['air conditioning', 'ac split', 'ducting ac', 'hvac'],
    label: (f) => f ? `Instalasi AC ${f}` : 'Instalasi AC' },
  { type: 'mep_fire',
    keywords: ['sprinkler', 'fire alarm', 'hydrant', 'fire protection', 'apar'],
    label: (f) => f ? `Fire Protection ${f}` : 'Fire Protection' },
];

/**
 * Umbrella chapters whose items should always stay together regardless of
 * individual label keywords. Without this override, items like "bowplank"
 * (keyword: galian) or "pengukuran titik bore pile" (keyword: tiang_pancang)
 * get pulled out of their Pekerjaan Persiapan chapter into the wrong group.
 */
const UMBRELLA_CHAPTER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /pekerjaan\s+persiapan|preliminaries|prelim/i, label: 'Pekerjaan Persiapan' },
  { pattern: /pekerjaan\s+(tanah|galian)/i, label: 'Pekerjaan Tanah & Galian' },
];

/**
 * Classify a BoQ item into a freeform group label + floor level.
 *
 * Strategy:
 *   1. Chapter override — umbrella chapters (Pekerjaan Persiapan, Tanah)
 *      keep all items together
 *   2. Match label against known work-type archetypes
 *   3. Match section/chapter context against archetypes
 *   4. Chapter-name fallback so every item lands in *some* bucket
 */
function classifyBoqItem(item: ParsedBoqItem): BoqClassification {
  const labelLower = normalize(item.label);
  const floor = extractFloorFromBoqContext(item);

  // 1. Umbrella chapter override — forces everything in prelim/earthwork
  //    chapters into a single canonical group before archetype matching.
  const chapterRaw = item.chapter || '';
  for (const umbrella of UMBRELLA_CHAPTER_PATTERNS) {
    if (umbrella.pattern.test(chapterRaw)) {
      return { group: umbrella.label, floor };
    }
  }

  // 2. Primary: match label directly
  for (const arch of WORK_TYPE_ARCHETYPES) {
    if (!arch.keywords.some(kw => labelLower.includes(kw))) continue;
    if (arch.excludeKeywords?.some(kw => labelLower.includes(kw))) continue;
    return { group: arch.label(floor), floor };
  }

  // 3. Fallback: match against section + chapter context
  const contextLower = normalize(
    [item.label, item.sectionLabel ?? '', item.chapter].join(' '),
  );
  for (const arch of WORK_TYPE_ARCHETYPES) {
    if (!arch.keywords.some(kw => contextLower.includes(kw))) continue;
    if (arch.excludeKeywords?.some(kw => contextLower.includes(kw))) continue;
    return { group: arch.label(floor), floor };
  }

  // 4. Last-resort fallback: chapter name so same-chapter items still group
  const chapterLabel = chapterRaw.trim() || 'Pekerjaan Lainnya';
  const group = floor && !chapterLabel.toLowerCase().includes('lantai')
    ? `${chapterLabel} ${floor}`
    : chapterLabel;
  return { group, floor };
}

/**
 * Extract floor level from a BoQ item's label, section, chapter, or sheet name.
 * Reuses the existing extractFloorContext() helper.
 */
function extractFloorFromBoqContext(item: ParsedBoqItem): string | null {
  for (const src of [item.label, item.sectionLabel ?? '', item.chapter, item.sourceSheet]) {
    if (!src) continue;
    const floor = extractFloorContext(src);
    if (floor) return floor;
  }
  return null;
}

/**
 * Consolidate granular BoQ items (e.g. "Pondasi PC1", "Pondasi PC2") into
 * broader work-type categories (e.g. "Struktur Pondasi Beton").
 *
 * Grouping key: work type + floor level + unit.
 * Single-item groups are kept as-is.
 *
 * Returns the grouped items and a mapping from each group's sourceRow to
 * all original sourceRows (needed to update rabToAhsLinks).
 */
export interface BoqClassification {
  /** Freeform group label like "Pekerjaan Persiapan" or "Struktur Kolom Beton Lantai 1". */
  group: string;
  /** Floor context (for display/sorting only — label may already embed it). */
  floor: string | null;
}

/**
 * Group BoQ items using either AI-provided or keyword-based classifications.
 *
 * @param items           Raw parsed BoQ items
 * @param aiClassifications  Optional map of item index → AI classification.
 *                           If provided, overrides keyword classification.
 *                           Items not in the map fall back to keyword matching.
 */
export function groupBoqItems(
  items: ParsedBoqItem[],
  aiClassifications?: Map<number, BoqClassification>,
): {
  grouped: ParsedBoqItem[];
  sourceRowMapping: Map<number, number[]>;
} {
  // 1. Classify each item (AI-first, keyword fallback)
  const classified = items.map((item, idx) => ({
    item,
    cls: aiClassifications?.get(idx) ?? classifyBoqItem(item),
  }));

  // 2. Group purely by freeform group label — unit heterogeneity is handled below
  const groups = new Map<string, typeof classified>();
  for (const entry of classified) {
    const key = entry.cls.group;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  // 3. Build aggregate items
  const result: ParsedBoqItem[] = [];
  const sourceRowMapping = new Map<number, number[]>();
  const chapterCounters = new Map<string, number>();

  for (const [groupLabel, group] of groups) {
    // Single-item groups: keep the original item unchanged
    if (group.length === 1) {
      result.push(group[0].item);
      continue;
    }

    const firstItem = group[0].item;

    // ── Code ──────────────────────────────────────────────────────
    const chapterIdx = firstItem.chapterIndex || 'I';
    const counter = (chapterCounters.get(chapterIdx) ?? 0) + 1;
    chapterCounters.set(chapterIdx, counter);
    const code = `${chapterIdx}-G${String(counter).padStart(2, '0')}`;

    // ── Unit reconciliation ──────────────────────────────────────
    // If every sub-item shares one unit, preserve it and sum volumes.
    // Otherwise, collapse to "paket" with volume=1 — this preserves
    // total cost while avoiding physically meaningless sums.
    const units = new Set(group.map(e => e.item.unit.trim()));
    const homogeneousUnit = units.size === 1 ? [...units][0] : null;
    const unit = homogeneousUnit ?? 'paket';
    const totalVolume = homogeneousUnit
      ? group.reduce((s, e) => s + e.item.volume, 0)
      : 1;

    // ── Cost aggregation (always sums regardless of unit) ────────
    const totalCost = {
      material: group.reduce((s, e) => s + e.item.costBreakdown.material, 0),
      labor: group.reduce((s, e) => s + e.item.costBreakdown.labor, 0),
      equipment: group.reduce((s, e) => s + e.item.costBreakdown.equipment, 0),
      subkon: group.reduce((s, e) => s + e.item.costBreakdown.subkon, 0),
      prelim: group.reduce((s, e) => s + e.item.costBreakdown.prelim, 0),
    };

    const allAhsRefs = group.flatMap(e => e.item.ahsReferences);

    // Composite factors only meaningful when unit is preserved
    const withComposite = group.filter(e => e.item.compositeFactors);
    const avgComposite = homogeneousUnit && withComposite.length > 0
      ? {
          formwork_ratio: withComposite.reduce((s, e) => s + (e.item.compositeFactors!.formwork_ratio), 0) / withComposite.length,
          rebar_ratio: withComposite.reduce((s, e) => s + (e.item.compositeFactors!.rebar_ratio), 0) / withComposite.length,
          wiremesh_ratio: withComposite.reduce((s, e) => s + (e.item.compositeFactors!.wiremesh_ratio), 0) / withComposite.length,
        }
      : null;

    const totalInternalValue = group.reduce((s, e) => s + e.item.internalUnitPrice * e.item.volume, 0);
    const totalClientValue = group.reduce((s, e) => s + e.item.clientUnitPrice * e.item.volume, 0);

    // ── Source row tracking ───────────────────────────────────────
    const minSourceRow = Math.min(...group.map(e => e.item.sourceRow));
    sourceRowMapping.set(minSourceRow, group.map(e => e.item.sourceRow));

    // ── Section detail (list of original items) ──────────────────
    const subLabels = group.map(e => e.item.label.split('—')[0].trim());
    const sectionDetail = subLabels.length <= 5
      ? subLabels.join(', ')
      : `${subLabels.slice(0, 4).join(', ')} (+${subLabels.length - 4} lainnya)`;

    result.push({
      code,
      label: groupLabel,
      unit,
      volume: totalVolume,
      chapter: firstItem.chapter,
      chapterIndex: chapterIdx,
      sectionLabel: sectionDetail,
      parentCode: null,
      sortOrder: Math.min(...group.map(e => e.item.sortOrder)),
      elementCode: null,
      costBreakdown: totalCost,
      internalUnitPrice: totalVolume > 0 ? totalInternalValue / totalVolume : 0,
      clientUnitPrice: totalVolume > 0 ? totalClientValue / totalVolume : 0,
      compositeFactors: avgComposite,
      sourceRow: minSourceRow,
      sourceSheet: firstItem.sourceSheet,
      ahsReferences: allAhsRefs,
    });
  }

  // Sort by chapter index, then by sortOrder
  result.sort((a, b) => a.sortOrder - b.sortOrder);

  return { grouped: result, sourceRowMapping };
}

/**
 * Apply BoQ grouping to a parsed workbook in place.
 * Handles both item consolidation and rabToAhsLinks remapping.
 *
 * @param parsed              The parsed workbook to modify
 * @param aiClassifications   Optional AI-provided classifications (index → type+floor).
 *                            If omitted, uses keyword-based classification.
 */
export function applyBoqGrouping(
  parsed: ParsedWorkbook,
  aiClassifications?: Map<number, BoqClassification>,
): void {
  const { grouped, sourceRowMapping } = groupBoqItems(parsed.boqItems, aiClassifications);
  parsed.boqItems.length = 0;
  parsed.boqItems.push(...grouped);

  // Merge sub-items' AHS links into the group item's sourceRow
  for (const [groupRow, originalRows] of sourceRowMapping) {
    const mergedRefs: AhsReference[] = [];
    const mergedIndices = new Set<number>();
    for (const origRow of originalRows) {
      const link = parsed.rabToAhsLinks.get(origRow);
      if (link) {
        mergedRefs.push(...link.directRefs);
        link.ahsBlockIndices.forEach(idx => mergedIndices.add(idx));
        if (origRow !== groupRow) parsed.rabToAhsLinks.delete(origRow);
      }
    }
    if (mergedRefs.length > 0 || mergedIndices.size > 0) {
      parsed.rabToAhsLinks.set(groupRow, {
        directRefs: mergedRefs,
        ahsBlockIndices: Array.from(mergedIndices),
      });
    }
  }
}

/** Valid work type codes for AI classification (exported for prompt construction). */
export const BOQ_WORK_TYPES = WORK_TYPE_ARCHETYPES.map(a => a.type);

/** Get the display label for a work type + floor combination. */
export function getWorkTypeLabel(type: string, floor: string | null): string {
  const arch = WORK_TYPE_ARCHETYPES.find(a => a.type === type);
  return arch
    ? arch.label(floor)
    : `Pekerjaan Lainnya${floor ? ` ${floor}` : ''}`;
}
