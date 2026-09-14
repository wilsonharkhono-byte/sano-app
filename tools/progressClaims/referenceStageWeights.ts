// tools/progressClaims/referenceStageWeights.ts
// SANO — derive the reference stage-weight profile from SANO RAB workbooks
// (spec §7.3, §17). Pure over sheet rows; the xlsx reading lives in
// deriveReferenceWeights.ts.
//
// Method: per concrete RAB row, bekisting Rp = volume × V × W, pembesian Rp =
// volume × Z × AA, pengecoran Rp = volume × R. The borongan line S + T is left
// out on purpose: apportioning it pro rata to material Rp leaves the shares
// unchanged. Only rows priced on all three stages count. Each workbook counts
// once: a class's weights are the mean of its per-workbook shares.
import { classifyWorkAreas, elementOf, type WorkAreaClass } from './workAreaClass';
import { weightsFromAmounts, type ReferenceProfile } from './stageWeights';

export const REFERENCE_WORKBOOKS = [
  'SPH 4 Sonny Citraland Selat Golf.xlsx',
  'RAB R1 Pakuwon Indah AAL-5.xlsx',
  'RAB R2 Pakuwon Indah PD3 no. 23.xlsx',
  'RAB Nusa Golf I4 no. 29_R3.xlsx',
  'RAB ERNAWATI edit.xlsx',
] as const;

/** Classes every reference RAB prices by stage. Tangga and piles are package-priced; lainnya is too mixed. */
export const PROFILE_CLASSES: readonly WorkAreaClass[] = ['PILECAP_SLOOF_PLAT_DASAR', 'KOLOM', 'BALOK_PLAT', 'DINDING'];

const COL = { A: 0, B: 1, D: 3, R: 17, V: 21, W: 22, Z: 25, AA: 26 } as const;
const ROMAN = /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const text = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

export interface RabConcreteRow {
  chapterTitle: string;
  section: string;
  label: string;
  volume: number;
  bekisting: number;
  pembesian: number;
  pengecoran: number;
}

/** The SANO RAB layout: a header in the first 12 rows names Bekisting at column V and Besi/Pembesian at Z. */
export function hasStageColumns(rows: unknown[][]): boolean {
  return rows.slice(0, 12).some((r) => /bekisting/i.test(text(r[COL.V])) && /besi|pembesian/i.test(text(r[COL.Z])));
}

/** Rows with a volume and at least one stage priced; a volume-less row with a label becomes the current section. */
export function rabConcreteRows(rows: unknown[][]): RabConcreteRow[] {
  const out: RabConcreteRow[] = [];
  let chapterTitle = '';
  let section = '';
  for (const r of rows) {
    const a = text(r[COL.A]);
    const b = text(r[COL.B]);
    if (ROMAN.test(a)) {
      chapterTitle = b;
      section = '';
      continue;
    }
    const volume = num(r[COL.D]);
    const bekisting = volume * num(r[COL.V]) * num(r[COL.W]);
    const pembesian = volume * num(r[COL.Z]) * num(r[COL.AA]);
    const pengecoran = volume * num(r[COL.R]);
    if (volume > 0 && (bekisting > 0 || pembesian > 0 || pengecoran > 0)) {
      out.push({ chapterTitle, section, label: b, volume, bekisting, pembesian, pengecoran });
    } else if (b && volume === 0) {
      section = b;
    }
  }
  return out;
}

export interface ClassTotals {
  rows: number;
  volume: number;
  bekisting: number;
  pembesian: number;
  pengecoran: number;
}

/** One sheet: classify every concrete row (ground decided across them), then total the fully priced rows per class. */
export function sheetClassTotals(rows: unknown[][]): Map<WorkAreaClass, ClassTotals> {
  const concrete = rabConcreteRows(rows);
  const classes = classifyWorkAreas(concrete.map((r) => {
    const label = r.label.replace(/^-\s*/, '');
    // A row label that names its element ("- Balok B24-1") beats the section it sits under ("Sloof & Balok").
    return { label, chapter: r.chapterTitle, sub_chapter: elementOf(label) ? label : (r.section || null) };
  }));
  const totals = new Map<WorkAreaClass, ClassTotals>();
  concrete.forEach((r, i) => {
    if (r.bekisting <= 0 || r.pembesian <= 0 || r.pengecoran <= 0) return;
    const t = totals.get(classes[i]) ?? { rows: 0, volume: 0, bekisting: 0, pembesian: 0, pengecoran: 0 };
    t.rows += 1;
    t.volume += r.volume;
    t.bekisting += r.bekisting;
    t.pembesian += r.pembesian;
    t.pengecoran += r.pengecoran;
    totals.set(classes[i], t);
  });
  return totals;
}

export interface WorkbookSheets {
  name: string;
  /** Every sheet's rows as arrays of cell values; sheets without the stage columns are skipped. */
  sheets: unknown[][][];
}

export function referenceProfile(workbooks: WorkbookSheets[]): ReferenceProfile {
  const perWorkbook = workbooks.map((wb) => {
    const totals = new Map<WorkAreaClass, ClassTotals>();
    for (const rows of wb.sheets) {
      if (!hasStageColumns(rows)) continue;
      for (const [cls, t] of sheetClassTotals(rows)) {
        const into = totals.get(cls) ?? { rows: 0, volume: 0, bekisting: 0, pembesian: 0, pengecoran: 0 };
        into.rows += t.rows;
        into.volume += t.volume;
        into.bekisting += t.bekisting;
        into.pembesian += t.pembesian;
        into.pengecoran += t.pengecoran;
        totals.set(cls, into);
      }
    }
    return totals;
  });

  const profile: ReferenceProfile = {};
  for (const cls of PROFILE_CLASSES) {
    const shares = perWorkbook
      .map((totals) => totals.get(cls))
      .filter((t): t is ClassTotals => t !== undefined)
      .map((t) => {
        const total = t.bekisting + t.pembesian + t.pengecoran;
        return { t, bekisting: t.bekisting / total, pembesian: t.pembesian / total, pengecoran: t.pengecoran / total };
      });
    if (shares.length === 0) continue;
    const mean = (key: 'bekisting' | 'pembesian' | 'pengecoran') => shares.reduce((a, s) => a + s[key], 0) / shares.length;
    const weights = weightsFromAmounts({ BEKISTING: mean('bekisting'), PEMBESIAN: mean('pembesian'), PENGECORAN: mean('pengecoran') });
    if (!weights) continue;
    profile[cls] = {
      weights,
      workbooks: shares.length,
      rows: shares.reduce((a, s) => a + s.t.rows, 0),
      volume_m3: Math.round(shares.reduce((a, s) => a + s.t.volume, 0)),
    };
  }
  return profile;
}
