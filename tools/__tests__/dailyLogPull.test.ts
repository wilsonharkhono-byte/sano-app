jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../storage', () => ({ SITE_MEDIA_PATH_PREFIX: 'site-media:' }));

import {
  CLIENT_SAFE_EVENT_TYPES, mergePulledHighlights, proposeHighlightsFromEvents, proposePhotosFromEvents,
  type PullableEvent,
} from '../dailyLogPull';
import type { RoomLookupRow } from '../clientReportRooms';
import type { DailyLogHighlight } from '../dailySiteLogs';

const ROOMS: RoomLookupRow[] = [
  { id: 'r2', room_code: 'KM-UTAMA', room_name: 'Kamar Mandi Utama', floor: '2', sort_order: 0 },
  { id: 'r1', room_code: 'RK', room_name: 'Ruang Keluarga', floor: '1', sort_order: 0 },
  { id: 'ru', room_code: 'UMUM', room_name: 'Area Umum', floor: null, sort_order: 9999 },
];

function ev(p: Partial<PullableEvent> & { id: string }): PullableEvent {
  return {
    event_type: 'progres', title: 'Judul', summary: 'Ringkasan', room_id: 'r1',
    gate_code: 'C', confirmed_at: '2026-09-11T02:00:00Z', media: [], ...p,
  };
}

describe('proposeHighlightsFromEvents', () => {
  it('pre-selects only the two client-safe types', () => {
    expect([...CLIENT_SAFE_EVENT_TYPES]).toEqual(['progres', 'info']);
    const out = proposeHighlightsFromEvents([
      ev({ id: 'a', event_type: 'progres' }), ev({ id: 'b', event_type: 'info' }),
      ev({ id: 'c', event_type: 'isu' }), ev({ id: 'd', event_type: 'hambatan' }),
      ev({ id: 'e', event_type: 'cacat' }), ev({ id: 'f', event_type: 'butuh_keputusan' }),
    ], ROOMS);
    expect(out.filter((o) => o.preselected).map((o) => o.eventType)).toEqual(['progres', 'info']);
    expect(out.filter((o) => o.needsRewording).map((o) => o.eventType))
      .toEqual(['isu', 'hambatan', 'cacat', 'butuh_keputusan']);
  });

  it('lists the four internal types rather than hiding them', () => {
    const out = proposeHighlightsFromEvents([ev({ id: 'c', event_type: 'cacat' })], ROOMS);
    expect(out).toHaveLength(1);
    expect(out[0].preselected).toBe(false);
  });

  it('carries room_id, gate_code and source_event_id onto the line', () => {
    const [p] = proposeHighlightsFromEvents([ev({ id: 'a', room_id: 'r2', gate_code: 'B' })], ROOMS);
    expect(p.highlight).toEqual({
      area: 'Kamar Mandi Utama', note: 'Ringkasan', boq_item_id: null, sort_order: 0,
      room_id: 'r2', gate_code: 'B', source_event_id: 'a',
    });
  });

  it('falls back to the title when there is no summary, and skips an event with neither', () => {
    const out = proposeHighlightsFromEvents([
      ev({ id: 'a', summary: null, title: 'Hanya judul' }),
      ev({ id: 'b', summary: null, title: null }),
      ev({ id: 'c', summary: '   ', title: '  ' }),
    ], ROOMS);
    expect(out.map((o) => o.eventId)).toEqual(['a']);
    expect(out[0].highlight.note).toBe('Hanya judul');
  });

  it('orders proposals by room the way the board and the report order rooms', () => {
    const out = proposeHighlightsFromEvents([
      ev({ id: 'u', room_id: 'ru' }), ev({ id: 'two', room_id: 'r2' }), ev({ id: 'one', room_id: 'r1' }),
    ], ROOMS);
    expect(out.map((o) => o.roomLabel)).toEqual(['Ruang Keluarga', 'Kamar Mandi Utama', 'Area Umum']);
  });

  it('never proposes an event this log already pulled', () => {
    const out = proposeHighlightsFromEvents([ev({ id: 'a' }), ev({ id: 'b' })], ROOMS, ['a']);
    expect(out.map((o) => o.eventId)).toEqual(['b']);
  });

  it('ignores an unconfirmed event, which has no type yet', () => {
    expect(proposeHighlightsFromEvents([ev({ id: 'a', event_type: null })], ROOMS)).toEqual([]);
  });
});

describe('proposePhotosFromEvents', () => {
  const media = (id: string, role: 'context' | 'closeup' | 'closure' | 'audio', sort = 0) =>
    ({ id, kind: role === 'audio' ? ('audio' as const) : ('photo' as const), role, storage_path: `site-events/p/e/${id}.jpg`, sort_order: sort });

  it('offers context photos only, prefixed for the private bucket, never pre-featured', () => {
    const out = proposePhotosFromEvents([
      ev({ id: 'a', room_id: 'r2', media: [media('m1', 'context'), media('m2', 'closeup'), media('m3', 'closure'), media('m4', 'audio')] }),
    ], ROOMS);
    expect(out).toHaveLength(1);
    expect(out[0].roomLabel).toBe('Kamar Mandi Utama');
    expect(out[0].photo).toEqual({
      storage_path: 'site-media:site-events/p/e/m1.jpg', caption: null, is_featured: false,
      captured_at: '2026-09-11T02:00:00Z', room_id: 'r2', source_media_id: 'm1',
    });
  });

  it('skips media already pulled into this log', () => {
    const out = proposePhotosFromEvents([ev({ id: 'a', media: [media('m1', 'context'), media('m2', 'context', 1)] })], ROOMS, ['m1']);
    expect(out.map((o) => o.mediaId)).toEqual(['m2']);
  });
});

describe('mergePulledHighlights', () => {
  const line = (area: string, note: string): DailyLogHighlight =>
    ({ area, note, boq_item_id: null, sort_order: 0, room_id: null, gate_code: null, source_event_id: null });

  it('appends the picks after the curator lines and renumbers', () => {
    const picked = proposeHighlightsFromEvents([ev({ id: 'a', room_id: 'r1' })], ROOMS);
    const merged = mergePulledHighlights([line('Tangga', 'Finishing'), line('', '')], picked);
    expect(merged.map((h) => [h.area, h.sort_order])).toEqual([['Tangga', 0], ['Ruang Keluarga', 1]]);
  });
});
