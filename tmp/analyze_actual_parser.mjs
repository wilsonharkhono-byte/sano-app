import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'sucrase';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const scriptDir = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const repoRoot = path.resolve(scriptDir, '..');
const parserPath = path.join(repoRoot, 'tools', 'excelParser.ts');
const parserSource = fs.readFileSync(parserPath, 'utf8');

const baselineImport = `import { scoreConfidence, needsReview } from './baseline';
import type { ParsedBoqRow, ParsedAhsRow, ParsedMaterialRow } from './baseline';`;

const baselineStub = `function scoreConfidence(parsed, requiredKeys) {
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
}`;

const patchedSource = parserSource.replace(baselineImport, baselineStub);
const transformed = transform(patchedSource, {
  transforms: ['typescript', 'imports'],
});

const compiledPath = path.join(repoRoot, 'tmp', '__excelParser_eval.cjs');
fs.writeFileSync(compiledPath, transformed.code, 'utf8');

const parser = require(compiledPath);

function getArrayBuffer(filePath) {
  const buffer = fs.readFileSync(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function findHeaderRow(sheet, maxRow) {
  for (let r = 0; r <= Math.min(15, maxRow); r++) {
    for (let c = 0; c <= 5; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'string' && /uraian pekerjaan/i.test(cell.v)) {
        return r;
      }
    }
  }
  return 6;
}

function inspectRawWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath, { cellFormula: true, cellNF: true });
  const rabSheets = workbook.SheetNames.filter(name => /^RAB\s*\(/i.test(name) || /^RAB$/i.test(name));
  const ahsSheet = workbook.SheetNames.find(name => /analisa/i.test(name)) ?? null;
  const materialSheet = workbook.SheetNames.find(name => /^material$/i.test(name)) ?? null;

  const rawBoqBySheet = {};
  let rawBoqCount = 0;
  for (const sheetName of rabSheets) {
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
    const headerRow = findHeaderRow(sheet, range.e.r);
    let count = 0;

    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const cellA = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
      const cellB = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
      const cellC = sheet[XLSX.utils.encode_cell({ r, c: 2 })];
      const cellH = sheet[XLSX.utils.encode_cell({ r, c: 7 })];
      if (!cellB || !cellB.v) continue;
      const description = String(cellB.v).trim();
      if (!description) continue;
      const aVal = cellA ? String(cellA.v ?? '').trim().replace('.', '') : '';
      if (aVal && /^(I{1,3}|IV|VI{0,3}|IX|X{0,3}I{0,3}|X{0,3}V?I{0,3})$/i.test(aVal)) continue;
      if (/^sub\s*total/i.test(description) || /^jumlah/i.test(description)) continue;
      const unit = cellC ? String(cellC.v ?? '').trim() : '';
      const volume = Number(cellH?.v ?? 0);
      if (!unit) continue;
      if (!unit && volume === 0) continue;
      count++;
    }

    rawBoqBySheet[sheetName] = count;
    rawBoqCount += count;
  }

  let rawAhsBlockCount = 0;
  if (ahsSheet) {
    const sheet = workbook.Sheets[ahsSheet];
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
    let currentBlock = false;
    for (let r = 9; r <= range.e.r; r++) {
      const cellB = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
      const cellD = sheet[XLSX.utils.encode_cell({ r, c: 3 })];
      const cellE = sheet[XLSX.utils.encode_cell({ r, c: 4 })];

      if (cellE && typeof cellE.v === 'string' && /jumlah/i.test(String(cellE.v))) {
        if (currentBlock) {
          rawAhsBlockCount++;
          currentBlock = false;
        }
        continue;
      }

      if (cellB && !cellD) {
        const text = String(cellB.v ?? '').trim();
        if (text.length > 5 && (/^\d+\s*(m[123]|kg|ls|bh|pcs|titik|set|unit)\s+/i.test(text) || /^(pekerjaan|pasangan|pemasangan|pengecoran|pembetonan|pembesian)/i.test(text))) {
          currentBlock = true;
        }
      }
    }
  }

  let rawMaterialCount = 0;
  if (materialSheet) {
    const sheet = workbook.Sheets[materialSheet];
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
    for (let r = 5; r <= range.e.r; r++) {
      const nameCell = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
      if (!nameCell || !nameCell.v) continue;
      const name = String(nameCell.v).trim();
      if (!name || name.length < 2) continue;
      rawMaterialCount++;
    }
  }

  return {
    rabSheets,
    rawBoqCount,
    rawBoqBySheet,
    rawAhsBlockCount,
    rawMaterialCount,
  };
}

function summarizeParsedWorkbook(filePath) {
  const arrayBuffer = getArrayBuffer(filePath);
  const parsed = parser.parseBoqWorkbook(arrayBuffer, path.basename(filePath));
  const stagingRows = parser.convertToStagingRows(parsed);
  const ahsStagingRows = stagingRows.filter(row => row.row_type === 'ahs');
  const ahsWithoutBoq = ahsStagingRows.filter(row => !row.parsed_data.boq_code);
  const parsedBoqBySheet = {};
  for (const item of parsed.boqItems) {
    parsedBoqBySheet[item.sourceSheet] = (parsedBoqBySheet[item.sourceSheet] ?? 0) + 1;
  }

  const anomalyBreakdown = {};
  for (const anomaly of parsed.anomalies) {
    anomalyBreakdown[anomaly.type] = (anomalyBreakdown[anomaly.type] ?? 0) + 1;
  }

  return {
    sheetNames: parsed.projectInfo.sheetNames,
    rabSheets: parsed.projectInfo.rabSheets,
    ahsSheet: parsed.projectInfo.ahsSheet,
    materialSheet: parsed.projectInfo.materialSheet,
    boqCount: parsed.boqItems.length,
    ahsCount: parsed.ahsBlocks.length,
    materialCount: parsed.materials.length,
    anomalyCount: parsed.anomalies.length,
    stagingBreakdown: {
      total: stagingRows.length,
      boqRows: stagingRows.filter(row => row.row_type === 'boq').length,
      ahsRows: ahsStagingRows.length,
      materialRows: stagingRows.filter(row => row.row_type === 'material').length,
      ahsWithoutBoq: ahsWithoutBoq.length,
    },
    parsedBoqBySheet,
    anomalyBreakdown,
    sampleBoq: parsed.boqItems.slice(0, 8).map(item => ({
      code: item.code,
      label: item.label,
      unit: item.unit,
      volume: item.volume,
      sourceSheet: item.sourceSheet,
      sourceRow: item.sourceRow,
      chapter: item.chapter,
    })),
    zeroVolumeSamples: parsed.anomalies
      .filter(anomaly => anomaly.type === 'zero_quantity')
      .slice(0, 5)
      .map(anomaly => ({
        sheet: anomaly.sourceSheet,
        row: anomaly.sourceRow,
        description: anomaly.description,
      })),
    duplicateSamples: parsed.anomalies
      .filter(anomaly => anomaly.type === 'duplicate_item')
      .slice(0, 8)
      .map(anomaly => ({
        sheet: anomaly.sourceSheet,
        row: anomaly.sourceRow,
        description: anomaly.description,
      })),
    ahsWithoutBoqSample: ahsWithoutBoq.slice(0, 8).map(row => ({
      title: row.raw_data.ahsBlockTitle,
      material: row.parsed_data.material_name,
      lineType: row.raw_data.lineType,
      sourceRow: row.raw_data.sourceRow,
    })),
  };
}

const files = process.argv.slice(2);
const targetFiles = files.length > 0 ? files : [
  path.join(repoRoot, 'assets', 'BOQ', 'RAB R1 Pakuwon Indah AAL-5.xlsx'),
  path.join(repoRoot, 'assets', 'BOQ', 'RAB R2 Pakuwon Indah PD3 no. 23.xlsx'),
  path.join(repoRoot, 'assets', 'BOQ', 'RAB Nusa Golf I4 no. 29_R3.xlsx'),
];

for (const filePath of targetFiles) {
  const raw = inspectRawWorkbook(filePath);
  const parsed = summarizeParsedWorkbook(filePath);
  console.log(JSON.stringify({
    file: path.basename(filePath),
    raw,
    parsed,
    delta: {
      boqCount: parsed.boqCount - raw.rawBoqCount,
      ahsCount: parsed.ahsCount - raw.rawAhsBlockCount,
      materialCount: parsed.materialCount - raw.rawMaterialCount,
    },
  }, null, 2));
}
