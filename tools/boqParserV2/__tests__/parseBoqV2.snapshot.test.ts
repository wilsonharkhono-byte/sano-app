import * as fs from 'fs';
import * as path from 'path';
import { parseBoqV2 } from '../index';

const FIXTURES = [
  { file: 'RAB R1 Pakuwon Indah AAL-5.xlsx', boqSheet: 'RAB (A)' },
  { file: 'RAB R2 Pakuwon Indah PD3 no. 23.xlsx', boqSheet: 'RAB (A)' },
  { file: 'RAB Nusa Golf I4 no. 29_R3.xlsx', boqSheet: 'RAB (A)' },
  { file: 'CONTOH_Template_Parser.xlsx', boqSheet: 'RAB (A)' },
];

const BOQ_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'BOQ');

describe('parseBoqV2 real-workbook snapshots', () => {
  for (const { file, boqSheet } of FIXTURES) {
    const fullPath = path.join(BOQ_DIR, file);
    const exists = fs.existsSync(fullPath);
    const testFn = exists ? it : it.skip;
    testFn(`matches snapshot for ${file}`, async () => {
      const buf = fs.readFileSync(fullPath);
      const result = await parseBoqV2(buf, { boqSheet });
      // Deterministic projection of staging rows for the snapshot —
      // strip volatile fields like timestamps and limit to schema-stable
      // shape so unrelated cosmetic changes don't break the snapshot.
      const projection = result.stagingRows.map((r) => ({
        row_type: r.row_type,
        row_number: r.row_number,
        cost_basis: r.cost_basis,
        parent_ahs_staging_id: r.parent_ahs_staging_id,
        parsed_data: r.parsed_data,
      }));
      expect({
        rowCount: projection.length,
        rows: projection,
        unresolvedRefCount: result.validationReport.unresolved_references.length,
      }).toMatchSnapshot();
    });
  }
});
