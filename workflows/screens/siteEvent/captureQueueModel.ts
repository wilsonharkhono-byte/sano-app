// SANO - Beranda offline-queue card rules (pure).

import {
  draftReadyCount,
  isCloseStatusUnreadable,
  waitingCount,
  type CaptureJob,
  type CaptureQueueEntry,
  type CloseJob,
} from '../../../tools/captureQueue';
import { formatWibShort } from '../../../tools/timeWindow';

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
 * tools/captureQueue.ts's queueBadgeText, which kept the older wording and
 * has since been removed (it was referenced only by its own test).
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

interface AttentionRowBase {
  id: string;
  title: string;
  reason: string;
}

/**
 * `action`: 'retry' offers "Coba lagi". 'discard' offers "Buang" - only where
 * there is genuinely nothing left to retry AND nothing on the server to lose.
 * 'cancel' offers "Batalkan" on a close job the server refused or whose photo
 * vanished; the event stays open. 'acknowledge' offers "Mengerti" on a close
 * job that found the event already closed, or no longer open with a status it
 * could not read (closeJobCancelKind).
 *
 * `confirm`: the confirmation a 'cancel' row asks before acting - always
 * present on that row, absent on every other.
 */
export type AttentionRow =
  | (AttentionRowBase & { action: 'retry' | 'discard' | 'acknowledge'; confirm?: undefined })
  | (AttentionRowBase & { action: 'cancel'; confirm: string });

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
 * A close job whose RPC answered NOT_OPEN and whose status read was then
 * refused for good (isCloseStatusUnreadable). Only what is known: the event is
 * not open any more. Never who closed it - nothing was read.
 */
export const REASON_CLOSE_STATUS_UNREADABLE = 'Kejadian sudah tidak terbuka di server; statusnya tidak bisa dibaca.';

/**
 * The one rule for what a person can do with a close job, for every surface
 * that shows one (the Beranda card here; the detail screen next), so no two
 * surfaces offer different ways out of the same job:
 *
 * - 'acknowledge' ("Mengerti"): the server already answered for good - the
 *   job is superseded, or its event is no longer open and its status cannot
 *   be read. Retrying repeats the answer; cancelling would hide it.
 * - 'cancel' ("Batalkan"): no outcome is recorded and no attempt can succeed -
 *   a permanent refusal, or the photo vanished before upload. The event stays
 *   open on the server.
 * - 'retry' ("Coba lagi"): flagged for attention after transient failures (or
 *   a failure after the close already landed, where only cleanup is left).
 * - null: nothing to offer - the job is on its way by itself, or done.
 */
export function closeJobCancelKind(
  job: Pick<CloseJob, 'state' | 'needsAttention' | 'unrecoverable' | 'lastFailureKind' | 'closeOutcome'>,
): 'retry' | 'cancel' | 'acknowledge' | null {
  if (job.state === 'superseded' || isCloseStatusUnreadable(job)) return 'acknowledge';
  if (!job.needsAttention) return null;
  if (job.closeOutcome === null && (job.unrecoverable || job.lastFailureKind === 'permanent')) return 'cancel';
  return 'retry';
}

/**
 * Beranda's "Perlu perhatian" list: every capture entry flagged after 5
 * consecutive failures, by a permanent refusal, or by missing local media -
 * plus every close job closeJobCancelKind offers an action on.
 *
 * A capture row offers "Buang" in exactly two cases, and both mean the same
 * thing: the report never reached the server and no further attempt can
 * change that - its local media is gone (unrecoverable), or the server
 * refused it with a decision rather than a hiccup. An entry whose event IS
 * inserted never gets "Buang", whatever else is true of it.
 */
export function attentionRows(entries: ReadonlyArray<CaptureQueueEntry>): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const e of entries) {
    if (e.kind === 'capture') {
      if (e.needsAttention) rows.push(captureRow(e));
      continue;
    }
    const action = closeJobCancelKind(e);
    if (action) rows.push(closeRow(e, action));
  }
  return rows;
}

function captureRow(e: CaptureJob): AttentionRow {
  return {
    id: e.id,
    title: e.rawText && e.rawText.trim() ? e.rawText.trim() : FALLBACK_TITLE,
    reason: e.eventInserted ? REASON_ALREADY_SENT : e.lastError ?? FALLBACK_REASON,
    action:
      !e.eventInserted && (e.unrecoverable || e.lastFailureKind === 'permanent')
        ? ('discard' as const)
        : ('retry' as const),
  };
}

/** "Sudah ditutup oleh {name} pada {17 Sep 14.05}." - the server's closer, never the queue owner (spec §1.1 rule 3). */
export function supersededReason(job: Pick<CloseJob, 'closedElsewhere'>): string {
  const info = job.closedElsewhere;
  if (!info) return 'Sudah ditutup.';
  const when = formatWibShort(info.closedAt);
  return info.closedByName ? `Sudah ditutup oleh ${info.closedByName} pada ${when}.` : `Sudah ditutup pada ${when}.`;
}

function closeRow(e: CloseJob, action: 'retry' | 'cancel' | 'acknowledge'): AttentionRow {
  if (e.state === 'superseded') {
    return { id: e.id, title: e.eventTitle, reason: supersededReason(e), action: 'acknowledge' };
  }
  const title = `Selesai: ${e.eventTitle}`;
  if (action === 'acknowledge') {
    return { id: e.id, title, reason: REASON_CLOSE_STATUS_UNREADABLE, action };
  }
  // A flagged job always carries lastError: recordFailure and markUnrecoverable
  // (whose close-job reason is REASON_CLOSURE_PHOTO_MISSING) both set it, and
  // every write that clears it clears needsAttention too. The fallback is for
  // the type only, the same one every other row uses.
  const reason = e.lastError ?? FALLBACK_REASON;
  if (action === 'retry') {
    return { id: e.id, title, reason, action };
  }
  return {
    id: e.id,
    title,
    reason,
    action: 'cancel',
    confirm: `Batalkan penutupan "${e.eventTitle}"? Kejadian tetap terbuka. Foto yang sudah terkirim tetap tersimpan sebagai bukti di kejadian itu.`,
  };
}
