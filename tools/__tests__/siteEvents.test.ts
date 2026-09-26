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
  confirmSiteEvent,
  createSiteEventWithMedia,
  discardSiteEvent,
  getRoomLastGate,
  getSiteEvent,
  getSiteEventResult,
  insertSiteEvent,
  invokeSiteEventAnalysis,
  isDuplicateUploadError,
  listConfirmedEventsForDay,
  listDraftEvents,
  listOpenEventsForRoom,
  listRoomTimeline,
  mapSiteEventRpcError,
  newSiteEventId,
  RPC_ERROR_COPY,
  saveTranscriptEdit,
  signedMediaUrl,
  siteEventMediaPath,
  updateSiteEventAssignment,
  uploadSiteEventMedia,
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
    // Migration 105: the two evidence codes, beside 097's SITE_EVENT_CLOSURE_NOTE they must not collide with.
    expect(mapSiteEventRpcError('SITE_EVENT_CLOSURE_NOTE: catatan penutupan maksimal 500 karakter')).toBe('Catatan penutupan maksimal 500 karakter.');
    expect(mapSiteEventRpcError('SITE_EVENT_CLOSURE_NOTE_REQUIRED: kejadian butuh keputusan wajib punya catatan keputusan minimal 10 karakter.'))
      .toBe('Catatan keputusan wajib diisi, minimal 10 karakter.');
    expect(mapSiteEventRpcError('SITE_EVENT_CLOSURE_PHOTO_REQUIRED: kejadian cacat hanya bisa ditandai selesai dengan foto penutupan. Perbarui aplikasi, lalu ambil foto hasil perbaikan.'))
      .toBe('Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.');
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

describe('getSiteEventResult', () => {
  // getSiteEvent collapsed a query error and "no such row" into the same
  // null, so a caller could not tell a dropped connection from a real 404.
  // getSiteEventResult keeps them apart; getSiteEvent (tested above) stays a
  // thin wrapper that discards the distinction for callers outside this pass.
  it('reports a query error distinctly, and warns', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.from.mockImplementationOnce(() => makeChain({ data: null, error: { message: 'network down' } }));
    await expect(getSiteEventResult(EVENT)).resolves.toEqual({ event: null, error: 'network down' });
    expect(warn).toHaveBeenCalledWith('getSiteEvent failed:', 'network down');
    warn.mockRestore();
  });

  it('reports notFound: true, distinct from an error, when there is no row', async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: null, error: null }));
    await expect(getSiteEventResult(EVENT)).resolves.toEqual({ event: null, notFound: true });
  });

  it('shapes the row into `event` on success, matching getSiteEvent', async () => {
    mocked.from.mockImplementationOnce(() =>
      makeChain({
        data: {
          id: EVENT,
          project_id: PROJECT,
          title: 'Retak acian',
          status: 'open',
          site_event_media: [{ id: 'm1', sort_order: 0 }],
          rooms: { room_name: 'Kamar 1', floor: 'Lt 2' },
          owner: { full_name: 'Owner Satu' },
          reporter: { full_name: 'Reporter Satu' },
          closer: null,
        },
        error: null,
      }),
    );
    const r = await getSiteEventResult(EVENT);
    expect(r.event?.room_name).toBe('Kamar 1');
    expect(r.event?.media).toHaveLength(1);
    expect('error' in r).toBe(false);
    expect('notFound' in r).toBe(false);
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
    expect(out.events).toHaveLength(1);
    expect(out.events![0].media).toHaveLength(1);
    expect('site_event_media' in out.events![0]).toBe(false);
  });

  it('reports a read failure distinctly rather than an empty list', async () => {
    (supabase.from as jest.Mock).mockReturnValue(chain({ data: null, error: { message: 'nope' } }));
    expect(await listConfirmedEventsForDay('p1', '2026-09-11')).toEqual({ events: null, error: 'nope' });
  });

  it('gives an event with no media an empty array', async () => {
    (supabase.from as jest.Mock).mockReturnValue(chain({ data: [{ id: 'e1', event_type: 'info', title: null, summary: 'S', room_id: 'r1', gate_code: null, confirmed_at: 'x', site_event_media: null }], error: null }));
    const out = await listConfirmedEventsForDay('p1', '2026-09-11');
    expect(out.events![0].media).toEqual([]);
  });
});

describe('listRoomTimeline', () => {
  function chain(result: { data: unknown; error: { message: string } | null }) {
    const c: any = {};
    for (const m of ['select', 'eq', 'neq', 'order']) c[m] = jest.fn().mockReturnValue(c);
    c.limit = jest.fn().mockResolvedValue(result);
    return c;
  }

  it('flattens the joins, sorts media, scopes to the project and never shows a discarded event', async () => {
    const c = chain({ data: [{
      id: 'e1', room_id: 'r1', status: 'open', created_at: 'x',
      site_event_media: [{ id: 'm2', sort_order: 1 }, { id: 'm1', sort_order: 0 }],
      owner: { full_name: 'Andi Saputra' }, reporter: { full_name: 'Budi' },
    }], error: null });
    (supabase.from as jest.Mock).mockReturnValue(c);

    const out = await listRoomTimeline('r1', 'p1');
    expect(c.eq).toHaveBeenCalledWith('room_id', 'r1');
    expect(c.eq).toHaveBeenCalledWith('project_id', 'p1');
    expect(c.neq).toHaveBeenCalledWith('status', 'discarded');
    expect(out.events![0].media.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(out.events![0].owner_name).toBe('Andi Saputra');
    expect(out.events![0].reporter_name).toBe('Budi');
    expect('site_event_media' in out.events![0]).toBe(false);
  });

  it('reports a read failure instead of an empty room', async () => {
    (supabase.from as jest.Mock).mockReturnValue(chain({ data: null, error: { message: 'nope' } }));
    expect(await listRoomTimeline('r1', 'p1')).toEqual({ events: null, error: 'nope' });
  });
});

describe('updateSiteEventAssignment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls the 099 RPC with its three parameters', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: { event_id: 'e1', status: 'open', owner_id: 'u2', due_date: '2026-09-20', changed: true, notified: true }, error: null });
    const out = await updateSiteEventAssignment('e1', 'u2', '2026-09-20');
    expect(supabase.rpc).toHaveBeenCalledWith('update_site_event_assignment', {
      p_event_id: 'e1', p_owner_id: 'u2', p_due_date: '2026-09-20',
    });
    expect(out.result?.status).toBe('open');
    expect(out.result?.notified).toBe(true);
  });

  it('refuses to call an empty answer a save', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
    expect((await updateSiteEventAssignment('e1', 'u2', '2026-09-20')).error)
      .toBe('Perubahan tidak terkonfirmasi oleh server. Muat ulang lalu periksa.');
  });

  it('refuses a malformed row that is not a real jsonb object', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 'ok', error: null });
    expect((await updateSiteEventAssignment('e1', 'u2', '2026-09-20')).error)
      .toBe('Perubahan tidak terkonfirmasi oleh server. Muat ulang lalu periksa.');
  });

  it('turns each named refusal into an Indonesian sentence', async () => {
    const cases: Array<[string, string]> = [
      ['SITE_EVENT_ASSIGN_ROLE: hanya pelapor', 'Hanya pelapor atau peran kantor yang dapat mengubah pemilik dan tenggat.'],
      ['SITE_EVENT_OWNER_NOT_MEMBER: pemilik harus anggota', 'Pemilik harus anggota tim proyek.'],
      ['SITE_EVENT_OWNER_REQUIRED: wajib', 'Pemilik dan tenggat wajib diisi untuk jenis ini.'],
      ['SITE_EVENT_DUE: tenggat', 'Tenggat tidak boleh sebelum hari ini.'],
      ['SITE_EVENT_ASSIGN_NOT_OPEN: status', 'Hanya kejadian terbuka yang bisa diubah pemilik atau tenggatnya.'],
    ];
    for (const [raw, friendly] of cases) {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: raw } });
      expect((await updateSiteEventAssignment('e1', 'u2', null)).error).toBe(friendly);
    }
  });

  it('clears the owner by passing nulls through', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: { event_id: 'e1', owner_id: null, due_date: null, changed: true, notified: false }, error: null });
    const out = await updateSiteEventAssignment('e1', null, null);
    expect(supabase.rpc).toHaveBeenCalledWith('update_site_event_assignment', {
      p_event_id: 'e1', p_owner_id: null, p_due_date: null,
    });
    expect(out.result?.notified).toBe(false);
  });
});

describe('RPC_ERROR_COPY vs migrations 097, 099, 100 and 105', () => {
  it('covers exactly the SITE_EVENT_* codes 097, 099, 100 and 105 actually raise — no more, no less', () => {
    // Only text inside `RAISE EXCEPTION '<CODE>:` counts as a code the client
    // must translate — SITE_EVENT_ASSIGNED, mentioned in 099's header comment
    // and passed to enqueue_notification_user, is a notification type, not an
    // RPC error code, and must NOT be required here.
    const codesIn = (file: string) => {
      const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', file), 'utf8');
      return [...sql.matchAll(/RAISE EXCEPTION '(SITE_EVENT_[A-Z_]+):/g)].map((m) => m[1]);
    };
    // 100 re-creates confirm_site_event with one extra refusal, and that
    // refusal deliberately re-uses 097's SITE_EVENT_VO_NO_EVIDENCE (the client
    // matches on the `CODE:` prefix, so only the sentence after it grew). It is
    // read anyway: the day 100 is edited to raise a NEW code, this fails until
    // the copy exists.
    // 105 re-creates close_site_event with two evidence refusals. 106 is
    // deliberately not read: its only function has no grant to any app role,
    // so no client ever sees a refusal from it.
    const raised = new Set([
      ...codesIn('097_site_events.sql'),
      ...codesIn('099_site_event_assignment.sql'),
      ...codesIn('100_confirm_vo_evidence_recheck.sql'),
      ...codesIn('105_close_site_event_evidence.sql'),
    ]);
    const covered = new Set(RPC_ERROR_COPY.map(([code]) => code));
    expect(raised.size).toBeGreaterThan(0);
    expect(covered).toEqual(raised);
  });

  it("feeds 100's exact stale-evidence refusal through the mapper and gets the VO copy, not the raw SQL", () => {
    // The test above only compares CODE *sets*, so it cannot see whether the
    // FULL string confirm_site_event (100) actually raises — the existing
    // SITE_EVENT_VO_NO_EVIDENCE code plus the new "(kutipan tidak lagi ada di
    // transkrip)" extension — still matches on the `CODE:` prefix and maps to
    // the same Indonesian copy 097's refusal always has. Read the literal
    // RAISE EXCEPTION text out of the migration itself, not a re-typed copy of
    // it, so a drift in either file fails here.
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', 'supabase', 'migrations', '100_confirm_vo_evidence_recheck.sql'),
      'utf8',
    );
    const match = sql.match(
      /RAISE EXCEPTION '(SITE_EVENT_VO_NO_EVIDENCE:[^']*kutipan tidak lagi ada di transkrip\))'/,
    );
    expect(match).not.toBeNull();
    const message = match![1];
    expect(mapSiteEventRpcError(message)).toBe('VO hanya bisa dikonfirmasi bila ada kutipan dasar.');
  });
});

/**
 * The offline queue (plan 3) spends one of five attempts per failure and
 * waits out a growing backoff between them, so it needs to know whether a
 * refusal is a hiccup or a decision. `kind` rides alongside the existing
 * `error` string; every caller that reads only `error` is unaffected.
 *
 * The asymmetry is deliberate and load-bearing: an unclassified refusal is
 * 'transient', because a wrongly-permanent verdict tells a supervisor to
 * re-file a report that would have gone through on its own.
 */
describe('error kind (transient vs permanent)', () => {
  const oneFile = { id: EVENT, projectId: PROJECT, media: [media()] };

  it.each([
    ['storage 403 / RLS refusal', { status: 403, message: 'new row violates row-level security policy' }],
    ['bucket missing (404)', { status: 404, message: 'Bucket not found' }],
    ['oversize body (413)', { status: 413, message: 'The object exceeded the maximum allowed size' }],
    ['statusCode as a string, as storage-js sometimes reports it', { statusCode: '403', message: 'Unauthorized' }],
  ])('calls an upload %s permanent', async (_label, err) => {
    uploadError = err;
    const r = await uploadSiteEventMedia(oneFile);
    expect(r.error).toBeTruthy();
    expect(r.kind).toBe('permanent');
  });

  it.each([
    ['a dropped network', new Error('Network request failed')],
    ['a 5xx', { status: 503, message: 'Service Unavailable' }],
    ['rate limiting', { status: 429, message: 'Too Many Requests' }],
    ['an expired JWT, which supabase-js refreshes before the next attempt', { status: 401, message: 'jwt expired' }],
  ])('calls an upload %s transient', async (_label, err) => {
    uploadError = err;
    const r = await uploadSiteEventMedia(oneFile);
    expect(r.error).toBeTruthy();
    expect(r.kind).toBe('transient');
  });

  it('reports no kind at all when the upload succeeded', async () => {
    const r = await uploadSiteEventMedia(oneFile);
    expect(r.error).toBeUndefined();
    expect(r.kind).toBeUndefined();
  });

  const insertFailingWith = (table: string, error: unknown) => {
    mocked.from.mockImplementation((t: string) => ({
      upsert: jest.fn(async () => ({ error: t === table ? error : null })),
    }));
  };

  it("calls Postgres 42501 on the event row permanent — that is RLS refusing this supervisor's project", async () => {
    insertFailingWith('site_events', { code: '42501', message: 'new row violates row-level security policy for table "site_events"' });
    const r = await insertSiteEvent(capture(), {});
    expect(r.error).toMatch(/Gagal menyimpan/);
    expect(r.kind).toBe('permanent');
  });

  it('calls the site_event_media SITE_EVENT_MEDIA_PATH trigger refusal permanent', async () => {
    insertFailingWith('site_event_media', { code: 'P0001', message: 'SITE_EVENT_MEDIA_PATH: storage_path does not belong to this event' });
    const r = await insertSiteEvent(capture(), {});
    expect(r.error).toBe('Lokasi berkas media tidak sesuai kejadian.');
    expect(r.kind).toBe('permanent');
  });

  it('calls an unrecognized insert failure transient, so the queue keeps trying', async () => {
    insertFailingWith('site_events', { message: 'fetch failed' });
    const r = await insertSiteEvent(capture(), {});
    expect(r.kind).toBe('transient');
  });

  it('reports no kind at all when the insert succeeded', async () => {
    const r = await insertSiteEvent(capture(), {});
    expect(r).toEqual({});
  });
});
