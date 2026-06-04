/**
 * Plesteran / Acian direct-reference expansion.
 *
 * For PD3 row IX.A.2 "Plesteran dinding bata", the recipe has two components
 * that both reference the Analisa block's Jumlah row (F485 material lump,
 * G485 labor lump). The old direct-ref tier emitted two opaque lumps. The
 * enhanced tier expands the referenced block's sub-items, so the breakdown
 * shows the actual materials (Semen, Pasir) and labor (Upah plesteran).
 *
 * Skipped cleanly when the raw PD3 fixture isn't present (clean checkout).
 */
import * as fs from 'fs';
import * as path from 'path';
import { runDeterministic } from '../cli-deterministic';

const BOQ_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'BOQ');
const PD3 = path.join(BOQ_DIR, 'RAB R2 Pakuwon Indah PD3 no. 23.xlsx');

const itIf = fs.existsSync(PD3) ? it : it.skip;

jest.setTimeout(180_000);

describe('plesteran/acian direct-ref expansion (PD3 IX.A.2)', () => {
  itIf('expands the Analisa block jumlah-row lump into Semen / Pasir / Upah lines', async () => {
    const res = await runDeterministic({ inputPath: PD3, silent: true });

    // In the multi-sheet 'auto' parse the code keeps its sheet prefix.
    const bd =
      res.breakdowns.find((b) => b.boqCode === 'IX.A.2') ??
      res.breakdowns.find((b) => b.boqCode === '(A) IX.A.2');
    expect(bd).toBeDefined();
    if (!bd) return;

    const names = bd.components.map((c) => c.materialName);

    // Material sub-items must surface, not a single MATERIAL lump.
    expect(names.some((n) => /Semen/i.test(n))).toBe(true);
    expect(names.some((n) => /Pasir/i.test(n))).toBe(true);

    // The labor sub-item must surface as its own line.
    expect(names.some((n) => /Upah plester/i.test(n))).toBe(true);

    // Truth-correctness contract: the whole run reconciles within ±1 Rp.
    expect(res.maxAbsVariance).toBeLessThanOrEqual(1);
  });
});
