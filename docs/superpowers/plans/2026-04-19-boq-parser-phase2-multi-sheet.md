# BoQ Parser Phase 2 — Multi-sheet RAB

**Goal:** Support projects like Nusa Golf (`RAB (A)` through `RAB (E)`) where the main BoQ is spread across multiple sheets. Parse them all, namespace codes as `(A) II.1`, merge Analisa references for correct orphan detection.

**Architecture:** Additive — `boqSheet: string | string[] | 'auto'` option. `multiSheetScanner.ts` module auto-detects plausible RAB sheets. Code namespacing decided once per parse based on sheet count.

**Tech Stack:** TypeScript, Jest, xlsx, exceljs (tests).

## File Map

| File | Role |
|---|---|
| `tools/boqParserV2/multiSheetScanner.ts` | NEW — `resolveBoqSheets(workbook, option)`, `isPlausibleRabSheet` heuristic |
| `tools/boqParserV2/index.ts` | Extended — accepts string/array/'auto'; runs extractBoqRows per sheet; merges Analisa ref map |
| `tools/boqParserV2/extractTakeoffs.ts` | `BoqRowV2` gets `source_sheet: string` field |
| `tools/boqParserV2/__tests__/multiSheet.test.ts` | NEW — unit tests for resolver + namespacing + merge |
| `tools/boqParserV2/__tests__/parseV2.smoke.test.ts` | Append Nusa Golf smoke case |

## Tasks

### Task 1: Add `source_sheet` to BoqRowV2

- [ ] Add `source_sheet: string` to `BoqRowV2` interface in `extractTakeoffs.ts`
- [ ] `extractBoqRows` populates it from its `boqSheetName` argument on every `out.push`
- [ ] Add tests to extractTakeoffs.test.ts asserting `source_sheet === 'RAB (A)'` for the existing fixtures (append `source_sheet: 'RAB (A)'` to expected objects)
- [ ] Run suite, commit: `feat(boq-v2): track source_sheet on BoqRowV2`

### Task 2: multiSheetScanner module

Create `tools/boqParserV2/multiSheetScanner.ts`:

```typescript
import * as XLSX from 'xlsx';

export type BoqSheetOption = string | string[] | 'auto';

// A sheet is "plausible RAB" when it matches RAB (X) naming AND has at
// least one row below row 7 with text in B and a unit/volume in C/D.
// Auto-detect returns the sheets sorted by SheetNames order.
export function isPlausibleRabSheet(wb: XLSX.WorkBook, sheetName: string): boolean {
  if (!/^RAB(\s*\([A-Z]\))?$/i.test(sheetName)) return false;
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) return false;
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = 7; r <= Math.min(range.e.r, 40); r++) {
    const b = ws['B' + (r + 1)];
    const c = ws['C' + (r + 1)];
    const d = ws['D' + (r + 1)];
    if (b?.v && c?.v && (d?.v != null)) return true;
  }
  return false;
}

export function resolveBoqSheets(wb: XLSX.WorkBook, option: BoqSheetOption): string[] {
  if (Array.isArray(option)) return option;
  if (option !== 'auto') return [option];
  return wb.SheetNames.filter(n => isPlausibleRabSheet(wb, n));
}
```

Tests in `tools/boqParserV2/__tests__/multiSheet.test.ts`:

```typescript
import * as XLSX from 'xlsx';
import { resolveBoqSheets, isPlausibleRabSheet } from '../multiSheetScanner';
import { buildFixtureBuffer } from './fixtures';

describe('resolveBoqSheets', () => {
  it('returns explicit string as single-element array', async () => {
    const buf = await buildFixtureBuffer([{ name: 'RAB (A)', cells: [{ address: 'B7', value: 'URAIAN PEKERJAAN' }] }]);
    const wb = XLSX.read(buf, { cellFormula: true });
    expect(resolveBoqSheets(wb, 'RAB (A)')).toEqual(['RAB (A)']);
  });

  it('returns explicit array verbatim', async () => {
    const buf = await buildFixtureBuffer([
      { name: 'RAB (A)', cells: [{ address: 'B7', value: 'URAIAN PEKERJAAN' }] },
      { name: 'RAB (B)', cells: [{ address: 'B7', value: 'URAIAN PEKERJAAN' }] },
    ]);
    const wb = XLSX.read(buf, { cellFormula: true });
    expect(resolveBoqSheets(wb, ['RAB (A)', 'RAB (B)'])).toEqual(['RAB (A)', 'RAB (B)']);
  });

  it('auto mode picks RAB (*) sheets with real rows', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: 'Item 1' }, { address: 'C10', value: 'm1' }, { address: 'D10', value: 10 },
        ],
      },
      { name: 'Material', cells: [{ address: 'B1', value: 'Name' }] },
      {
        name: 'RAB (B)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: 'Item 2' }, { address: 'C10', value: 'm2' }, { address: 'D10', value: 20 },
        ],
      },
    ]);
    const wb = XLSX.read(buf, { cellFormula: true });
    expect(resolveBoqSheets(wb, 'auto')).toEqual(['RAB (A)', 'RAB (B)']);
  });

  it('auto mode skips empty RAB sheets', async () => {
    const buf = await buildFixtureBuffer([
      { name: 'RAB (A)', cells: [{ address: 'B7', value: 'URAIAN PEKERJAAN' }] },
      {
        name: 'RAB (B)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: 'Item' }, { address: 'C10', value: 'm1' }, { address: 'D10', value: 10 },
        ],
      },
    ]);
    const wb = XLSX.read(buf, { cellFormula: true });
    expect(resolveBoqSheets(wb, 'auto')).toEqual(['RAB (B)']);
  });
});
```

Commit: `feat(boq-v2): multi-sheet RAB scanner`

### Task 3: Wire multi-sheet into `parseBoqV2`

Modify `tools/boqParserV2/index.ts`:

1. Change `ParseBoqV2Options.boqSheet` type from `string` to `BoqSheetOption` (import from multiSheetScanner).
2. At the top of `parseBoqV2`, re-read the workbook via xlsx to apply `resolveBoqSheets`. OR: have `harvestWorkbook` return the workbook handle too. Easier path: pass the ArrayBuffer through xlsx.read once to get SheetNames, resolve, then proceed as before.

   Actually cleaner: have `harvestWorkbook` already use xlsx internally. Check what it exports. If it doesn't expose SheetNames, add a simple helper that returns `workbook.SheetNames` alongside the existing return.

3. Loop over resolved sheets:
   - Call `extractBoqRows(cells, lookup, sheetName)` for each
   - Collect into one big `boqRows: BoqRowV2[]`
   - `const usePrefix = sheets.length > 1`
   - After each sheet's extraction, if `usePrefix`, prepend `(X) ` to each row's `code` (where X is the parenthesized letter from the sheet name — extract via regex `/^RAB\s*\(([A-Z])\)$/`)

4. Recipe assembly: run the existing recipe pass per-sheet (inside the same loop or after the concat). The recipe assembly depends on boqSheet; it must use each row's `source_sheet`.

5. Block-link resolver scans cells from ALL sheets (which it already does, since it scans `cells` globally) — verify by reading existing logic. If it's hardcoded to one sheet, generalize.

Add a test in `multiSheet.test.ts`:

```typescript
describe('parseBoqV2 multi-sheet', () => {
  it('namespaces codes when multiple sheets are parsed', async () => {
    const buf = await buildFixtureBuffer([
      { name: 'Analisa', cells: [{ address: 'B13', value: '1 m3 Beton' }, { address: 'E19', value: 'Jumlah' }, { address: 'F19', value: 100 }] },
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'A9', value: 'I' }, { address: 'B9', value: 'PEKERJAAN PERSIAPAN' },
          { address: 'A11', value: 1 }, { address: 'B11', value: 'Pagar' },
          { address: 'C11', value: 'm1' }, { address: 'D11', value: 10 },
        ],
      },
      {
        name: 'RAB (B)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'A9', value: 'I' }, { address: 'B9', value: 'STRUKTUR' },
          { address: 'A11', value: 1 }, { address: 'B11', value: 'Galian' },
          { address: 'C11', value: 'm3' }, { address: 'D11', value: 20 },
        ],
      },
    ]);
    const result = await parseBoqV2(buf, { boqSheet: ['RAB (A)', 'RAB (B)'] });
    const codes = result.boqRows.map(r => r.code);
    expect(codes).toContain('(A) I.1');
    expect(codes).toContain('(B) I.1');
  });
});
```

Commit: `feat(boq-v2): accept boqSheet as string|array|auto, namespace codes`

### Task 4: Run Nusa Golf & PD3 smoke

Append to the smoke test:

```typescript
test('Nusa Golf workbook → parseBoqV2 with auto multi-sheet', async () => {
  const buf = fs.readFileSync('assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const result = await parseBoqV2(ab as ArrayBuffer, { boqSheet: 'auto' });
  console.log('\n==== parseBoqV2 smoke: Nusa Golf ====');
  const bySheet = new Map<string, number>();
  for (const r of result.boqRows) bySheet.set(r.source_sheet, (bySheet.get(r.source_sheet) ?? 0) + 1);
  for (const [sn, n] of bySheet) console.log(`  ${sn}: ${n} rows`);
  const blockRows = result.stagingRows.filter(r => r.row_type === 'ahs_block');
  const linked = blockRows.filter(r => (r.parsed_data as { linked_boq_code?: string }).linked_boq_code).length;
  console.log(`  BoQ total: ${result.boqRows.length}, blocks linked: ${linked}/${blockRows.length}`);
  expect(result.boqRows.length).toBeGreaterThan(50);  // was 15 with single-sheet
  expect(linked / Math.max(1, blockRows.length)).toBeGreaterThan(0.3);  // up from 0
}, 120000);
```

Commit: `test(boq-v2): Nusa Golf multi-sheet smoke`

### Task 5: Full verify

Run `npx jest --no-coverage`, confirm all green. If anything breaks, fix and commit.
