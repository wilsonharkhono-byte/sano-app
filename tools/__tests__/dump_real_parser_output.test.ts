// Runs the ACTUAL production parseBoqV2 against AAL-5 and dumps every
// piece of output it produces to a single Excel workbook. This is the
// ground-truth view of what the SANO parser sees in the workbook today.
//
// Run with: npx jest tools/__tests__/dump_real_parser_output.test.ts --runInBand
//
// Output: assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx
//
// Mock supabase so the parser import path stays clean even though parseBoqV2
// itself doesn't touch the database.
jest.mock('../supabase', () => ({ supabase: {} }));

import { readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { parseBoqV2 } from '../boqParserV2/index';

const SOURCE = 'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx';
const OUT    = 'assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx';

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F2937' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const ALT_FILL    = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF9FAFB' } };
const HL_FILL     = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFEF3C7' } };

function styleHeader(ws: ExcelJS.Worksheet) {
  const h = ws.getRow(1);
  h.height = 22;
  h.eachCell({ includeEmpty: false }, c => {
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
}

describe('Dump real parser output', () => {
  it('writes a workbook that mirrors what parseBoqV2 produces', async () => {
    const buf = readFileSync(SOURCE);
    const result = await parseBoqV2(buf, {
      analisaSheet: 'Analisa',
      boqSheet: 'RAB (A)',
      catalogSheets: ['Material', 'Upah'],
    });

    const { materialRows, ahsBlocks, boqRows, stagingRows, validationReport } = result;

    // Quick sanity dump to console
    /* eslint-disable no-console */
    console.log('\n=== Parser actual output ===');
    console.log(`Catalog rows (Material+Upah): ${materialRows.length}`);
    console.log(`AHS blocks detected:          ${ahsBlocks.length}`);
    console.log(`BoQ rows extracted:           ${boqRows.length}`);
    console.log(`Staging rows produced:        ${stagingRows.length}`);
    console.log(`Validation blocks reported:   ${validationReport.blocks.length}`);
    console.log(`  Balanced:    ${validationReport.blocks.filter(b => b.status === 'ok').length}`);
    console.log(`  Imbalanced:  ${validationReport.blocks.filter(b => b.status === 'imbalanced').length}`);
    const stagingByType: Record<string, number> = {};
    for (const r of stagingRows) stagingByType[r.row_type] = (stagingByType[r.row_type] ?? 0) + 1;
    console.log('Staging rows by type:', stagingByType);
    /* eslint-enable no-console */

    const out = new ExcelJS.Workbook();
    out.creator = 'SANO parser team';

    // ----- Sheet 1: Pipeline overview -----
    const sum = out.addWorksheet('Pipeline');
    sum.columns = [{ width: 50 }, { width: 22 }, { width: 60 }];
    const summaryLines: Array<[string, string | number, string]> = [
      ['SANO parser actual output', '', ''],
      ['Source file', SOURCE, ''],
      ['Date', new Date().toISOString().slice(0, 19), ''],
      ['', '', ''],
      ['Step', 'Count', 'What it is'],
      ['1. Catalog rows (Material+Upah sheets)', materialRows.length, 'Reference catalog — used by extractCatalog.ts'],
      ['2. AHS blocks detected in Analisa', ahsBlocks.length, 'detectBlocks.ts finds title→header→components→jumlah blocks'],
      ['3. BoQ rows extracted from RAB sheets', boqRows.length, 'extractTakeoffs.ts walks every numeric/code row'],
      ['4. Staging rows produced (DB-ready)', stagingRows.length, 'These would be INSERTed into import_staging_rows table'],
      ['5. Validation: balanced blocks', validationReport.blocks.filter(b => b.status === 'ok').length, ''],
      ['5. Validation: imbalanced blocks', validationReport.blocks.filter(b => b.status === 'imbalanced').length, 'These need review — subtotal mismatch detected'],
      ['', '', ''],
      ['Staging rows by row_type', '', ''],
      ['  material', stagingByType['material'] ?? 0, '→ inserted into material_catalog if missing'],
      ['  ahs_block', stagingByType['ahs_block'] ?? 0, '→ becomes one row in ahs_versions or ahs_blocks table'],
      ['  ahs', stagingByType['ahs'] ?? 0, '→ component lines, inserted into ahs_lines after flattenBlock()'],
      ['  boq', stagingByType['boq'] ?? 0, '→ inserted into boq_items'],
      ['', '', ''],
      ['Pipeline after parsing:', '', ''],
      ['  parseBoqV2() → StagingRowV2[]', '', ''],
      ['  → INSERT into import_staging_rows table (per session_id)', '', ''],
      ['  → BaselineScreen UI shows the rows for human review', '', ''],
      ['  → Estimator marks each row APPROVED / REJECTED / UNDER_REVIEW', '', ''],
      ['  → publishBaselineV2() reads approved rows, flattens, and writes:', '', ''],
      ['       ahs_versions   (one row per import session)', '', ''],
      ['       boq_items      (every approved BoQ row)', '', ''],
      ['       ahs_lines      (every flattened recipe line)', '', ''],
      ['  → SANO Permintaan / MTN / Opname flows use these tables', '', ''],
    ];
    let r = 1;
    for (const [a, b, c] of summaryLines) {
      const row = sum.getRow(r);
      row.getCell(1).value = a;
      row.getCell(2).value = b;
      row.getCell(3).value = c;
      if (r === 1) row.font = { bold: true, size: 14 };
      if (r === 5) {
        row.font = HEADER_FONT;
        row.eachCell({ includeEmpty: false }, c => { c.fill = HEADER_FILL; });
      }
      if (typeof b === 'number') {
        row.getCell(2).numFmt = '#,##0';
        row.getCell(2).alignment = { horizontal: 'right' };
      }
      r++;
    }

    // ----- Sheet 2: Catalog rows -----
    const cat = out.addWorksheet('Catalog (material+upah)', { views: [{ state: 'frozen', ySplit: 1 }] });
    cat.columns = [
      { header: 'Code',           key: 'code',  width: 14 },
      { header: 'Name',           key: 'name',  width: 42 },
      { header: 'Unit',           key: 'unit',  width: 10 },
      { header: 'Reference Price (Rp)', key: 'price', width: 16 },
      { header: 'Source Row',     key: 'sourceRow', width: 12 },
    ];
    styleHeader(cat);
    let rr = 2;
    for (const m of materialRows) {
      const row = cat.addRow({ code: m.code, name: m.name, unit: m.unit, price: m.reference_unit_price, sourceRow: m.sourceRow });
      row.getCell('price').numFmt = '#,##0';
      if (rr % 2 === 0) row.eachCell({ includeEmpty: true }, c => { c.fill = ALT_FILL; });
      rr++;
    }

    // ----- Sheet 3: AHS blocks -----
    const ah = out.addWorksheet('AHS blocks', { views: [{ state: 'frozen', ySplit: 1 }] });
    ah.columns = [
      { header: 'Title Row',      key: 'titleRow',  width: 10 },
      { header: 'Jumlah Row',     key: 'jumlahRow', width: 10 },
      { header: 'AHS Title',      key: 'title',     width: 50 },
      { header: 'Grand Total Addr', key: 'gtAddr',  width: 14 },
      { header: 'Jumlah Cached',  key: 'cached',    width: 16 },
      { header: '# Components',   key: 'compCount', width: 12 },
      { header: '# Subtotals',    key: 'stCount',   width: 12 },
    ];
    styleHeader(ah);
    rr = 2;
    for (const b of ahsBlocks) {
      const row = ah.addRow({
        titleRow: b.titleRow,
        jumlahRow: b.jumlahRow,
        title: b.title,
        gtAddr: b.grandTotalAddress ?? '',
        cached: b.jumlahCachedValue,
        compCount: b.components.length,
        stCount: b.componentSubtotals.length,
      });
      row.getCell('cached').numFmt = '#,##0';
      if (rr % 2 === 0) row.eachCell({ includeEmpty: true }, c => { c.fill = ALT_FILL; });
      rr++;
    }

    // ----- Sheet 4: BoQ rows + recipe summary -----
    const bq = out.addWorksheet('BoQ rows', { views: [{ state: 'frozen', ySplit: 1 }] });
    bq.columns = [
      { header: 'Sheet',         key: 'sheet',       width: 10 },
      { header: 'Source Row',    key: 'sourceRow',   width: 10 },
      { header: 'Code',          key: 'code',        width: 10 },
      { header: 'Description',   key: 'desc',        width: 42 },
      { header: 'Unit',          key: 'unit',        width: 8  },
      { header: 'Volume',        key: 'volume',      width: 12 },
      { header: 'Unit Price (Rp)', key: 'unitPrice', width: 14 },
      { header: 'Total (Rp)',    key: 'total',       width: 16 },
      { header: 'Cost Basis',    key: 'costBasis',   width: 14 },
      { header: 'Has Recipe?',   key: 'hasRecipe',   width: 12 },
      { header: 'Recipe Comp #', key: 'compCount',   width: 14 },
      { header: 'Confidence',    key: 'confidence',  width: 12 },
      { header: 'Needs Review?', key: 'needsReview', width: 14 },
    ];
    styleHeader(bq);
    rr = 2;
    for (const b of boqRows) {
      const unitPrice = b.total_cost != null && b.planned ? b.total_cost / b.planned : null;
      const row = bq.addRow({
        sheet: b.source_sheet,
        sourceRow: b.sourceRow,
        code: b.code,
        desc: b.label,
        unit: b.unit,
        volume: b.planned,
        unitPrice,
        total: b.total_cost,
        costBasis: b.cost_basis ?? '',
        hasRecipe: b.recipe ? 'YES' : 'no',
        compCount: b.recipe?.components.length ?? 0,
        confidence: '',
        needsReview: '',
      });
      row.getCell('volume').numFmt = '#,##0.000';
      row.getCell('unitPrice').numFmt = '#,##0';
      row.getCell('total').numFmt = '#,##0';
      if (b.recipe) row.getCell('hasRecipe').font = { color: { argb: 'FF059669' }, bold: true };
      if (rr % 2 === 0) row.eachCell({ includeEmpty: true }, c => { c.fill = ALT_FILL; });
      rr++;
    }

    // ----- Sheet 5: Recipe components (deep dive) -----
    const rec = out.addWorksheet('Recipe components', { views: [{ state: 'frozen', ySplit: 1 }] });
    rec.columns = [
      { header: 'BoQ Code',           key: 'boqCode',     width: 10 },
      { header: 'BoQ Description',    key: 'boqDesc',     width: 38 },
      { header: 'BoQ Volume',         key: 'boqVol',      width: 10 },
      { header: 'BoQ Unit',           key: 'boqUnit',     width: 8  },
      { header: 'Source Cell',        key: 'srcCell',     width: 14 },
      { header: 'Referenced Cell',    key: 'refCell',     width: 14 },
      { header: 'Referenced Block',   key: 'refBlock',    width: 38 },
      { header: 'Material Name',      key: 'matName',     width: 32 },
      { header: 'Cost Basis',         key: 'costBasis',   width: 14 },
      { header: 'Qty Per BoQ Unit',   key: 'qtyPerUnit',  width: 14 },
      { header: 'Unit Price',         key: 'unitPrice',   width: 12 },
      { header: 'Cost Per BoQ Unit',  key: 'costPerUnit', width: 14 },
    ];
    styleHeader(rec);
    rr = 2;
    let prevBoq: string | null = null;
    for (const b of boqRows) {
      if (!b.recipe) continue;
      for (const c of b.recipe.components) {
        const row = rec.addRow({
          boqCode: b.code,
          boqDesc: b.label,
          boqVol: b.planned,
          boqUnit: b.unit,
          srcCell: `${c.sourceCell.sheet}!${c.sourceCell.address}`,
          refCell: `${c.referencedCell.sheet}!${c.referencedCell.address}`,
          refBlock: c.referencedBlockTitle ?? '',
          matName: (c as { materialName?: string }).materialName ?? c.referencedBlockTitle ?? '',
          costBasis: (c as { costBasis?: string }).costBasis ?? '',
          qtyPerUnit: c.quantityPerUnit,
          unitPrice: c.unitPrice,
          costPerUnit: c.quantityPerUnit * c.unitPrice,
        });
        row.getCell('boqVol').numFmt = '#,##0.000';
        row.getCell('qtyPerUnit').numFmt = '#,##0.0000';
        row.getCell('unitPrice').numFmt = '#,##0';
        row.getCell('costPerUnit').numFmt = '#,##0';
        if (prevBoq && b.code !== prevBoq) {
          row.eachCell({ includeEmpty: true }, cc => { cc.border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } } }; });
        }
        if (rr % 2 === 0) row.eachCell({ includeEmpty: true }, cc => { cc.fill = ALT_FILL; });
        prevBoq = b.code;
        rr++;
      }
    }

    // ----- Sheet 6: Staging rows (the DB payload) -----
    const st = out.addWorksheet('Staging rows (DB payload)', { views: [{ state: 'frozen', ySplit: 1 }] });
    st.columns = [
      { header: 'Row #',          key: 'rowNum',     width: 8  },
      { header: 'row_type',       key: 'rowType',    width: 14 },
      { header: 'cost_basis',     key: 'costBasis',  width: 14 },
      { header: 'needs_review',   key: 'needsReview',width: 12 },
      { header: 'confidence',     key: 'confidence', width: 12 },
      { header: 'parent_ahs',     key: 'parent',     width: 14 },
      { header: 'parsed_data (summary)', key: 'parsed', width: 60 },
    ];
    styleHeader(st);
    rr = 2;
    for (const s of stagingRows) {
      const parsedSummary = (() => {
        const pd = s.parsed_data ?? {};
        if (s.row_type === 'material') return `${pd.code ?? ''} | ${pd.name ?? ''} | ${pd.unit ?? ''} | ${pd.reference_unit_price ?? ''}`;
        if (s.row_type === 'ahs_block') return `${pd.title ?? ''}${pd.is_orphan ? '  [ORPHAN]' : ''}${pd.linked_boq_code ? '  → BoQ ' + pd.linked_boq_code : ''}`;
        if (s.row_type === 'ahs') return `${pd.material_name ?? pd.label ?? ''} | qty=${pd.quantity_per_unit ?? ''} | price=${pd.unit_price ?? ''}`;
        if (s.row_type === 'boq') return `${pd.code ?? ''} | ${pd.description ?? ''} | ${pd.unit ?? ''} | vol=${pd.volume ?? ''}`;
        return JSON.stringify(pd).slice(0, 100);
      })();
      const row = st.addRow({
        rowNum: s.row_number,
        rowType: s.row_type,
        costBasis: s.cost_basis ?? '',
        needsReview: s.needs_review ? 'YES' : 'no',
        confidence: s.confidence,
        parent: s.parent_ahs_staging_id ?? '',
        parsed: parsedSummary,
      });
      if (s.needs_review) row.getCell('needsReview').font = { color: { argb: 'FFDC2626' }, bold: true };
      if (rr % 2 === 0) row.eachCell({ includeEmpty: true }, c => { c.fill = ALT_FILL; });
      rr++;
    }

    // ----- Sheet 7: Validation report -----
    const v = out.addWorksheet('Validation', { views: [{ state: 'frozen', ySplit: 1 }] });
    v.columns = [
      { header: 'Block Title',  key: 'title',    width: 50 },
      { header: 'Status',       key: 'status',   width: 12 },
      { header: 'Expected',     key: 'expected', width: 16 },
      { header: 'Actual',       key: 'actual',   width: 16 },
      { header: 'Delta',        key: 'delta',    width: 14 },
    ];
    styleHeader(v);
    rr = 2;
    for (const b of validationReport.blocks) {
      const row = v.addRow(b);
      row.getCell('expected').numFmt = '#,##0';
      row.getCell('actual').numFmt = '#,##0';
      row.getCell('delta').numFmt = '#,##0';
      if (b.status === 'imbalanced') row.getCell('status').font = { color: { argb: 'FFDC2626' }, bold: true };
      if (rr % 2 === 0) row.eachCell({ includeEmpty: true }, c => { c.fill = ALT_FILL; });
      rr++;
    }

    await out.xlsx.writeFile(OUT);

    // Also dump a JSON snapshot for debugging
    writeFileSync('tmp/parser_actual_output.json', JSON.stringify({
      counts: {
        materialRows: materialRows.length,
        ahsBlocks: ahsBlocks.length,
        boqRows: boqRows.length,
        stagingRows: stagingRows.length,
      },
      stagingByType,
      validationSummary: {
        ok: validationReport.blocks.filter(b => b.status === 'ok').length,
        imbalanced: validationReport.blocks.filter(b => b.status === 'imbalanced').length,
      },
    }, null, 2));

    expect(stagingRows.length).toBeGreaterThan(0);
    expect(boqRows.length).toBeGreaterThan(0);
    expect(ahsBlocks.length).toBeGreaterThan(0);
  }, 120_000);
});
