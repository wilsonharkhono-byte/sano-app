import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/SPH 4 Sonny Citraland Selat Golf - Normalized.xlsx');
const r = await parseBoqV2(buf);
const flagged = r.stagingRows.filter(s => s.needs_review);
console.log('total staging rows:', r.stagingRows.length, '| flagged (needs_review):', flagged.length);

// split by flag_reason
const byReason = {};
for (const s of flagged) {
  const fr = (s.raw_data?.flag_reason) ?? '(none)';
  byReason[fr] = (byReason[fr] ?? 0) + 1;
}
console.log('by flag_reason:', JSON.stringify(byReason, null, 2));

// chapter availability per flagged row
// BoQ rows carry raw_data.chapter; ahs_block/ahs do not directly.
const boqByCode = new Map(r.stagingRows.filter(s => s.row_type === 'boq').map(s => [s.parsed_data?.code, s]));
let withDirectChapter = 0, orphanBlocks = 0, litComps = 0, litCompParentLinked = 0;
for (const s of flagged) {
  if (s.raw_data?.chapter) withDirectChapter++;
  if (s.row_type === 'ahs_block') orphanBlocks++;
  if (s.row_type === 'ahs') {
    litComps++;
    // try parent block via row-range → linked_boq_code → boq chapter
    const sheet = s.raw_data?.source_sheet, srow = s.raw_data?.source_row;
    const parent = r.stagingRows.find(b => b.row_type === 'ahs_block'
      && b.raw_data?.source_sheet === sheet
      && srow >= b.raw_data?.titleRow && srow <= b.raw_data?.jumlahRow);
    const code = parent?.parsed_data?.linked_boq_code;
    if (code && boqByCode.has(code) && boqByCode.get(code).raw_data?.chapter) litCompParentLinked++;
  }
}
console.log({ flaggedWithDirectChapter: withDirectChapter, orphanBlocks, litComps, litCompsResolvableToChapterViaParent: litCompParentLinked });

// sample a few orphan block titles to see the "work category" prefix
const sampleOrphan = flagged.filter(s => s.row_type === 'ahs_block').slice(0, 8).map(s => s.parsed_data?.title);
console.log('sample orphan block titles:', JSON.stringify(sampleOrphan, null, 2));
