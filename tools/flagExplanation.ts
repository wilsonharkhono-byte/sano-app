import type { ImportStagingRow } from './types';

export interface FlagExplanation {
  why: string;
  saran: string;
}

// Keyed by the `flag_reason` codes the v2 parser stamps into raw_data.
const FLAG_COPY: Record<string, FlagExplanation> = {
  orphan_ahs_block: {
    why: 'Resep harga ini ada di sheet Analisa, tapi tidak ada baris BoQ yang memakainya.',
    saran: 'Tolak jika ini template sisa yang tidak dipakai; Koreksi & isi Kode BoQ jika seharusnya ada yang memakai.',
  },
  literal_component: {
    why: 'Komponen ini berisi angka langsung tanpa rumus, jadi parser tidak bisa memastikan asal biayanya.',
    saran: 'Periksa angkanya. Setuju jika sudah benar; Koreksi jika perlu diperbaiki.',
  },
};

/**
 * Plain-Indonesian explanation of why a flagged review row needs checking and
 * a soft suggestion. Returns null when there's no *specific* reason to show —
 * a row that doesn't need review, or one whose `flag_reason` is unknown/missing
 * (e.g. stale rows imported before flag_reason existed). We deliberately do NOT
 * render a generic "dicek manual" callout: identical text on every card is
 * noise, not information. Fresh flagged rows always carry a real reason
 * (orphan_ahs_block / literal_component), so they still get a specific callout.
 */
export function flagExplanation(row: ImportStagingRow): FlagExplanation | null {
  if (!row.needs_review) return null;
  const raw = (row.raw_data ?? {}) as Record<string, unknown>;
  const reason = raw.flag_reason;
  if (typeof reason === 'string' && Object.prototype.hasOwnProperty.call(FLAG_COPY, reason)) {
    return FLAG_COPY[reason];
  }
  return null;
}

// Static, reason-independent captions for the three review actions.
export const ACTION_CAPTIONS = {
  setuju: 'pakai apa adanya di baseline',
  tolak: 'buang dari baseline',
  koreksi: 'perbaiki dulu, lalu masuk',
} as const;
