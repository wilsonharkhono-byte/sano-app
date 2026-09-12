// SANO - Beranda offline-queue card rules (pure).

import {
  queueBadgeText,
  type CaptureQueueEntry,
} from '../../../tools/captureQueue';

export { queueBadgeText };

/** Copy for the web capture screen (spec §7 point 6); shown on Platform.OS === 'web' only. */
export const WEB_QUEUE_WARNING =
  'Di web, kiriman tidak tersimpan bila halaman ditutup. Gunakan aplikasi Android di lapangan.';

export interface AttentionRow {
  id: string;
  title: string;
  reason: string;
  /** 'retry' offers "Coba lagi"; 'discard' offers "Buang" (local files are gone, nothing to retry). */
  action: 'retry' | 'discard';
}

const FALLBACK_TITLE = 'Laporan tanpa catatan';
const FALLBACK_REASON = 'Gagal setelah beberapa kali percobaan. Ketuk untuk mencoba lagi.';

/** Beranda's "Perlu perhatian" list: every entry flagged after 5 consecutive failures, or an unrecoverable one. */
export function attentionRows(entries: ReadonlyArray<CaptureQueueEntry>): AttentionRow[] {
  return entries
    .filter((e) => e.needsAttention)
    .map((e) => ({
      id: e.id,
      title: e.rawText && e.rawText.trim() ? e.rawText.trim() : FALLBACK_TITLE,
      reason: e.lastError ?? FALLBACK_REASON,
      action: e.unrecoverable ? 'discard' : 'retry',
    }));
}
