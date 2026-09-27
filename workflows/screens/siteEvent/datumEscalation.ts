// What the event detail says about DATUM (spec 2026-09-27 §8.3). Pure.
// Only the server's record counts: "Dikirim" needs the card id the sync
// stored after DATUM answered; "Belum dikirim" is said only where a sync
// would send it (an open butuh_keputusan on a paired project).

import { formatWibShort } from '../../../tools/timeWindow';
import type { SiteEventWithMedia } from '../../../tools/siteEvents';

export type DatumEscalationView =
  | { kind: 'sent'; label: string; url: string | null }
  | { kind: 'waiting'; label: string }
  | { kind: 'none' };

export const DATUM_DETAIL_COPY = {
  sentLabel: 'Dikirim ke DATUM',
  open: 'Buka kartu DATUM',
  waiting: 'Belum dikirim ke DATUM. Terkirim pada sinkron berikutnya.',
} as const;

export function datumEscalationView(
  ev: Pick<SiteEventWithMedia, 'status' | 'event_type' | 'datum_card_id' | 'datum_card_url' | 'datum_escalated_at' | 'project_datum_code'>,
): DatumEscalationView {
  if (ev.datum_card_id) {
    return {
      kind: 'sent',
      label: ev.datum_escalated_at ? formatWibShort(ev.datum_escalated_at) : '—',
      url: ev.datum_card_url ?? null,
    };
  }
  if (ev.status === 'open' && ev.event_type === 'butuh_keputusan' && ev.project_datum_code) {
    return { kind: 'waiting', label: DATUM_DETAIL_COPY.waiting };
  }
  return { kind: 'none' };
}

/** "27 Sep 10.00 · oleh Siti" when the confirmer is known; the time alone otherwise. */
export function confirmedLine(when: string, confirmerName: string | null): string {
  return confirmerName ? `${when} · oleh ${confirmerName}` : when;
}
