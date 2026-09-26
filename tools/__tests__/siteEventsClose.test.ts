/**
 * The three calls a queued "Selesai" makes (closure spec 2026-09-26 §4.4),
 * each retried by the capture queue on its own:
 *
 *  • insertClosureMedia is an idempotent upsert into the EVENT's folder, so a
 *    retry after a lost response is a no-op, never a twin row;
 *  • closeSiteEventRpc tells "somebody closed it first" (NOT_OPEN, an outcome)
 *    apart from a refusal (permanent) and a hiccup (transient);
 *  • lookupSiteEventCloser reports the server's closer, and never turns a read
 *    failure into a claim about who closed the event.
 */
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));
jest.mock('../storage', () => ({
  readUploadBody: jest.fn(),
  resolvePhotoUrl: jest.fn(),
  SITE_MEDIA_PATH_PREFIX: 'site-media:',
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001') }));

import { supabase } from '../supabase';
import {
  closeSiteEventRpc,
  insertClosureMedia,
  lookupSiteEventCloser,
  mapSiteEventRpcError,
  type LocalSiteEventMedia,
} from '../siteEvents';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';

const mocked = supabase as unknown as { from: jest.Mock; rpc: jest.Mock };

const closurePhoto = (over: Partial<LocalSiteEventMedia> = {}): LocalSiteEventMedia => ({
  id: 'cm1', localUri: 'file:///q/job1/cm1.jpg', kind: 'photo', role: 'closure', mimeType: 'image/jpeg',
  ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: '2026-09-17T02:00:00.000Z', ...over,
});

/** An awaitable chain like a PostgrestFilterBuilder, resolving to `result` whatever the code awaits. */
function readChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => chain,
    then: (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

beforeEach(() => {
  mocked.from.mockReset();
  mocked.rpc.mockReset();
});

describe('insertClosureMedia', () => {
  it("upserts one closure row inside the event's folder, ignoring duplicates", async () => {
    const upsert = jest.fn(async () => ({ error: null }));
    mocked.from.mockReturnValue({ upsert });
    const result = await insertClosureMedia({ id: EVENT, projectId: PROJECT, media: [closurePhoto()] }, { cm1: 2048 });
    expect(result).toEqual({});
    expect(mocked.from).toHaveBeenCalledWith('site_event_media');
    expect(upsert).toHaveBeenCalledWith(
      [{
        id: 'cm1', event_id: EVENT, kind: 'photo', role: 'closure',
        storage_path: `site-events/${PROJECT}/${EVENT}/cm1.jpg`, mime_type: 'image/jpeg',
        duration_s: null, bytes: 2048, sort_order: 0, captured_at: '2026-09-17T02:00:00.000Z',
      }],
      { onConflict: 'id', ignoreDuplicates: true },
    );
  });

  it('forces kind photo and role closure whatever the carrier says', async () => {
    const upsert = jest.fn(async () => ({ error: null }));
    mocked.from.mockReturnValue({ upsert });
    await insertClosureMedia({ id: EVENT, projectId: PROJECT, media: [closurePhoto({ role: 'context' })] }, {});
    const calls = upsert.mock.calls as unknown as Array<[Array<Record<string, unknown>>]>;
    expect(calls[0][0][0]).toMatchObject({ kind: 'photo', role: 'closure', bytes: null });
  });

  it('writes nothing for a carrier with no photo', async () => {
    expect(await insertClosureMedia({ id: EVENT, projectId: PROJECT, media: [] }, {})).toEqual({});
    expect(mocked.from).not.toHaveBeenCalled();
  });

  it("maps the path guard's refusal and calls it permanent", async () => {
    mocked.from.mockReturnValue({
      upsert: jest.fn(async () => ({ error: { code: 'P0001', message: 'SITE_EVENT_MEDIA_PATH: path media harus diawali x' } })),
    });
    expect(await insertClosureMedia({ id: EVENT, projectId: PROJECT, media: [closurePhoto()] }, {})).toEqual({
      error: 'Lokasi berkas media tidak sesuai kejadian.',
      kind: 'permanent',
    });
  });
});

describe('closeSiteEventRpc', () => {
  it('sends the note it is given, trimmed upstream, and reports ok', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: { event_id: EVENT, status: 'done' }, error: null });
    expect(await closeSiteEventRpc(EVENT, 'Sudah ditambal')).toEqual({ ok: true });
    expect(mocked.rpc).toHaveBeenCalledWith('close_site_event', { p_event_id: EVENT, p_closure_note: 'Sudah ditambal' });
  });

  it('passes a null note through as null', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: {}, error: null });
    await closeSiteEventRpc(EVENT, null);
    expect(mocked.rpc).toHaveBeenCalledWith('close_site_event', { p_event_id: EVENT, p_closure_note: null });
  });

  it('reads SITE_EVENT_NOT_OPEN as an outcome, not an error', async () => {
    mocked.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'SITE_EVENT_NOT_OPEN: hanya kejadian terbuka yang bisa ditandai selesai (status sekarang done)' },
    });
    expect(await closeSiteEventRpc(EVENT, null)).toEqual({ notOpen: true });
  });

  it.each([
    ['SITE_EVENT_CLOSURE_PHOTO_REQUIRED: kejadian cacat hanya bisa ditandai selesai dengan foto penutupan.'],
    ['SITE_EVENT_CLOSURE_NOTE_REQUIRED: kejadian butuh keputusan wajib punya catatan keputusan minimal 10 karakter.'],
    ['SITE_EVENT_AUTH: Anda tidak ditugaskan ke proyek ini'],
    ['SITE_EVENT_NOT_FOUND: kejadian x tidak ditemukan'],
  ])("calls %s permanent, carrying the mapper's copy", async (message) => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { message } });
    expect(await closeSiteEventRpc(EVENT, null)).toEqual({ error: mapSiteEventRpcError(message), kind: 'permanent' });
  });

  it('maps a refusal it knows to its Indonesian sentence', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { message: 'SITE_EVENT_AUTH: Anda tidak ditugaskan ke proyek ini' } });
    expect(await closeSiteEventRpc(EVENT, null)).toEqual({ error: 'Anda tidak ditugaskan ke proyek ini.', kind: 'permanent' });
  });

  it('calls Postgres 42501 permanent', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied for function close_site_event' } });
    expect(await closeSiteEventRpc(EVENT, null)).toEqual({
      error: 'Gagal menyimpan: permission denied for function close_site_event',
      kind: 'permanent',
    });
  });

  it('calls a network error transient, so the queue keeps trying', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Network request failed' } });
    expect(await closeSiteEventRpc(EVENT, null)).toEqual({
      error: 'Gagal menyimpan: TypeError: Network request failed',
      kind: 'transient',
    });
  });
});

describe('lookupSiteEventCloser', () => {
  const doneRow = {
    id: EVENT, status: 'done', closed_at: '2026-09-17T07:05:00.000Z', closed_by: 'u9',
    site_event_media: [], rooms: null, owner: null, reporter: null, closer: { full_name: 'Budi Santoso' },
  };

  it("returns the server's closer and time for a done event", async () => {
    mocked.from.mockReturnValueOnce(readChain({ data: doneRow, error: null }));
    expect(await lookupSiteEventCloser(EVENT)).toEqual({ closedByName: 'Budi Santoso', closedAt: '2026-09-17T07:05:00.000Z' });
  });

  it('returns a null name, never a guess, when the service role closed it', async () => {
    mocked.from.mockReturnValueOnce(readChain({ data: { ...doneRow, closed_by: null, closer: null }, error: null }));
    expect(await lookupSiteEventCloser(EVENT)).toEqual({ closedByName: null, closedAt: '2026-09-17T07:05:00.000Z' });
  });

  it('calls a failed read transient', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.from.mockReturnValueOnce(readChain({ data: null, error: { message: 'network down' } }));
    expect(await lookupSiteEventCloser(EVENT)).toEqual({ error: 'Status kejadian gagal dibaca: network down', kind: 'transient' });
    warn.mockRestore();
  });

  it('calls a missing row or a status other than done permanent, with the NOT_OPEN copy', async () => {
    mocked.from.mockReturnValueOnce(readChain({ data: null, error: null }));
    expect(await lookupSiteEventCloser(EVENT)).toEqual({ error: 'Hanya kejadian terbuka yang bisa ditandai selesai.', kind: 'permanent' });
    mocked.from.mockReturnValueOnce(readChain({ data: { ...doneRow, status: 'open', closed_at: null }, error: null }));
    expect(await lookupSiteEventCloser(EVENT)).toEqual({ error: 'Hanya kejadian terbuka yang bisa ditandai selesai.', kind: 'permanent' });
  });
});
