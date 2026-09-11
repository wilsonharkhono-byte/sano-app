/**
 * What the supervisor collected becomes exactly one NewSiteEvent. The rules
 * that matter on site: no context photo, no send (spec §5.2); media keep a
 * stable order (context first, then close-ups as taken, then the voice note);
 * the event's capture time is when the context photo was taken, not when a
 * slow network finally let it send.
 */
import {
  CAPTURE_ERRORS,
  buildNewSiteEvent,
  canSend,
  removeAt,
  replaceAt,
  type CaptureDraft,
  type CapturePhoto,
} from '../screens/siteEvent/captureModel';

const photo = (id: string, capturedAt = '2026-09-10T02:00:00.000Z'): CapturePhoto => ({
  id,
  photo: { uri: `file:///${id}.jpg`, contentType: 'image/jpeg', ext: 'jpg', capturedAt },
});

const draft = (over: Partial<CaptureDraft> = {}): CaptureDraft => ({
  eventId: 'e1',
  projectId: 'p1',
  roomId: 'r1',
  reporterId: 'u1',
  gateCode: 'B',
  note: '  Nat keramik retak di dekat floor drain  ',
  context: photo('ctx', '2026-09-10T01:59:00.000Z'),
  closeups: [photo('c1'), photo('c2')],
  voice: {
    id: 'v1', uri: 'file:///v1.m4a', durationMs: 12_340, mimeType: 'audio/mp4', ext: 'm4a',
    capturedAt: '2026-09-10T02:01:00.000Z',
  },
  ...over,
});

describe('canSend', () => {
  it('refuses to send without a context photo', () => {
    expect(canSend(draft({ context: null }))).toEqual({ ok: false, reason: CAPTURE_ERRORS.context });
    expect(canSend(draft())).toEqual({ ok: true });
  });

  it('refuses more than five close-ups', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => photo(id));
    expect(canSend(draft({ closeups: six }))).toEqual({ ok: false, reason: CAPTURE_ERRORS.closeups });
  });
});

describe('buildNewSiteEvent', () => {
  it('orders media context first, then close-ups as taken, then the voice note', () => {
    const ev = buildNewSiteEvent(draft(), '2026-09-10T05:00:00.000Z');
    expect(ev.media.map((m) => [m.id, m.kind, m.role, m.sortOrder])).toEqual([
      ['ctx', 'photo', 'context', 0],
      ['c1', 'photo', 'closeup', 1],
      ['c2', 'photo', 'closeup', 2],
      ['v1', 'audio', 'audio', 0],
    ]);
    expect(ev.media[3]).toMatchObject({ localUri: 'file:///v1.m4a', mimeType: 'audio/mp4', ext: 'm4a', durationS: 12.3 });
    expect(ev.media[0]).toMatchObject({ localUri: 'file:///ctx.jpg', mimeType: 'image/jpeg', ext: 'jpg', durationS: null });
  });

  it('uses the context photo time as the capture time, and now only when there is none', () => {
    expect(buildNewSiteEvent(draft(), '2026-09-10T05:00:00.000Z').capturedAt).toBe('2026-09-10T01:59:00.000Z');
    expect(buildNewSiteEvent(draft({ context: null }), '2026-09-10T05:00:00.000Z').capturedAt).toBe('2026-09-10T05:00:00.000Z');
  });

  it('trims the note, sends a blank note as null, and passes the gate hint through', () => {
    const ev = buildNewSiteEvent(draft(), '2026-09-10T05:00:00.000Z');
    expect(ev).toMatchObject({ id: 'e1', projectId: 'p1', roomId: 'r1', reporterId: 'u1', gateCode: 'B', rawText: 'Nat keramik retak di dekat floor drain' });
    expect(buildNewSiteEvent(draft({ note: '   ' }), '2026-09-10T05:00:00.000Z').rawText).toBeNull();
  });
});

describe('list helpers', () => {
  it('replaces and removes by index without mutating', () => {
    const items = ['a', 'b', 'c'];
    expect(replaceAt(items, 1, 'x')).toEqual(['a', 'x', 'c']);
    expect(removeAt(items, 0)).toEqual(['b', 'c']);
    expect(items).toEqual(['a', 'b', 'c']);
  });
});
