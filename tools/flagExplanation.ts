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

// Shown when a row is flagged but carries no recognized reason (stale rows,
// or a future trigger that didn't stamp a code). Honest, never a wrong reason.
const GENERIC: FlagExplanation = {
  why: 'Baris ini ditandai untuk dicek manual.',
  saran: 'Periksa nilainya; Setuju jika benar, Koreksi jika perlu, Tolak jika tidak relevan.',
};

/**
 * Plain-Indonesian explanation of why a flagged review row needs checking and
 * a soft suggestion. Returns null for rows that don't need review (no callout).
 */
export function flagExplanation(row: ImportStagingRow): FlagExplanation | null {
  if (!row.needs_review) return null;
  const raw = (row.raw_data ?? {}) as Record<string, unknown>;
  const reason = raw.flag_reason;
  if (typeof reason === 'string' && Object.prototype.hasOwnProperty.call(FLAG_COPY, reason)) {
    return FLAG_COPY[reason];
  }
  return GENERIC;
}

// Static, reason-independent captions for the three review actions.
export const ACTION_CAPTIONS = {
  setuju: 'pakai apa adanya di baseline',
  tolak: 'buang dari baseline',
  koreksi: 'perbaiki dulu, lalu masuk',
} as const;
