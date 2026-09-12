/**
 * The client half of the capture pipeline. What matters here is order and
 * idempotency, because plan 3's offline queue will retry these exact functions:
 *
 *  • every media file is uploaded BEFORE the event row exists, so a
 *    transcription failure can never lose a recording (spec §6 stage 1);
 *  • inserts are ON CONFLICT DO NOTHING on client ids, and a duplicate upload
 *    counts as success, so a retry after a lost response cannot duplicate;
 *  • nothing is inserted if an upload failed, and the function is never
 *    invoked for an event that does not exist yet;
 *  • confirm validates locally and never calls the RPC with input it knows the
 *    server will refuse.
 */
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    storage: { from: jest.fn() },
    functions: { invoke: jest.fn() },
  },
}));
jest.mock('../storage', () => ({
  readUploadBody: jest.fn(async (uri: string) => ({ body: new ArrayBuffer(8), bytes: uri.length })),
  resolvePhotoUrl: jest.fn(async (path: string) => (path.includes('missing') ? '' : `signed:${path}`)),
  SITE_MEDIA_PATH_PREFIX: 'site-media:',
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001') }));

import fs from 'node:fs';
import path from 'node:path';
import { supabase } from '../supabase';
import { resolvePhotoUrl } from '../storage';
import {
  buildConfirmRpcArgs,
  buildEventRow,
  buildMediaRows,
  closeSiteEvent,
  confirmSiteEvent,
  createSiteEventWithMedia,
  discardSiteEvent,
  getRoomLastGate,
  getSiteEvent,
  invokeSiteEventAnalysis,
  isDuplicateUploadError,
  listConfirmedEventsForDay,
  listDraftEvents,
  listOpenEventsForRoom,
  mapSiteEventRpcError,
  newSiteEventId,
  RPC_ERROR_COPY,
  saveTranscriptEdit,
  signedMediaUrl,
  siteEventMediaPath,
  validateNewSiteEvent,
  workGroupHints,
  type LocalSiteEventMedia,
  type NewSiteEvent,
} from '../siteEvents';
import type { ConfirmInput } from '../siteEventRules';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';

const media = (over: Partial<LocalSiteEventMedia> = {}): LocalSiteEventMedia => ({
  id: 'm-context', localUri: 'file:///context.jpg', kind: 'photo', role: 'context', mimeType: 'image/jpeg',
  ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: '2026-09-10T03:00:00.000Z', ...over,
});

const voice = media({
  id: 'm-voice', localUri: 'file:///voice.m4a', kind: 'audio', role: 'audio', mimeType: 'audio/mp4', ext: 'm4a', durationS: 12.4,
});

const capture = (over: Partial<NewSiteEvent> = {}): NewSiteEvent => ({
  id: EVENT, projectId: PROJECT, roomId: 'room-1', reporterId: 'user-1', gateCode: 'B',
  rawText: '  Waterproofing belum kering  ', capturedAt: '2026-09-10T03:00:00.000Z',
  media: [media(), voice], ...over,
});

const confirmInput = (over: Partial<ConfirmInput> = {}): ConfirmInput => ({
  eventType: 'isu', gateCode: null, stepCode: 'B4', activeSteps: [], title: '  Retak   acian ', summary: '   ', ownerId: 'user-2',
  dueDate: '2026-09-12', downstreamImpact: '', isBlocking: false, voConfirm: false, relatedEventId: null,
  transcriptEdited: '  ', draft: null, aiMismatch: false, mismatchAcknowledged: false, today: '2026-09-10', ...over,
});

const mocked = supabase as unknown as {
  from: jest.Mock;
  rpc: jest.Mock;
  storage: { from: jest.Mock };
  functions: { invoke: jest.Mock };
};

const calls: string[] = [];
let uploadError: unknown = null;

/**
 * A minimal chainable query-builder double for the read/read-back tests below.
 * Every method records its call (name + JSON-stringified args) into `calls`
 * and returns the same chain, so `.eq().eq().order().order().limit()` and
 * `.update().eq().in().select()` both work regardless of where the real code
 * stops chaining — and the chain is itself awaitable (real PostgrestFilterBuilders
 * are too), resolving to `result` no matter which method the code awaits.
 */
function makeChain(result: { data: unknown; error: unknown }) {
  const record = (name: string, ...args: unknown[]) => {
    calls.push(`${name}:${args.map((a) => JSON.stringify(a)).join(':')}`);
    return chain;
  };
  const chain: Record<string, unknown> = {
    select: (...args: unknown[]) => record('select', ...args),
    eq: (...args: unknown[]) => record('eq', ...args),
    in: (...args: unknown[]) => record('in', ...args),
    order: (...args: unknown[]) => record('order', ...args),
    limit: (...args: unknown[]) => record('limit', ...args),
    update: (...args: unknown[]) => record('update', ...args),
    maybeSingle: (...args: unknown[]) => record('maybeSingle', ...args),
    then: (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

beforeEach(() => {
  calls.length = 0;
  uploadError = null;
  mocked.rpc.mockReset();
  mocked.storage.from.mockImplementation((bucket: string) => ({
    upload: jest.fn(async (path: string) => {
      calls.push(`upload:${bucket}:${path}`);
      return { error: uploadError };
    }),
  }));
  mocked.from.mockImplementation((table: string) => ({
    upsert: jest.fn(async (_rows: unknown, opts: { onConflict: string; ignoreDuplicates: boolean }) => {
      calls.push(`upsert:${table}:${opts.onConflict}:${opts.ignoreDuplicates}`);
      return { error: null };
    }),
  }));
  mocked.functions.invoke.mockImplementation(async (name: string, opts: { body: Record<string, unknown> }) => {
    calls.push(`invoke:${name}:${String(opts.body.event_id)}`);
    return { data: { ok: true, code: 'ANALYZED', status: 'draft' }, error: null };
  });
});

describe('pure helpers', () => {
  it('builds the storage path migration 097 expects', () => {
    expect(siteEventMediaPath(PROJECT, EVENT, 'm1', '.JPG')).toBe(`site-events/${PROJECT}/${EVENT}/m1.jpg`);
  });

  it('generates ids with expo-crypto', () => {
    expect(newSiteEventId()).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('requires one context photo, at most five close-ups, one voice note, and no closure photo at capture', () => {
    expect(validateNewSiteEvent(capture())).toBeNull();
    expect(validateNewSiteEvent(capture({ media: [voice] }))).toBe('Foto konteks wajib diambil.');
    const sixCloseups = Array.from({ length: 6 }, (_, i) => media({ id: `c${i}`, role: 'closeup', sortOrder: i + 1 }));
    expect(validateNewSiteEvent(capture({ media: [media(), ...sixCloseups] }))).toBe('Close-up maksimal 5 foto.');
    expect(validateNewSiteEvent(capture({ media: [media(), voice, { ...voice, id: 'm-voice-2' }] }))).toBe('Rekaman suara hanya satu.');
    expect(validateNewSiteEvent(capture({ media: [media(), media({ id: 'x', role: 'closure' })] }))).toMatch(/penutupan/);
  });

  it('inserts only the capture columns, pending, with a trimmed note', () => {
    expect(buildEventRow(capture())).toEqual({
      id: EVENT, project_id: PROJECT, room_id: 'room-1', reporter_id: 'user-1', status: 'pending_analysis',
      gate_code: 'B', raw_text: 'Waterproofing belum kering', captured_at: '2026-09-10T03:00:00.000Z',
    });
    expect(buildEventRow(capture({ rawText: '   ' })).raw_text).toBeNull();
  });

  it('builds media rows with paths, sizes, and a duration only for audio', () => {
    const rows = buildMediaRows(capture(), { 'm-context': 1234, 'm-voice': 5678 });
    expect(rows).toEqual([
      {
        id: 'm-context', event_id: EVENT, kind: 'photo', role: 'context',
        storage_path: `site-events/${PROJECT}/${EVENT}/m-context.jpg`, mime_type: 'image/jpeg',
        duration_s: null, bytes: 1234, sort_order: 0, captured_at: '2026-09-10T03:00:00.000Z',
      },
      {
        id: 'm-voice', event_id: EVENT, kind: 'audio', role: 'audio',
        storage_path: `site-events/${PROJECT}/${EVENT}/m-voice.m4a`, mime_type: 'audio/mp4',
        duration_s: 12.4, bytes: 5678, sort_order: 0, captured_at: '2026-09-10T03:00:00.000Z',
      },
    ]);
  });

  it('recognises a duplicate upload in every shape storage-js reports it', () => {
    expect(isDuplicateUploadError({ status: 409 })).toBe(true);
    expect(isDuplicateUploadError({ statusCode: '409' })).toBe(true);
    expect(isDuplicateUploadError({ message: 'The resource already exists' })).toBe(true);
    expect(isDuplicateUploadError({ status: 400, message: 'mime type not supported' })).toBe(false);
    expect(isDuplicateUploadError(null)).toBe(false);
  });

  it('maps every RPC and guard prefix to Indonesian, without confusing similar codes', () => {
    expect(mapSiteEventRpcError('SITE_EVENT_OWNER_NOT_MEMBER: pemilik harus anggota')).toBe('Pemilik harus anggota tim proyek.');
    expect(mapSiteEventRpcError('SITE_EVENT_OWNER_REQUIRED: jenis isu')).toBe('Pemilik dan tenggat wajib diisi untuk jenis ini.');
    expect(mapSiteEventRpcError('SITE_EVENT_STEP_NOT_IN_GATE: langkah "D1" bukan bagian dari gerbang B.')).toBe('Langkah yang dipilih bukan bagian dari gerbang ini. Pilih ulang langkahnya.');
    expect(mapSiteEventRpcError('SITE_EVENT_STEP: langkah "D1" tidak aktif atau tidak ada')).toBe('Langkah yang dipilih sudah tidak aktif. Pilih langkah lain.');
    expect(mapSiteEventRpcError('SITE_EVENT_STATE: kejadian berstatus open')).toMatch(/sudah dikonfirmasi/);
    expect(mapSiteEventRpcError('SITE_EVENT_HUMAN_FIELDS: isi kejadian')).toMatch(/Konfirmasi atau Selesai/);
    expect(mapSiteEventRpcError('network down')).toBe('Gagal menyimpan: network down');
    expect(mapSiteEventRpcError(null)).toBe('Gagal menyimpan. Coba lagi.');
  });

  it('builds the 13 RPC arguments, normalizing what the server would otherwise refuse', () => {
    const args = buildConfirmRpcArgs(EVENT, confirmInput());
    expect(Object.keys(args)).toEqual([
      'p_event_id', 'p_event_type', 'p_gate_code', 'p_step_code', 'p_title', 'p_summary', 'p_owner_id', 'p_due_date',
      'p_downstream_impact', 'p_is_blocking', 'p_vo_confirm', 'p_related_event_id', 'p_transcript_edited',
    ]);
    expect(args.p_title).toBe('Retak acian');
    expect(args.p_summary).toBeNull();
    expect(args.p_step_code).toBeNull();
    expect(args.p_downstream_impact).toBeNull();
    expect(args.p_transcript_edited).toBeNull();
  });

  it('turns BoQ rows into at most 30 unique work-group names for the prompt', () => {
    const items = Array.from({ length: 120 }, (_, i) => ({
      id: `b${i}`, label: `Item ${i}`, chapter: `BAB ${i % 45}`, sub_chapter: null, sort_order: i, code: `${i}`,
    }));
    const names = workGroupHints(items);
    expect(names.length).toBeLessThanOrEqual(30);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => typeof n === 'string' && n.length > 0)).toBe(true);
    expect(workGroupHints([])).toEqual([]);
  });
});

describe('createSiteEventWithMedia', () => {
  it('uploads every file, then inserts the event, then its media, then invokes the analysis', async () => {
    const result = await createSiteEventWithMedia(capture(), { workGroupNames: ['Finishing Lantai 2'] });
    expect(result.error).toBeUndefined();
    await expect(result.analysis).resolves.toEqual({ ok: true, code: 'ANALYZED', status: 'draft' });
    expect(calls).toEqual([
      `upload:site-media:site-events/${PROJECT}/${EVENT}/m-context.jpg`,
      `upload:site-media:site-events/${PROJECT}/${EVENT}/m-voice.m4a`,
      'upsert:site_events:id:true',
      'upsert:site_event_media:id:true',
      `invoke:site-event-analyze:${EVENT}`,
    ]);
    expect(mocked.functions.invoke).toHaveBeenCalledWith('site-event-analyze', {
      body: { event_id: EVENT, force: false, work_group_names: ['Finishing Lantai 2'] },
    });
  });

  it('stops before inserting anything when an upload fails, and never invokes', async () => {
    uploadError = { status: 400, message: 'mime type audio/ogg is not supported' };
    const result = await createSiteEventWithMedia(capture());
    expect(result.error).toMatch(/Unggah foto gagal: mime type/);
    expect(result.analysis).toBeNull();
    expect(calls.filter((c) => !c.startsWith('upload:'))).toEqual([]);
  });

  it('treats an already-uploaded file as success, so a retry completes', async () => {
    uploadError = { statusCode: '409', message: 'The resource already exists' };
    const result = await createSiteEventWithMedia(capture());
    expect(result.error).toBeUndefined();
    expect(calls).toContain('upsert:site_events:id:true');
  });

  it('refuses an invalid capture before touching the network', async () => {
    const result = await createSiteEventWithMedia(capture({ media: [voice] }));
    expect(result.error).toBe('Foto konteks wajib diambil.');
    expect(calls).toEqual([]);
  });
});

describe('invokeSiteEventAnalysis', () => {
  it('returns the function body when the function answered with a non-2xx status', async () => {
    mocked.functions.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: { json: async () => ({ ok: false, code: 'FORBIDDEN', error: 'Anda tidak ditugaskan ke proyek ini.' }) } },
    });
    await expect(invokeSiteEventAnalysis(EVENT, { force: true })).resolves.toEqual({
      ok: false, code: 'FORBIDDEN', error: 'Anda tidak ditugaskan ke proyek ini.',
    });
  });

  it('says plainly that analysis could not start when there is no response body', async () => {
    mocked.functions.invoke.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    const r = await invokeSiteEventAnalysis(EVENT);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVOKE_FAILED');
    expect(r.error).toMatch(/Analisis ulang/);
  });
});

describe('confirmSiteEvent', () => {
  it('validates locally and never calls the RPC with input the server would refuse', async () => {
    const r = await confirmSiteEvent(EVENT, confirmInput({ ownerId: null, dueDate: null, stepCode: null }));
    expect(r.errors).toEqual([
      'Pemilik wajib dipilih untuk isu, hambatan, cacat dan butuh keputusan.',
      'Tenggat wajib diisi untuk isu, hambatan, cacat dan butuh keputusan.',
    ]);
    expect(mocked.rpc).not.toHaveBeenCalled();
  });

  it('calls confirm_site_event and maps a server refusal', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { message: 'SITE_EVENT_DUE: tenggat 2026-09-09 sudah lewat' } });
    const r = await confirmSiteEvent(EVENT, confirmInput({ stepCode: null }));
    expect(mocked.rpc).toHaveBeenCalledWith('confirm_site_event', expect.objectContaining({ p_event_id: EVENT, p_event_type: 'isu' }));
    expect(r.error).toBe('Tenggat tidak boleh sebelum hari ini.');
  });

  it('returns the RPC result on success', async () => {
    const payload = { event_id: EVENT, status: 'open', vo_flag: 'none', site_change_id: null, ai_used: true, notified: true };
    mocked.rpc.mockResolvedValueOnce({ data: payload, error: null });
    await expect(confirmSiteEvent(EVENT, confirmInput({ stepCode: null }))).resolves.toEqual({ result: payload });
  });
});

describe('signedMediaUrl', () => {
  it('signs through the private-bucket prefix and returns null when it cannot', async () => {
    await expect(signedMediaUrl('site-events/p/e/a.jpg')).resolves.toBe('signed:site-media:site-events/p/e/a.jpg');
    await expect(signedMediaUrl('site-events/p/e/missing.jpg')).resolves.toBeNull();
    expect(resolvePhotoUrl).toHaveBeenCalledWith('site-media:site-events/p/e/a.jpg');
  });
});

describe('discardSiteEvent', () => {
  it('reports refusal, without claiming which reason, when the read-back matches no row', async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: [], error: null }));
    const r = await discardSiteEvent(EVENT);
    expect(r.error).toBe('Kejadian tidak ditemukan, bukan milik Anda, atau sudah tidak bisa dibuang.');
  });

  it('succeeds when the guarded update matches exactly one row', async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: [{ id: EVENT }], error: null }));
    const r = await discardSiteEvent(EVENT);
    expect(r.error).toBeUndefined();
  });

  it('maps a database error instead of reporting the RLS refusal message', async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: null, error: { message: 'network down' } }));
    const r = await discardSiteEvent(EVENT);
    expect(r.error).toBe('Gagal menyimpan: network down');
  });
});

describe('saveTranscriptEdit', () => {
  it('reports refusal, without claiming which reason, when the read-back matches no row', async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: [], error: null }));
    const r = await saveTranscriptEdit(EVENT, '  koreksi  ');
    expect(r.error).toBe('Kejadian tidak ditemukan, bukan milik Anda, atau transkrip sudah tidak bisa diubah.');
  });

  it('succeeds and stores the trimmed transcript when the read-back matches one row', async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: [{ id: EVENT }], error: null }));
    const r = await saveTranscriptEdit(EVENT, '  koreksi transkrip  ');
    expect(r.error).toBeUndefined();
    expect(calls).toContain('update:{"transcript_edited":"koreksi transkrip"}');
  });

  it('stores null, not an empty string, for blank text', async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: [{ id: EVENT }], error: null }));
    await saveTranscriptEdit(EVENT, '   ');
    expect(calls).toContain('update:{"transcript_edited":null}');
  });
});

describe('closeSiteEvent', () => {
  it('maps SITE_EVENT_NOT_OPEN to its Indonesian copy', async () => {
    mocked.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'SITE_EVENT_NOT_OPEN: hanya kejadian terbuka yang bisa ditandai selesai (status sekarang done)' },
    });
    const r = await closeSiteEvent({ eventId: EVENT, projectId: PROJECT, note: 'selesai' });
    expect(r.error).toBe('Hanya kejadian terbuka yang bisa ditandai selesai.');
  });

  it('returns ok, trimming the closure note, on success', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: { event_id: EVENT, status: 'done' }, error: null });
    const r = await closeSiteEvent({ eventId: EVENT, projectId: PROJECT, note: '  selesai dikerjakan  ' });
    expect(r.error).toBeUndefined();
    expect(mocked.rpc).toHaveBeenCalledWith('close_site_event', { p_event_id: EVENT, p_closure_note: 'selesai dikerjakan' });
  });
});

describe('getSiteEvent', () => {
  it('warns and returns null on a query error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.from.mockImplementationOnce(() => makeChain({ data: null, error: { message: 'network down' } }));
    const r = await getSiteEvent(EVENT);
    expect(r).toBeNull();
    expect(warn).toHaveBeenCalledWith('getSiteEvent failed:', 'network down');
    warn.mockRestore();
  });

  it('returns null when there is no row', async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: null, error: null }));
    expect(await getSiteEvent(EVENT)).toBeNull();
  });

  it('shapes a typed row, sorting media and flattening the embedded relations', async () => {
    mocked.from.mockImplementationOnce(() =>
      makeChain({
        data: {
          id: EVENT,
          project_id: PROJECT,
          title: 'Retak acian',
          status: 'open',
          site_event_media: [
            { id: 'm2', sort_order: 1 },
            { id: 'm1', sort_order: 0 },
          ],
          rooms: { room_name: 'Kamar 1', floor: 'Lt 2' },
          owner: { full_name: 'Owner Satu' },
          reporter: { full_name: 'Reporter Satu' },
          closer: { full_name: 'Penutup Satu' },
        },
        error: null,
      }),
    );
    const r = await getSiteEvent(EVENT);
    expect(r?.media.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(r?.room_name).toBe('Kamar 1');
    expect(r?.room_floor).toBe('Lt 2');
    expect(r?.owner_name).toBe('Owner Satu');
    expect(r?.reporter_name).toBe('Reporter Satu');
    expect(r?.closed_by_name).toBe('Penutup Satu');
    expect((r as unknown as { site_event_media?: unknown }).site_event_media).toBeUndefined();
  });

  it('leaves closed_by_name null when the event is not closed (closer join returns no row)', async () => {
    mocked.from.mockImplementationOnce(() =>
      makeChain({
        data: {
          id: EVENT,
          project_id: PROJECT,
          title: 'Retak acian',
          status: 'open',
          site_event_media: [],
          rooms: { room_name: 'Kamar 1', floor: 'Lt 2' },
          owner: { full_name: 'Owner Satu' },
          reporter: { full_name: 'Reporter Satu' },
          closer: null,
        },
        error: null,
      }),
    );
    const r = await getSiteEvent(EVENT);
    expect(r?.closed_by_name).toBeNull();
  });
});

describe('listOpenEventsForRoom', () => {
  it('filters by room and open status, ordered by confirmed_at then id (both descending)', async () => {
    const rows = [{ id: 'e1', project_id: PROJECT, title: 'A', event_type: 'isu', due_date: null, is_blocking: false }];
    mocked.from.mockImplementationOnce(() => makeChain({ data: rows, error: null }));
    const r = await listOpenEventsForRoom('room-1', 5);
    expect(r).toEqual(rows);
    expect(calls).toContain('eq:"room_id":"room-1"');
    expect(calls).toContain('eq:"status":"open"');
    expect(calls).toContain('order:"confirmed_at":{"ascending":false}');
    expect(calls).toContain('order:"id":{"ascending":false}');
    expect(calls).toContain('limit:5');
  });

  it('warns and returns [] on a query error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.from.mockImplementationOnce(() => makeChain({ data: null, error: { message: 'boom' } }));
    const r = await listOpenEventsForRoom('room-1');
    expect(r).toEqual([]);
    expect(warn).toHaveBeenCalledWith('listOpenEventsForRoom failed:', 'boom');
    warn.mockRestore();
  });
});

describe('listDraftEvents', () => {
  it('filters by project and reporter, ordered by captured_at then id (both descending)', async () => {
    const rows = [
      {
        id: 'e2', status: 'draft', draft_title: 'Retak', captured_at: '2026-09-10T03:00:00.000Z',
        last_error: null, analysis_attempts: 1, ai_confidence: 'high', rooms: { room_name: 'Kamar 2' },
      },
    ];
    mocked.from.mockImplementationOnce(() => makeChain({ data: rows, error: null }));
    const r = await listDraftEvents(PROJECT, 'user-1');
    expect(r).toEqual([
      {
        id: 'e2', status: 'draft', draft_title: 'Retak', captured_at: '2026-09-10T03:00:00.000Z',
        last_error: null, analysis_attempts: 1, ai_confidence: 'high', room_name: 'Kamar 2',
      },
    ]);
    expect(calls).toContain(`eq:"project_id":"${PROJECT}"`);
    expect(calls).toContain('eq:"reporter_id":"user-1"');
    expect(calls).toContain('order:"captured_at":{"ascending":false}');
    expect(calls).toContain('order:"id":{"ascending":false}');
  });

  it('warns and returns [] on a query error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.from.mockImplementationOnce(() => makeChain({ data: null, error: { message: 'boom' } }));
    const r = await listDraftEvents(PROJECT, 'user-1');
    expect(r).toEqual([]);
    expect(warn).toHaveBeenCalledWith('listDraftEvents failed:', 'boom');
    warn.mockRestore();
  });
});

describe('getRoomLastGate', () => {
  it('filters by room_id and reads last_gate_code from v_room_board', async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: { last_gate_code: 'B' }, error: null }));
    const r = await getRoomLastGate('room-1');
    expect(r).toBe('B');
    expect(calls).toContain('eq:"room_id":"room-1"');
  });

  it('returns null on a query error', async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: null, error: { message: 'boom' } }));
    expect(await getRoomLastGate('room-1')).toBeNull();
  });

  it('returns null when the room has no confirmed gate yet', async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: { last_gate_code: null }, error: null }));
    expect(await getRoomLastGate('room-1')).toBeNull();
  });
});

describe('listConfirmedEventsForDay', () => {
  function chain(result: { data: unknown; error: { message: string } | null }) {
    const c: any = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'lt']) c[m] = jest.fn().mockReturnValue(c);
    c.order = jest.fn().mockResolvedValue(result);
    return c;
  }

  it('windows on the WIB day and takes confirmed statuses only', async () => {
    const c = chain({ data: [{ id: 'e1', event_type: 'progres', title: 'T', summary: 'S', room_id: 'r1', gate_code: 'C', confirmed_at: '2026-09-11T02:00:00Z', site_event_media: [{ id: 'm1', kind: 'photo', role: 'context', storage_path: 'x.jpg', sort_order: 0 }] }], error: null });
    (supabase.from as jest.Mock).mockReturnValue(c);

    const out = await listConfirmedEventsForDay('p1', '2026-09-11');
    expect(c.in).toHaveBeenCalledWith('status', ['open', 'done']);
    expect(c.gte).toHaveBeenCalledWith('confirmed_at', '2026-09-10T17:00:00.000Z');
    expect(c.lt).toHaveBeenCalledWith('confirmed_at', '2026-09-11T17:00:00.000Z');
    expect(out).toHaveLength(1);
    expect(out[0].media).toHaveLength(1);
    expect('site_event_media' in out[0]).toBe(false);
  });

  it('returns an empty list rather than throwing when the read fails', async () => {
    (supabase.from as jest.Mock).mockReturnValue(chain({ data: null, error: { message: 'nope' } }));
    expect(await listConfirmedEventsForDay('p1', '2026-09-11')).toEqual([]);
  });

  it('gives an event with no media an empty array', async () => {
    (supabase.from as jest.Mock).mockReturnValue(chain({ data: [{ id: 'e1', event_type: 'info', title: null, summary: 'S', room_id: 'r1', gate_code: null, confirmed_at: 'x', site_event_media: null }], error: null }));
    expect((await listConfirmedEventsForDay('p1', '2026-09-11'))[0].media).toEqual([]);
  });
});

describe('RPC_ERROR_COPY vs migration 097', () => {
  it('covers exactly the SITE_EVENT_* codes migration 097 actually raises — no more, no less', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', 'supabase', 'migrations', '097_site_events.sql'),
      'utf8',
    );
    // Only text inside `RAISE EXCEPTION '<CODE>:` counts as a code the client
    // must translate — SITE_EVENT_ASSIGNED, mentioned in the header comment
    // and passed to enqueue_notification_user, is a notification type, not an
    // RPC error code, and must NOT be required here.
    const raised = new Set(
      [...sql.matchAll(/RAISE EXCEPTION '(SITE_EVENT_[A-Z_]+):/g)].map((m) => m[1]),
    );
    const covered = new Set(RPC_ERROR_COPY.map(([code]) => code));
    expect(raised.size).toBeGreaterThan(0);
    expect(covered).toEqual(raised);
  });
});
