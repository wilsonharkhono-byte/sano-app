"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { newObj[key] = obj[key]; } } } newObj.default = obj; return newObj; } } function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }// SANO — Excel BoQ Parser Engine
// Parses real Indonesian construction RAB (Rencana Anggaran Biaya) workbooks.
// Handles: RAB sheets (BoQ), Analisa (AHS), Material price list, Upah (labor rates).
// Includes AI anomaly detection for coefficient/price deviations.

var _xlsx = require('xlsx'); var XLSX = _interopRequireWildcard(_xlsx);






// ═══════════════════════════════════════════════════════════════════════
// PARSED OUTPUT TYPES
// ═══════════════════════════════════════════════════════════════════════





































































































































// ═══════════════════════════════════════════════════════════════════════
// STANDARD REFERENCE DATA (for AI anomaly detection)
// ═══════════════════════════════════════════════════════════════════════

/** Standard coefficient ranges for common AHS components (per m2 or per m3) */
const STANDARD_COEFFICIENTS = {
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
const FORMWORK_RATIO_RANGES = {
  kolom: { min: 5.0, max: 9.0 },
  balok: { min: 5.5, max: 10.0 },
  plat: { min: 3.0, max: 6.0 },
  sloof: { min: 4.0, max: 8.0 },
  poer: { min: 3.0, max: 6.0 },
  tangga: { min: 6.0, max: 12.0 },
};

/** Standard rebar ratios (kg rebar per m3 concrete) by element type */
const REBAR_RATIO_RANGES = {
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
 function parseBoqWorkbook(
  fileInput,
  fileName,
) {
  const workbook = typeof fileInput === 'string'
    ? XLSX.readFile(fileInput, { cellFormula: true, cellNF: true })
    : XLSX.read(fileInput, { cellFormula: true, cellNF: true });

  const sheetNames = workbook.SheetNames;

  // Classify sheets
  const rabSheets = sheetNames.filter(n =>
    /^RAB\s*\(/i.test(n) || /^RAB$/i.test(n),
  );
  const ahsSheet = _nullishCoalesce(sheetNames.find(n => /analisa/i.test(n)), () => ( null));
  const materialSheet = _nullishCoalesce(sheetNames.find(n => /^material$/i.test(n)), () => ( null));
  const upahSheet = _nullishCoalesce(sheetNames.find(n => /^upah$/i.test(n)), () => ( null));
  const rekapSheet = _nullishCoalesce(sheetNames.find(n => /^REKAP\s+RAB$/i.test(n)), () => ( null));

  const projectInfo = {
    fileName,
    sheetNames,
    rabSheets,
    ahsSheet,
    materialSheet,
    upahSheet,
  };

  const anomalies = [];

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
  const ahsBlocks = [];
  const ahsRowMap = new Map();
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
  const markupFactors = rekapSheet
    ? parseRekapMarkup(workbook.Sheets[rekapSheet])
    : [];

  // 4. Parse RAB sheets (BoQ items) with formula tracing
  const boqItems = [];
  const rabToAhsLinks = new Map();
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

  // 5. Run AI anomaly checks on the complete parsed data
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
} exports.parseBoqWorkbook = parseBoqWorkbook;

// ═══════════════════════════════════════════════════════════════════════
// MATERIAL SHEET PARSER
// ═══════════════════════════════════════════════════════════════════════

function parseMaterialSheet(
  sheet,
  sheetName,
) {
  const results = [];
  const range = XLSX.utils.decode_range(_nullishCoalesce(sheet['!ref'], () => ( 'A1')));

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

    const name = String(nameCell.v).trim();
    if (!name || name.length < 2) continue;

    const specCell = colMap.spec >= 0
      ? sheet[XLSX.utils.encode_cell({ r, c: colMap.spec })]
      : null;
    const unitCell = sheet[XLSX.utils.encode_cell({ r, c: colMap.unit })];
    const priceCell = sheet[XLSX.utils.encode_cell({ r, c: colMap.price })];

    results.push({
      rowNumber: r + 1,
      name,
      spec: specCell ? String(_nullishCoalesce(specCell.v, () => ( ''))).trim() || null : null,
      unit: unitCell ? String(_nullishCoalesce(unitCell.v, () => ( ''))).trim() : '',
      unitPrice: priceCell ? Number(_nullishCoalesce(priceCell.v, () => ( 0))) : 0,
      resolvedCode: null,
      matchConfidence: 0,
    });
  }

  return results;
}

function detectMaterialColumns(
  sheet,
  headerRow,
  maxCol,
) {
  let name = 1; // default B
  let spec = -1;
  let unit = 5; // default F
  let price = 6; // default G

  for (let c = 0; c <= maxCol; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    if (!cell) continue;
    const rawVal = String(_nullishCoalesce(cell.v, () => ( '')));
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
  sheet,
  sheetName,
) {
  const results = [];
  const range = XLSX.utils.decode_range(_nullishCoalesce(sheet['!ref'], () => ( 'A1')));

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
    const val = String(_nullishCoalesce(cell.v, () => ( ''))).toLowerCase();
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
      unit: unitCell ? String(_nullishCoalesce(unitCell.v, () => ( ''))).trim() : '',
      rate: rateCell ? Number(_nullishCoalesce(rateCell.v, () => ( 0))) : 0,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// ANALISA (AHS) SHEET PARSER
// ═══════════════════════════════════════════════════════════════════════





function parseAnalisaSheet(
  sheet,
  sheetName,
  materialPriceMap,
  laborPriceMap,
  anomalies,
) {
  const blocks = [];
  const range = XLSX.utils.decode_range(_nullishCoalesce(sheet['!ref'], () => ( 'A1')));

  // AHS blocks are sequential, separated by blank rows.
  // Block structure:
  //   Title row: col B has the analysis title (e.g., "1 m2 Bekisting Bata Merah...")
  //   Component rows: col B=coefficient, C=unit, D=description, E=unit price, F=mat subtotal, G=labor subtotal, H=equip subtotal
  //   Jumlah row: col E="Jumlah", F=SUM(F), G=SUM(G), H=SUM(H), I=total

  let currentBlock



 = null;

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
            material: Number(_nullishCoalesce(_optionalChain([cellF, 'optionalAccess', _2 => _2.v]), () => ( 0))),
            labor: Number(_nullishCoalesce(_optionalChain([cellG, 'optionalAccess', _3 => _3.v]), () => ( 0))),
            equipment: Number(_nullishCoalesce(_optionalChain([cellH, 'optionalAccess', _4 => _4.v]), () => ( 0))),
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
      const coeff = Number(_nullishCoalesce(cellB.v, () => ( 0)));
      if (coeff === 0 && typeof cellB.v !== 'number') continue;

      const cellC = sheet[XLSX.utils.encode_cell({ r, c: 2 })];
      const cellF = sheet[XLSX.utils.encode_cell({ r, c: 5 })];
      const cellG = sheet[XLSX.utils.encode_cell({ r, c: 6 })];
      const cellH = sheet[XLSX.utils.encode_cell({ r, c: 7 })];

      const description = String(_nullishCoalesce(cellD.v, () => ( ''))).trim();
      const unitPrice = Number(_nullishCoalesce(_optionalChain([cellE, 'optionalAccess', _5 => _5.v]), () => ( 0)));
      const matSubtotal = Number(_nullishCoalesce(_optionalChain([cellF, 'optionalAccess', _6 => _6.v]), () => ( 0)));
      const laborSubtotal = Number(_nullishCoalesce(_optionalChain([cellG, 'optionalAccess', _7 => _7.v]), () => ( 0)));
      const equipSubtotal = Number(_nullishCoalesce(_optionalChain([cellH, 'optionalAccess', _8 => _8.v]), () => ( 0)));

      // Determine line type from which subtotal column has a value
      let lineType = 'material';
      if (laborSubtotal > 0 && matSubtotal === 0) lineType = 'labor';
      else if (equipSubtotal > 0 && matSubtotal === 0 && laborSubtotal === 0) lineType = 'equipment';

      // Also check description keywords for labor detection
      if (lineType === 'material' && isLaborDescription(description)) {
        lineType = 'labor';
      }

      // Parse waste factor from formula if coefficient cell has a formula like "=0.3*1.2"
      const wasteFactor = extractWasteFactor(cellB);

      // Get price reference (formula pointing to Material! or Upah!)
      const priceRef = _optionalChain([cellE, 'optionalAccess', _9 => _9.f]) ? String(cellE.f) : null;

      currentBlock.components.push({
        coefficient: Math.abs(coeff),
        rawCoefficient: cellB.f ? String(cellB.f) : String(coeff),
        unit: cellC ? String(_nullishCoalesce(cellC.v, () => ( ''))).trim() : '',
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

function findAhsStartRow(sheet, maxRow) {
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

function isAhsTitleRow(text) {
  // AHS titles typically start with "1 m2 ...", "1 m3 ...", "1 m1 ...", "1 kg ...", etc.
  return /^\d+\s*(m[123]|kg|ls|bh|pcs|titik|set|unit)\s+/i.test(text.trim())
    || /^(pekerjaan|pasangan|pemasangan|pengecoran|pembetonan|pembesian)/i.test(text.trim());
}

function isLaborDescription(desc) {
  const laborKeywords = [
    'tukang', 'pekerja', 'mandor', 'kepala tukang',
    'upah', 'borongan', 'tenaga', 'buruh',
    'pasang', 'cor ', 'pengecoran',
  ];
  const lower = desc.toLowerCase();
  return laborKeywords.some(kw => lower.includes(kw));
}

function extractWasteFactor(cell) {
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






/** Roman numeral detection */
const ROMAN_RE = /^(I{1,3}|IV|VI{0,3}|IX|X{0,3}I{0,3}|X{0,3}V?I{0,3})\.?\s*$/;
const ROMAN_MAP = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9,
  X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15,
};

function parseRabSheet(
  sheet,
  sheetName,
  ahsRowMap,
  ahsBlocks,
  sortOrderOffset,
  anomalies,
) {
  const items = [];
  const links = new Map();
  const range = XLSX.utils.decode_range(_nullishCoalesce(sheet['!ref'], () => ( 'A1')));

  // RAB header is always row 7 (0-based index 6)
  const headerRow = findRabHeaderRow(sheet, range.e.r);
  const colMap = detectRabColumns(sheet, headerRow, range.e.c);

  let currentChapter = '';
  let currentChapterIndex = '';
  let currentSectionLabel = null;
  let itemCounter = 0;
  let sortOrder = sortOrderOffset;

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const cellA = sheet[XLSX.utils.encode_cell({ r, c: colMap.no })];
    const cellB = sheet[XLSX.utils.encode_cell({ r, c: colMap.uraian })];

    if (!cellB || !cellB.v) continue;
    const description = String(cellB.v).trim();
    if (!description) continue;

    // Check if this is a chapter header (Roman numeral in col A)
    const aVal = cellA ? String(_nullishCoalesce(cellA.v, () => ( ''))).trim().replace('.', '') : '';
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
    const volume = Number(_nullishCoalesce(_optionalChain([volumeCell, 'optionalAccess', _10 => _10.v]), () => ( 0)));
    const unit = unitCell ? String(_nullishCoalesce(unitCell.v, () => ( ''))).trim() : '';

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
    const elementCode = elementCodeCell ? String(_nullishCoalesce(elementCodeCell.v, () => ( ''))).trim() || null : null;

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

    const linkage = { directRefs: ahsRefs, ahsBlockIndices };
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

function findRabHeaderRow(sheet, maxRow) {
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

























function detectRabColumns(
  sheet,
  headerRow,
  maxCol,
) {
  // Default positions based on analysis of all 3 files
  const defaults = {
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
    const val = String(_nullishCoalesce(cell.v, () => ( ''))).toLowerCase();

    if (val === 'no' || val === 'no.') defaults.no = c;
    else if (/uraian/i.test(val)) defaults.uraian = c;
    else if (/^sat/i.test(val) && c < 5) defaults.unit = c;
  }

  return defaults;
}

function readNumericCell(sheet, row, col) {
  if (col < 0) return 0;
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return 0;
  const val = Number(_nullishCoalesce(cell.v, () => ( 0)));
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
  sheet,
  row,
  colMap,
) {
  const refs = [];

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
  sheet,
  row,
  col,
  component,
  refs,
) {
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
  refs,
  ahsRowMap,
) {
  const indices = new Set();
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

function parseRekapMarkup(sheet) {
  const factors = [];
  const range = XLSX.utils.decode_range(_nullishCoalesce(sheet['!ref'], () => ( 'A1')));

  // Markup factors are typically in column N-O of REKAP RAB, rows 2-9
  // Column N = category name, Column O = factor value
  // But layout varies — scan for numeric values > 1.0 and < 2.0 in a pattern

  for (let r = 0; r <= Math.min(20, range.e.r); r++) {
    for (let c = 10; c <= Math.min(range.e.c, 20); c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      const val = Number(_nullishCoalesce(cell.v, () => ( 0)));

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










/**
 * Reconcile Excel material names against the material catalog.
 * Uses exact match → alias match → fuzzy match cascade.
 */
 function reconcileMaterials(
  excelMaterials,
  catalog,
  aliases, // alias_lower → catalog_code
) {
  const catalogByName = new Map(catalog.map(c => [normalize(c.name), c]));
  const catalogByCode = new Map(catalog.map(c => [c.code.toLowerCase(), c]));

  const resolved = [];
  const unresolved = [];

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

    // Unresolved
    unresolved.push({ ...mat, resolvedCode: null, matchConfidence: 0 });
  }

  return { resolved, unresolved };
} exports.reconcileMaterials = reconcileMaterials;

function normalize(s) {
  return s.toLowerCase()
    .replace(/[()@\-\/\\'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fuzzyMatch(
  query,
  catalog,
) {
  const queryTokenArr = query.split(' ').filter(t => t.length > 1);
  if (queryTokenArr.length === 0) return null;

  let bestScore = 0;
  let bestEntry = null;

  for (const entry of catalog) {
    const entryTokenArr = normalize(entry.name).split(' ').filter(t => t.length > 1);
    if (entryTokenArr.length === 0) continue;

    // Count overlapping tokens
    let overlap = 0;
    for (let qi = 0; qi < queryTokenArr.length; qi++) {
      const t = queryTokenArr[qi];
      for (let ei = 0; ei < entryTokenArr.length; ei++) {
        const et = entryTokenArr[ei];
        if (t === et || t.includes(et) || et.includes(t)) {
          overlap++;
          break;
        }
      }
    }

    // Jaccard-like score: unique tokens in union
    const allTokens = [];
    queryTokenArr.forEach(t => { if (allTokens.indexOf(t) < 0) allTokens.push(t); });
    entryTokenArr.forEach(t => { if (allTokens.indexOf(t) < 0) allTokens.push(t); });
    const score = overlap / allTokens.length;

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestEntry ? { entry: bestEntry, score: bestScore } : null;
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
  boqItems,
  ahsBlocks,
  materials,
  anomalies,
) {
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
  block,
  comp,
  anomalies,
) {
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
  block,
  comp,
  anomalies,
) {
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
  block,
  anomalies,
) {
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
  item,
  anomalies,
) {
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
  items,
  anomalies,
) {
  const seen = new Map();

  for (const item of items) {
    const key = [
      normalize(item.label),
      item.unit,
      normalize(item.chapter),
      normalize(_nullishCoalesce(item.sectionLabel, () => ( ''))),
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
  materials,
  anomalies,
) {
  if (materials.length < 3) return;

  // Group by similar unit for comparison
  const byUnit = new Map();
  for (const mat of materials) {
    if (mat.unitPrice <= 0) continue;
    const key = mat.unit.toLowerCase();
    const list = _nullishCoalesce(byUnit.get(key), () => ( []));
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

function scoreConfidence(parsed, requiredKeys) {
  if (!parsed) return 0;
  let filled = 0;
  for (const key of requiredKeys) {
    const val = parsed[key];
    if (val !== null && val !== undefined && val !== '') filled++;
  }
  return requiredKeys.length > 0 ? filled / requiredKeys.length : 0;
}
const REVIEW_THRESHOLD = 0.7;
function needsReview(confidence) {
  return confidence < REVIEW_THRESHOLD;
}

/**
 * Convert parsed workbook into staging rows ready for insertion.
 * This bridges the parser output to the existing baseline.ts pipeline.
 */
 function convertToStagingRows(parsed)






 {
  const rows






 = [];

  let rowNum = 1;

  // BoQ items
  for (const item of parsed.boqItems) {
    const parsedData = {
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
    const linkInfo = _nullishCoalesce(blockLinkMap.get(blockIdx), () => ( {
      boqCodes: [] ,
      linkMethod: 'unresolved' ,
    }));
    const targetBoqCodes = linkInfo.boqCodes.length > 0 ? linkInfo.boqCodes : [''];

    for (const comp of block.components) {
      for (const boqCode of targetBoqCodes) {
        const parsedData = {
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
          parsedData ,
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
    const parsedData = {
      code: _nullishCoalesce(mat.resolvedCode, () => ( '')),
      name: mat.name,
      category: '',
      tier: 2,
      unit: mat.unit,
      reference_unit_price: mat.unitPrice,
    };

    const conf = mat.resolvedCode
      ? mat.matchConfidence
      : scoreConfidence(
          parsedData ,
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
} exports.convertToStagingRows = convertToStagingRows;

function determineTier(comp) {
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

function resolveAhsBlockLinks(parsed)


 {
  const directMap = new Map();

  for (const item of parsed.boqItems) {
    const linkedBlocks = parsed.rabToAhsLinks.get(item.sourceRow);
    if (!linkedBlocks) continue;
    for (const blockIdx of linkedBlocks.ahsBlockIndices) {
      const list = _nullishCoalesce(directMap.get(blockIdx), () => ( new Set()));
      list.add(item.code);
      directMap.set(blockIdx, list);
    }
  }

  const result = new Map


();

  for (let blockIdx = 0; blockIdx < parsed.ahsBlocks.length; blockIdx++) {
    const directCodes = Array.from(_nullishCoalesce(directMap.get(blockIdx), () => ( []))).sort();
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
  block,
  boqItems,
) {
  const blockTokens = buildTitleMatchTokens(block.title);
  if (blockTokens.length < 2) return [];

  let best = null;
  let secondBestScore = 0;

  for (const item of boqItems) {
    const itemTokens = buildTitleMatchTokens([item.label, _nullishCoalesce(item.sectionLabel, () => ( ''))].filter(Boolean).join(' '));
    if (itemTokens.length === 0) continue;

    const shared = countSharedTokens(blockTokens, itemTokens);
    if (shared < 2) continue;

    const score = (shared * 2) / (blockTokens.length + itemTokens.length);
    if (!best || score > best.score) {
      secondBestScore = _nullishCoalesce(_optionalChain([best, 'optionalAccess', _11 => _11.score]), () => ( 0));
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

function buildTitleMatchTokens(text) {
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

function countSharedTokens(left, right) {
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

function normalizeHeaderText(text) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function roughlyEqualToken(left, right) {
  if (left === right) return true;
  if (left.length <= 2 || right.length <= 2) return false;
  if (left.includes(right) || right.includes(left)) return true;

  const maxLen = Math.max(left.length, right.length);
  const allowedDistance = maxLen >= 8 ? 2 : 1;
  return levenshteinDistance(left, right) <= allowedDistance;
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

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

function buildMaterialPriceMap(materials) {
  const map = new Map();
  for (const m of materials) {
    map.set(normalize(m.name), m.unitPrice);
  }
  return map;
}

function buildLaborPriceMap(rates) {
  const map = new Map();
  for (const r of rates) {
    map.set(normalize(r.description), r.rate);
  }
  return map;
}

function fmtRp(n) {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}
