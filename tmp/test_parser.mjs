// Standalone test script for the Excel parser — no Supabase/RN imports
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// ─── Inline the parser logic needed for testing (avoids import chain) ───

function normalize(s) {
  return s.toLowerCase().replace(/[()@\-\/\\'"]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isAhsTitleRow(text) {
  return /^\d+\s*(m[123]|kg|ls|bh|pcs|titik|set|unit)\s+/i.test(text.trim())
    || /^(pekerjaan|pasangan|pemasangan|pengecoran|pembetonan|pembesian)/i.test(text.trim());
}

function isLaborDescription(desc) {
  const laborKeywords = ['tukang','pekerja','mandor','kepala tukang','upah','borongan','tenaga','buruh','pasang','cor ','pengecoran'];
  const lower = desc.toLowerCase();
  return laborKeywords.some(kw => lower.includes(kw));
}

function extractWasteFactor(cell) {
  if (!cell.f) return 0;
  const match = String(cell.f).match(/\*\s*(1\.\d+)\s*$/);
  return match ? Number(match[1]) - 1 : 0;
}

const files = [
  'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx',
  'assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx',
  'assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx',
];

for (const f of files) {
  const wb = XLSX.readFile(f, { cellFormula: true, cellNF: true });
  const sheetNames = wb.SheetNames;

  const rabSheets = sheetNames.filter(n => /^RAB\s*\(/i.test(n) || /^RAB$/i.test(n));
  const ahsSheet = sheetNames.find(n => /analisa/i.test(n)) ?? null;
  const matSheet = sheetNames.find(n => /^material$/i.test(n)) ?? null;
  const upahSheet = sheetNames.find(n => /^upah$/i.test(n)) ?? null;

  console.log('='.repeat(70));
  console.log('FILE:', f.split('/').pop());
  console.log('All sheets:', sheetNames.join(', '));
  console.log('RAB:', rabSheets.join(', '), '| AHS:', ahsSheet, '| Mat:', matSheet, '| Upah:', upahSheet);

  // ─── Parse AHS ───
  let ahsBlockCount = 0;
  let ahsTotalComps = 0;
  const ahsBlocks = [];
  if (ahsSheet) {
    const sheet = wb.Sheets[ahsSheet];
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
    let currentBlock = null;

    for (let r = 9; r <= range.e.r; r++) {
      const cellB = sheet[XLSX.utils.encode_cell({r, c:1})];
      const cellD = sheet[XLSX.utils.encode_cell({r, c:3})];
      const cellE = sheet[XLSX.utils.encode_cell({r, c:4})];

      if (cellE && typeof cellE.v === 'string' && /jumlah/i.test(String(cellE.v))) {
        if (currentBlock) {
          const cellF = sheet[XLSX.utils.encode_cell({r, c:5})];
          ahsBlocks.push({
            title: currentBlock.title,
            titleRow: currentBlock.titleRow + 1,
            jumlahRow: r + 1,
            compCount: currentBlock.compCount,
            matTotal: Number(cellF?.v ?? 0),
          });
          ahsTotalComps += currentBlock.compCount;
          ahsBlockCount++;
          currentBlock = null;
        }
        continue;
      }

      if (cellB && !cellD) {
        const bVal = cellB.v;
        if (typeof bVal === 'string' && bVal.trim().length > 5 && isAhsTitleRow(bVal)) {
          currentBlock = { title: bVal.trim(), titleRow: r, compCount: 0 };
          continue;
        }
      }

      if (currentBlock && cellB && cellD) {
        const coeff = Number(cellB.v ?? 0);
        if (coeff !== 0 || typeof cellB.v === 'number') {
          currentBlock.compCount++;
          // Check for waste factor
          const wf = extractWasteFactor(cellB);
          if (wf > 0) {
            // waste factor detected
          }
        }
      }
    }
  }
  console.log('AHS blocks:', ahsBlockCount, '| Total components:', ahsTotalComps);
  ahsBlocks.slice(0, 3).forEach(b => {
    console.log('  AHS:', b.title.substring(0, 65), '| Comps:', b.compCount, '| Mat total:', b.matTotal);
  });

  // ─── Parse RAB ───
  let boqCount = 0;
  let structuralCount = 0;
  let ahsRefCount = 0;
  const sampleItems = [];

  for (const sheetName of rabSheets) {
    const sheet = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');

    // Find header row
    let headerRow = 6;
    for (let r = 0; r <= 15; r++) {
      for (let c = 0; c <= 5; c++) {
        const cell = sheet[XLSX.utils.encode_cell({r, c})];
        if (cell && typeof cell.v === 'string' && /uraian pekerjaan/i.test(cell.v)) {
          headerRow = r;
          break;
        }
      }
    }

    let chapter = '';
    let itemNum = 0;

    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const cellA = sheet[XLSX.utils.encode_cell({r, c:0})];
      const cellB = sheet[XLSX.utils.encode_cell({r, c:1})];
      if (!cellB || !cellB.v) continue;
      const desc = String(cellB.v).trim();
      if (!desc) continue;

      const aVal = cellA ? String(cellA.v ?? '').trim() : '';
      if (/^(I{1,3}|IV|VI{0,3}|IX|X{0,3})\.?\s*$/i.test(aVal)) {
        chapter = desc;
        itemNum = 0;
        continue;
      }

      if (/^sub\s*total|^jumlah/i.test(desc)) continue;

      const unitCell = sheet[XLSX.utils.encode_cell({r, c:2})];
      const volCell = sheet[XLSX.utils.encode_cell({r, c:7})];
      const unit = unitCell ? String(unitCell.v ?? '').trim() : '';
      const vol = Number(volCell?.v ?? 0);
      if (!unit) continue;

      itemNum++;
      boqCount++;

      // Check for structural composites
      const fwRatio = Number(sheet[XLSX.utils.encode_cell({r, c:21})]?.v ?? 0);
      const rbRatio = Number(sheet[XLSX.utils.encode_cell({r, c:25})]?.v ?? 0);
      if (fwRatio > 0 || rbRatio > 0) structuralCount++;

      // Check for AHS references in formulas
      const matCell = sheet[XLSX.utils.encode_cell({r, c:8})];
      if (matCell?.f && /analisa/i.test(String(matCell.f))) ahsRefCount++;

      if (sampleItems.length < 5) {
        sampleItems.push({
          code: `${aVal || 'I'}-${String(itemNum).padStart(2,'0')}`,
          label: desc.substring(0, 55),
          unit, vol,
          fwRatio: fwRatio > 0 ? fwRatio.toFixed(1) : '-',
          rbRatio: rbRatio > 0 ? rbRatio.toFixed(0) : '-',
          hasAhsRef: matCell?.f ? /analisa/i.test(String(matCell.f)) : false,
          formula: matCell?.f ? String(matCell.f).substring(0, 40) : '-',
        });
      }
    }
  }

  console.log('BoQ items:', boqCount, '| Structural composites:', structuralCount, '| AHS-linked:', ahsRefCount);
  sampleItems.forEach(item => {
    console.log(`  ${item.code} | ${item.label} | ${item.unit} | vol:${item.vol} | fw:${item.fwRatio} | rb:${item.rbRatio} | ref:${item.hasAhsRef}`);
  });

  // ─── Parse Materials ───
  if (matSheet) {
    const sheet = wb.Sheets[matSheet];
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
    let matCount = 0;
    const sampleMats = [];
    for (let r = 5; r <= range.e.r; r++) {
      const nameCell = sheet[XLSX.utils.encode_cell({r, c:1})];
      if (!nameCell || !nameCell.v) continue;
      const name = String(nameCell.v).trim();
      if (name.length < 2) continue;
      matCount++;
      const priceCell = sheet[XLSX.utils.encode_cell({r, c:6})];
      const unitCell = sheet[XLSX.utils.encode_cell({r, c:5})];
      if (sampleMats.length < 3) {
        sampleMats.push({ name: name.substring(0, 40), unit: String(unitCell?.v ?? ''), price: Number(priceCell?.v ?? 0) });
      }
    }
    console.log('Materials:', matCount);
    sampleMats.forEach(m => console.log(`  ${m.name} | ${m.unit} | Rp ${m.price.toLocaleString('id-ID')}`));
  }

  console.log('');
}
