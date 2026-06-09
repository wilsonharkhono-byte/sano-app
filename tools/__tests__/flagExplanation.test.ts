import { flagExplanation, ACTION_CAPTIONS } from '../flagExplanation';
import type { ImportStagingRow } from '../types';

function row(partial: Partial<ImportStagingRow>): ImportStagingRow {
  return {
    id: 'id', session_id: 's', row_number: 1, row_type: 'ahs',
    raw_data: {}, parsed_data: {}, confidence: 0.5, needs_review: true,
    review_status: 'PENDING', reviewer_notes: null, created_at: '',
    ...partial,
  } as ImportStagingRow;
}

describe('flagExplanation', () => {
  it('returns null for a row that does not need review', () => {
    expect(flagExplanation(row({ needs_review: false }))).toBeNull();
  });

  it('explains an orphan AHS block', () => {
    const r = row({ row_type: 'ahs_block', raw_data: { flag_reason: 'orphan_ahs_block' } });
    const fx = flagExplanation(r);
    expect(fx).not.toBeNull();
    expect(fx!.why).toBe('Resep harga ini ada di sheet Analisa, tapi tidak ada baris BoQ yang memakainya.');
    expect(fx!.saran).toContain('Tolak jika ini template sisa');
  });

  it('explains a literal component', () => {
    const r = row({ raw_data: { flag_reason: 'literal_component' } });
    const fx = flagExplanation(r);
    expect(fx!.why).toBe('Komponen ini berisi angka langsung tanpa rumus, jadi parser tidak bisa memastikan asal biayanya.');
    expect(fx!.saran).toContain('Periksa angkanya');
  });

  it('falls back to a generic explanation when flagged but the reason is unknown/missing', () => {
    const fx = flagExplanation(row({ raw_data: {} }));
    expect(fx!.why).toBe('Baris ini ditandai untuk dicek manual.');
    expect(fx!.saran).toContain('Periksa nilainya');
  });

  it('treats prototype-inherited keys as an unknown reason (generic)', () => {
    const fx = flagExplanation(row({ raw_data: { flag_reason: 'constructor' } }));
    expect(fx!.why).toBe('Baris ini ditandai untuk dicek manual.');
  });

  it('exposes static action captions', () => {
    expect(ACTION_CAPTIONS.setuju).toBe('pakai apa adanya di baseline');
    expect(ACTION_CAPTIONS.tolak).toBe('buang dari baseline');
    expect(ACTION_CAPTIONS.koreksi).toBe('perbaiki dulu, lalu masuk');
  });
});
