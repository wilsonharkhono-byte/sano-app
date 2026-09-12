// SANO - Beranda offline-queue card rules (pure).

import {
  draftReadyCount,
  waitingCount,
  type CaptureQueueEntry,
} from '../../../tools/captureQueue';

/**
 * "Antrean: N menunggu sinyal · M terkirim ke server, menunggu analisis"
 * (spec §7), each half hidden when zero, null when both are.
 *
 * The second half deliberately does NOT say "draf siap dikonfirmasi". An
 * entry reaches draft_ready because the worker KICKED OFF the analysis, not
 * because a draft exists: captureQueueWorker.ts swallows every invoke
 * outcome by design (a 409, a spent daily cap, a network error), so after one
 * of those the event sits at pending_analysis on the server with no ai_draft
 * while this badge would have promised the supervisor a draft to confirm.
 * What is true in every case that reaches this state is that the report is on
 * the server and the analysis has not come back yet - so that is what it
 * says. Plan 2's "Draf menunggu" card, which reads real server state, is what
 * announces an actual draft.
 *
 * This is why the badge is built here rather than re-exporting
 * tools/captureQueue.ts's queueBadgeText: that function keeps the older
 * wording and is now referenced only by its own test (see the follow-up note
 * in the review hand-off).
 */
export function queueBadgeText(entries: ReadonlyArray<CaptureQueueEntry>): string | null {
  const waiting = waitingCount(entries);
  const ready = draftReadyCount(entries);
  if (waiting === 0 && ready === 0) return null;
  const parts: string[] = [];
  if (waiting > 0) parts.push(`${waiting} menunggu sinyal`);
  if (ready > 0) parts.push(`${ready} terkirim ke server, menunggu analisis`);
  // " · ", not ", ": the second half already contains a comma.
  return `Antrean: ${parts.join(' · ')}`;
}

/** Copy for the web capture screen (spec §7 point 6); shown on Platform.OS === 'web' only. */
export const WEB_QUEUE_WARNING =
  'Di web, kiriman tidak tersimpan bila halaman ditutup. Gunakan aplikasi Android di lapangan.';

/**
 * Success toast on web (Platform.OS === 'web' only): the web queue backend is
 * an in-memory Map (see captureQueueStore.ts), so nothing is durably "saved"
 * yet when Kirim returns — saying "Tersimpan" here would contradict
 * WEB_QUEUE_WARNING at the exact moment it matters most. Native keeps the
 * original 'Tersimpan, dikirim saat ada sinyal' wording, which is true there.
 */
export const WEB_QUEUED_TOAST =
  'Dikirim dari tab ini. Jangan tutup halaman sampai laporan muncul di Draf menunggu.';

export interface AttentionRow {
  id: string;
  title: string;
  reason: string;
  /**
   * 'retry' offers "Coba lagi"; 'discard' offers "Buang" - only where there
   * is genuinely nothing left to retry AND nothing on the server to lose.
   */
  action: 'retry' | 'discard';
}

const FALLBACK_TITLE = 'Laporan tanpa catatan';
const FALLBACK_REASON = 'Gagal setelah beberapa kali percobaan. Ketuk untuk mencoba lagi.';

/**
 * What a row whose event is already on the server says instead of its last
 * error. Such an entry is only still here because a local step after the
 * insert did not finish; the report itself is not at risk, and offering
 * "Buang" would be a lie in the other direction - discardEntryLocally
 * refuses it precisely because the server already has the row.
 */
const REASON_ALREADY_SENT = 'Sudah terkirim ke server; buka Draf menunggu.';

/**
 * Beranda's "Perlu perhatian" list: every entry flagged after 5 consecutive
 * failures, by a permanent refusal, or by missing local media.
 *
 * "Buang" is offered in exactly two cases, and both mean the same thing: the
 * report never reached the server and no further attempt can change that -
 * its local media is gone (unrecoverable), or the server refused it with a
 * decision rather than a hiccup (lastFailureKind 'permanent': a revoked
 * project assignment, an RLS refusal, an oversize file). Without this a
 * permanently-refused report would be stuck behind a "Coba lagi" that can
 * only ever fail again.
 *
 * An entry whose event IS inserted never gets "Buang", whatever else is true
 * of it: the row exists on the server, so discarding the local copy would
 * only hide it from the supervisor who is trying to act on it.
 */
export function attentionRows(entries: ReadonlyArray<CaptureQueueEntry>): AttentionRow[] {
  return entries
    .filter((e) => e.needsAttention)
    .map((e) => ({
      id: e.id,
      title: e.rawText && e.rawText.trim() ? e.rawText.trim() : FALLBACK_TITLE,
      reason: e.eventInserted ? REASON_ALREADY_SENT : e.lastError ?? FALLBACK_REASON,
      action:
        !e.eventInserted && (e.unrecoverable || e.lastFailureKind === 'permanent')
          ? ('discard' as const)
          : ('retry' as const),
    }));
}
