import * as fs from 'fs';
import * as path from 'path';
import { parseBoqV2 } from '..';

describe('AAL-5 recipe snapshots', () => {
  it('Poer PC.5 recipe matches golden snapshot', async () => {
    const buf = fs.readFileSync('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const result = await parseBoqV2(ab as ArrayBuffer);
    const target = result.boqRows.find(b => /Poer PC\.5$/.test(b.label));
    expect(target).toBeDefined();
    const canonical = JSON.parse(JSON.stringify(target!.recipe, (_k, v) =>
      typeof v === 'number' ? Number(v.toFixed(2)) : v
    ));
    const expected = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'snapshots', 'aal5_poer_pc5.json'), 'utf8'),
    );
    expect(canonical).toEqual(expected);
  }, 60000);
});
