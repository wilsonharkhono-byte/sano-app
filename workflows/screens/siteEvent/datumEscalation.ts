// What the event detail says about DATUM (spec 2026-09-27 §8.3). Pure.
// Only the server's record counts: "Dikirim" needs the card id the sync
// stored after DATUM answered. An open butuh_keputusan on a paired project
// is "Belum dikirim"; "the next sync" is promised only when its room is
// linked to a DATUM area, because the sync sends nothing from an unlinked
// room (it lists it under ESCALATE_ROOM_UNLINKED instead).

import { formatWibShort } from '../../../tools/timeWindow';
import type { SiteEventWithMedia } from '../../../tools/siteEvents';
import { ESCALATE_ROOM_UNLINKED } from '../../../tools/datumSyncPlan';

export type DatumEscalationView =
  | { kind: 'sent'; label: string; url: string | null }
  | { kind: 'waiting'; label: string }
  | { kind: 'none' };

export const DATUM_DETAIL_COPY = {
  sentLabel: 'Dikirim ke DATUM',
  open: 'Buka kartu DATUM',
  waiting: 'Belum dikirim ke DATUM. Terkirim pada sinkron berikutnya.',
  unlinked: `Belum dikirim ke DATUM: ${ESCALATE_ROOM_UNLINKED}`,
} as const;

export function datumEscalationView(
  ev: Pick<
    SiteEventWithMedia,
    'status' | 'event_type' | 'datum_card_id' | 'datum_card_url' | 'datum_escalated_at' | 'project_datum_code' | 'room_datum_area_id'
  >,
): DatumEscalationView {
  if (ev.datum_card_id) {
    return {
      kind: 'sent',
      label: ev.datum_escalated_at ? formatWibShort(ev.datum_escalated_at) : '—',
      url: ev.datum_card_url ?? null,
    };
  }
  if (ev.status === 'open' && ev.event_type === 'butuh_keputusan' && ev.project_datum_code) {
    return { kind: 'waiting', label: ev.room_datum_area_id ? DATUM_DETAIL_COPY.waiting : DATUM_DETAIL_COPY.unlinked };
  }
  return { kind: 'none' };
}

/** "27 Sep 10.00 · oleh Siti" when the confirmer is known; the time alone otherwise. */
export function confirmedLine(when: string, confirmerName: string | null): string {
  return confirmerName ? `${when} · oleh ${confirmerName}` : when;
}
