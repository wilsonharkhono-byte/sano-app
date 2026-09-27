// SANO - datum-sync: in-memory fakes for the Deno tests. Never imported by
// index.ts, so never deployed as code that runs.
//
// FakeStore holds SANO's rows and applies the same rules the database does
// where a run depends on them: one open run per project (the partial unique
// index of migration 107), a 23505 on a duplicate room code, the
// datum_staff_id unique index. fakeDatum() serves DATUM's five routes from
// memory, behind the same bearer, refuses what the real routes refuse (body
// shapes, UUIDs, dates, lengths, codes, types, an area of another project),
// and makes one card per SANO event.

import { makeDatumApi } from './datum.ts';
import { PLAN_AREA_TYPES, normalizeCode, type PlanProfile, type PlanRoom, type RunCounts, type RunDifferences, type SanoGateWord } from './plan.ts';
import type {
  EscalationDue,
  GateStatusCacheRow,
  ImportedRoomRow,
  ProjectRow,
  RunContext,
  RunRequest,
  SyncStore,
} from './run.ts';

export interface FakeRun {
  id: string;
  project_id: string;
  source: string;
  requested_by: string | null;
  request_id: string | null;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  counts: RunCounts;
  differences: RunDifferences;
  error: string | null;
}

export interface FakeEvent {
  id: string;
  project_id: string;
  room_id: string;
  status: string;
  event_type: string;
  title: string;
  summary: string | null;
  due_date: string;
  confirmed_at: string | null;
  reporter_id: string;
  confirmed_by: string | null;
  owner_id: string;
  datum_card_id: string | null;
  datum_card_url: string | null;
  datum_escalated_at: string | null;
}

export class FakeStore implements SyncStore {
  projects: ProjectRow[] = [];
  rooms: Array<PlanRoom & { project_id: string; created_by?: string | null }> = [];
  runs: FakeRun[] = [];
  requests: Array<{ id: string; handled_at: string | null; run_id: string | null; error: string | null }> = [];
  gateRefs: SanoGateWord[] = [];
  cache: GateStatusCacheRow[] = [];
  profiles: PlanProfile[] = [];
  events: FakeEvent[] = [];
  /** Set to make the next call of that method throw. */
  failNext: Partial<Record<keyof SyncStore, string>> = {};
  /** The database's clock (now()): world() points it at the run's clock. */
  now: () => Date = () => new Date();
  /** Runs inside insertImportedRoom before the insert: a test makes a room "meanwhile" here. */
  beforeRoomInsert: ((row: ImportedRoomRow) => void) | null = null;
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private maybeFail(method: keyof SyncStore): void {
    const message = this.failNext[method];
    if (message) {
      delete this.failNext[method];
      throw new Error(message);
    }
  }

  getProject(projectId: string): Promise<ProjectRow | null> {
    this.maybeFail('getProject');
    return Promise.resolve(this.projects.find((p) => p.id === projectId) ?? null);
  }

  closeStaleRuns(projectId: string, olderThanIso: string, nowIso: string): Promise<Array<{ runId: string; requestId: string | null }>> {
    this.maybeFail('closeStaleRuns');
    const swept: Array<{ runId: string; requestId: string | null }> = [];
    for (const r of this.runs) {
      if (r.project_id === projectId && r.finished_at === null && r.started_at < olderThanIso) {
        Object.assign(r, { finished_at: nowIso, ok: false, error: 'Sinkron terputus sebelum selesai.' });
        swept.push({ runId: r.id, requestId: r.request_id });
      }
    }
    return Promise.resolve(swept);
  }

  openRun(req: RunRequest): Promise<{ runId: string } | { running: true }> {
    this.maybeFail('openRun');
    if (this.runs.some((r) => r.project_id === req.projectId && r.finished_at === null)) return Promise.resolve({ running: true });
    const run: FakeRun = {
      id: this.id('run'), project_id: req.projectId, source: req.source, requested_by: req.requestedBy,
      request_id: req.requestId, started_at: this.now().toISOString(), finished_at: null, ok: null,
      counts: { steps: {} }, differences: {}, error: null,
    };
    this.runs.push(run);
    return Promise.resolve({ runId: run.id });
  }

  insertFinishedRun(req: RunRequest, fields: { finishedAt: string; error: string }): Promise<string> {
    const run: FakeRun = {
      id: this.id('run'), project_id: req.projectId, source: req.source, requested_by: req.requestedBy,
      request_id: req.requestId, started_at: fields.finishedAt, finished_at: fields.finishedAt, ok: false,
      counts: { steps: {} }, differences: {}, error: fields.error,
    };
    this.runs.push(run);
    return Promise.resolve(run.id);
  }

  finishRun(
    runId: string,
    fields: { finishedAt: string; ok: boolean; counts: RunCounts; differences: RunDifferences; error: string | null },
  ): Promise<void> {
    const run = this.runs.find((r) => r.id === runId);
    if (run) Object.assign(run, { finished_at: fields.finishedAt, ok: fields.ok, counts: fields.counts, differences: fields.differences, error: fields.error });
    return Promise.resolve();
  }

  markRequest(requestId: string, fields: { handledAt: string; runId: string | null; error: string | null }): Promise<void> {
    this.maybeFail('markRequest');
    const req = this.requests.find((r) => r.id === requestId);
    if (req) Object.assign(req, { handled_at: fields.handledAt, run_id: fields.runId, error: fields.error });
    return Promise.resolve();
  }

  listRooms(projectId: string): Promise<PlanRoom[]> {
    this.maybeFail('listRooms');
    return Promise.resolve(
      this.rooms.filter((r) => r.project_id === projectId).map(({ project_id: _p, created_by: _c, ...room }) => ({ ...room })),
    );
  }

  setRoomLink(roomId: string, areaId: string): Promise<void> {
    this.maybeFail('setRoomLink');
    const room = this.rooms.find((r) => r.id === roomId);
    if (room) room.datum_area_id = areaId;
    return Promise.resolve();
  }

  insertImportedRoom(row: ImportedRoomRow): Promise<string | null> {
    this.maybeFail('insertImportedRoom');
    this.beforeRoomInsert?.(row);
    if (this.rooms.some((r) => r.project_id === row.project_id && r.room_code === row.room_code)) return Promise.resolve(null);
    const id = this.id('room');
    this.rooms.push({
      id, project_id: row.project_id, room_code: row.room_code, room_name: row.room_name, floor: row.floor,
      area_type: row.area_type, sort_order: row.sort_order, active: true, datum_area_id: row.datum_area_id,
      created_by: row.created_by,
    });
    return Promise.resolve(id);
  }

  listGateRefs(): Promise<SanoGateWord[]> {
    this.maybeFail('listGateRefs');
    return Promise.resolve(this.gateRefs.map((g) => ({ ...g })));
  }

  upsertGateStatus(rows: GateStatusCacheRow[]): Promise<void> {
    this.maybeFail('upsertGateStatus');
    for (const row of rows) {
      this.cache = this.cache.filter((c) => !(c.room_id === row.room_id && c.gate_code === row.gate_code));
      this.cache.push({ ...row });
    }
    return Promise.resolve();
  }

  listProfiles(): Promise<PlanProfile[]> {
    this.maybeFail('listProfiles');
    return Promise.resolve(this.profiles.map((p) => ({ ...p })));
  }

  setProfileStaffLink(profileId: string, staffId: string): Promise<void> {
    this.maybeFail('setProfileStaffLink');
    if (this.profiles.some((p) => p.datum_staff_id === staffId)) {
      return Promise.reject(new Error('duplicate key value violates unique constraint "idx_profiles_datum_staff_id"'));
    }
    const profile = this.profiles.find((p) => p.id === profileId);
    if (profile && profile.datum_staff_id === null) profile.datum_staff_id = staffId;
    return Promise.resolve();
  }

  private due(projectId: string): FakeEvent[] {
    return this.events
      .filter((e) => e.project_id === projectId && e.status === 'open' && e.event_type === 'butuh_keputusan' && e.confirmed_at !== null && e.datum_card_id === null)
      .sort((a, b) => ((a.confirmed_at as string) < (b.confirmed_at as string) ? -1 : 1));
  }

  listEscalationDue(projectId: string, rooms: 'linked' | 'unlinked', limit: number): Promise<{ rows: EscalationDue[]; total: number }> {
    this.maybeFail('listEscalationDue');
    const person = (id: string | null) => this.profiles.find((p) => p.id === id) ?? null;
    const roomOf = (e: FakeEvent) => this.rooms.find((r) => r.id === e.room_id)!;
    const due = this.due(projectId).filter((e) => (roomOf(e).datum_area_id !== null) === (rooms === 'linked'));
    const rows = due.slice(0, limit).map((e) => {
      const room = roomOf(e);
      const reporter = person(e.reporter_id);
      const confirmer = person(e.confirmed_by);
      return {
        id: e.id, title: e.title, summary: e.summary, due_date: e.due_date, confirmed_at: e.confirmed_at as string,
        room_code: room.room_code as string, room_name: room.room_name, room_datum_area_id: room.datum_area_id,
        reporter_name: reporter?.full_name ?? null, reporter_staff_id: reporter?.datum_staff_id ?? null,
        confirmer_name: confirmer?.full_name ?? null, confirmer_staff_id: confirmer?.datum_staff_id ?? null,
        owner_name: person(e.owner_id)?.full_name ?? null,
      };
    });
    return Promise.resolve({ rows, total: due.length });
  }

  setEventCard(eventId: string, cardId: string, cardUrl: string, escalatedAtIso: string): Promise<void> {
    this.maybeFail('setEventCard');
    const ev = this.events.find((e) => e.id === eventId);
    if (ev && ev.datum_card_id === null) Object.assign(ev, { datum_card_id: cardId, datum_card_url: cardUrl, datum_escalated_at: escalatedAtIso });
    return Promise.resolve();
  }
}

// ─── A DATUM that answers the five routes from memory ────────────────────────

/** A version-4-shaped UUID a reader can still tell apart: fakeUuid('a', 1) = 'aaaaaaaa-0000-4000-8000-000000000001'. */
export function fakeUuid(hex: string, n: number): string {
  return `${hex.repeat(8).slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export interface FakeDatumState {
  secret: string;
  projects: Array<{ id: string; project_code: string; project_name: string }>;
  areas: Array<{ id: string; project_id: string; area_code: string; area_name: string; floor: string | null; area_type: string; sort_order: number; tracked: boolean }>;
  gates: Array<{ code: string; name: string; description: string | null; sort_order: number }>;
  statuses: Array<{ project_id: string; area_id: string; gate_code: string; status: string; stale: boolean; last_recomputed_at: string | null; updated_at: string | null }>;
  staff: Array<{ id: string; full_name: string; active: boolean }>;
  cards: Array<{ id: string; sano_event_id: string; area_id: string; author: string; slug: string }>;
  /** DATUM's SANO_INTEGRATION_STAFF_ID; empty makes escalate answer 503 NOT_CONFIGURED, as the real route does. */
  systemStaffId: string;
  /** Route path (e.g. 'areas', 'staff') to answer with this status instead. */
  failRoute: Record<string, number>;
  calls: Array<{ method: string; path: string; body: unknown }>;
  /**
   * Awaited before each answer: a test holds DATUM here (a promise it resolves
   * later), moves the clock, or throws to make the call fail as the network does.
   */
  beforeReply?: (path: string, method: string) => Promise<void> | void;
}

// The real routes' rules (DATUM apps/web/lib/integrations/sano/areas.ts PostAreasBody and
// areaItemError, escalate.ts EscalateBody under zod 3, project.ts resolveProject, reply.ts
// statuses), so a body the real DATUM would refuse is refused here too.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isStr = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.length >= min && v.length <= max;
const isUuid = (v: unknown): boolean => typeof v === 'string' && UUID_RE.test(v);
const isUrl = (v: unknown): boolean => {
  if (!isStr(v, 1, 500)) return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
};

/** The first field EscalateBody refuses, or null. */
function escalateFieldError(b: Record<string, unknown>): string | null {
  const checks: Array<[string, boolean]> = [
    ['project_code', isStr(b.project_code, 1, 40)],
    ['area_id', isUuid(b.area_id)],
    ['sano_event_id', isUuid(b.sano_event_id)],
    ['sano_url', isUrl(b.sano_url)],
    ['title', typeof b.title === 'string' && isStr(b.title.trim(), 1, 80)],
    ['summary', b.summary === null || isStr(b.summary, 0, 300)],
    ['room_name', isStr(b.room_name, 1, 200)],
    ['reporter_name', isStr(b.reporter_name, 0, 200)],
    ['confirmer_name', b.confirmer_name === null || isStr(b.confirmer_name, 0, 200)],
    ['owner_name', isStr(b.owner_name, 0, 200)],
    ['due_date', typeof b.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date)],
    ['confirmed_at', typeof b.confirmed_at === 'string' && !Number.isNaN(Date.parse(b.confirmed_at))],
    ['author_staff_id', b.author_staff_id === null || isUuid(b.author_staff_id)],
  ];
  return checks.find(([, ok]) => !ok)?.[0] ?? null;
}

/** PostAreasBody: project_code 1-40 and 1-200 loosely typed items; anything else is a 400 for the batch. */
function postAreasBodyOk(b: Record<string, unknown>): boolean {
  if (!isStr(b.project_code, 1, 40) || !Array.isArray(b.areas) || b.areas.length < 1 || b.areas.length > 200) return false;
  return b.areas.every((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const i = raw as Record<string, unknown>;
    return isStr(i.area_code, 0, 1000) && isStr(i.area_name, 0, 1000) && isStr(i.area_type, 0, 1000) &&
      (i.floor === undefined || i.floor === null || isStr(i.floor, 0, 1000)) &&
      (i.tracked === undefined || typeof i.tracked === 'boolean');
  });
}

/** areaItemError: a bad item is an item error, never a 400. */
function areaItemError(i: { area_code: string; area_name: string; floor?: string | null; area_type: string }): string | null {
  if (!i.area_code || i.area_code !== normalizeCode(i.area_code)) return 'CODE_NOT_NORMALIZED';
  const name = i.area_name.trim();
  if (name.length < 1 || name.length > 120) return 'INVALID';
  if ((i.floor ?? '').length > 40) return 'INVALID';
  if (!PLAN_AREA_TYPES.includes(i.area_type)) return 'INVALID';
  return null;
}

export function fakeDatum(seed: Partial<FakeDatumState> = {}): { state: FakeDatumState; fetch: typeof fetch } {
  const state: FakeDatumState = {
    secret: 'datum-secret', projects: [], areas: [], gates: [], statuses: [], staff: [], cards: [],
    systemStaffId: STAFF_SYSTEM, failRoute: {}, calls: [], ...seed,
  };
  let areaSeq = 0;
  let cardSeq = 0;
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const refuse = (status: number, code: string, error: string) => reply(status, { ok: false, code, error });

  const route = (input: string | URL | Request, init?: RequestInit): Response => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/api\/integrations\/sano\//, '');
    const method = init?.method ?? 'GET';
    let body: Record<string, unknown> | undefined;
    let bodyIsJson = true;
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        bodyIsJson = false;
      }
    }
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth !== `Bearer ${state.secret}`) return refuse(401, 'UNAUTHORIZED', 'Kunci integrasi SANO tidak cocok.');
    if (state.failRoute[path]) return refuse(state.failRoute[path], 'DB_ERROR', 'fake failure');

    const resolve = (raw: unknown): { project: FakeDatumState['projects'][number] } | { response: Response } => {
      const code = (typeof raw === 'string' ? raw : '').trim().toUpperCase();
      if (!code) return { response: refuse(400, 'BAD_REQUEST', 'project_code wajib diisi.') };
      const project = state.projects.find((p) => p.project_code === code);
      if (!project) return { response: refuse(404, 'UNKNOWN_PROJECT', `Proyek DATUM dengan kode ${code} tidak ada.`) };
      return { project };
    };

    if (path === 'staff' && method === 'GET') {
      return reply(200, { ok: true, staff: state.staff.filter((s) => s.active).map(({ id, full_name }) => ({ id, full_name })) });
    }
    if ((path === 'areas' || path === 'gate-status') && method === 'GET') {
      const found = resolve(url.searchParams.get('project_code'));
      if ('response' in found) return found.response;
      const { project } = found;
      if (path === 'gate-status') {
        const statuses = state.statuses.filter((s) => s.project_id === project.id).map(({ project_id: _p, ...s }) => s);
        return reply(200, { ok: true, gates: state.gates, statuses, read_at: new Date().toISOString() });
      }
      const areas = state.areas.filter((a) => a.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order)
        .map(({ id, area_code, area_name, floor, area_type, sort_order }) => ({ id, area_code, area_name, floor, area_type, sort_order }));
      return reply(200, { ok: true, project, areas });
    }
    if (path === 'areas' && method === 'POST') {
      if (!bodyIsJson || !body) return refuse(400, 'BAD_REQUEST', 'Body harus JSON.');
      if (!postAreasBodyOk(body)) return refuse(400, 'BAD_REQUEST', 'Body tidak sesuai: project_code dan 1-200 areas wajib.');
      const found = resolve(body.project_code);
      if ('response' in found) return found.response;
      const { project } = found;
      const out: Array<{ area_code: string; id: string; created: boolean }> = [];
      const errors: Array<{ area_code: string; code: string }> = [];
      for (const item of body.areas as Array<{ area_code: string; area_name: string; floor?: string | null; area_type: string; tracked?: boolean }>) {
        const bad = areaItemError(item);
        if (bad) {
          errors.push({ area_code: item.area_code, code: bad });
          continue;
        }
        const known = state.areas.find((a) => a.project_id === project.id && a.area_code === item.area_code);
        if (known) {
          out.push({ area_code: item.area_code, id: known.id, created: false });
          continue;
        }
        areaSeq += 1;
        const id = fakeUuid('b', areaSeq);
        const sort = Math.max(-1, ...state.areas.filter((a) => a.project_id === project.id).map((a) => a.sort_order)) + 1;
        state.areas.push({
          id, project_id: project.id, area_code: item.area_code, area_name: item.area_name.trim(), floor: item.floor ?? null,
          area_type: item.area_type, sort_order: sort, tracked: item.tracked ?? true,
        });
        out.push({ area_code: item.area_code, id, created: true });
      }
      return reply(200, { ok: true, areas: out, errors });
    }
    if (path === 'escalate' && method === 'POST') {
      if (!state.systemStaffId) {
        return refuse(503, 'NOT_CONFIGURED', 'SANO_INTEGRATION_STAFF_ID belum diisi: kartu dari SANO butuh penulis sistem.');
      }
      if (!bodyIsJson || !body) return refuse(400, 'BAD_REQUEST', 'Body harus JSON.');
      const field = escalateFieldError(body);
      if (field) return refuse(400, 'BAD_REQUEST', `Isian tidak valid: ${field}.`);
      const found = resolve(body.project_code);
      if ('response' in found) return found.response;
      const { project } = found;
      if (!state.areas.some((a) => a.id === body.area_id && a.project_id === project.id)) {
        return refuse(404, 'UNKNOWN_AREA', 'Area ini bukan milik proyek DATUM tersebut.');
      }
      const author = (id: string) => (id === state.systemStaffId ? 'system' : 'linked');
      const cardReply = (card: FakeDatumState['cards'][number], created: boolean) =>
        reply(200, { ok: true, card_id: card.id, card_url: `https://datum.test/project/x/cards/${card.slug}`, created, author: author(card.author) });
      const found2 = state.cards.find((c) => c.sano_event_id === body.sano_event_id);
      if (found2) return cardReply(found2, false);
      cardSeq += 1;
      const staffOk = state.staff.some((s) => s.id === body.author_staff_id && s.active);
      const card = {
        id: fakeUuid('c', cardSeq), sano_event_id: String(body.sano_event_id), area_id: String(body.area_id),
        author: staffOk ? String(body.author_staff_id) : state.systemStaffId, slug: `kartu-${cardSeq}`,
      };
      state.cards.push(card);
      return cardReply(card, true);
    }
    return refuse(404, 'NOT_FOUND', 'no route');
  };
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/api\/integrations\/sano\//, '');
    const method = init?.method ?? 'GET';
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      body = String(init?.body);
    }
    // Recorded before the hook, so a call the network then loses still counts as made.
    state.calls.push({ method, path, body });
    await state.beforeReply?.(path, method);
    return route(input, init);
  };
  return { state, fetch: fetchImpl as typeof fetch };
}

// ─── One project, as the run and handler tests share it ──────────────────────

export const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
export const NOW = '2026-09-27T03:00:00.000Z';
/** DATUM-side ids: DATUM's routes take only UUIDs, so the fixtures are UUIDs too. */
export const DATUM_PROJECT_ID = fakeUuid('d', 1);
export const AREA_KM1 = fakeUuid('a', 1);
export const STAFF_BUDI = fakeUuid('5', 1);
export const STAFF_SITI = fakeUuid('5', 2);
export const STAFF_SYSTEM = fakeUuid('5', 99);
/** The id fakeDatum gives the n-th area it creates. */
export const newAreaId = (n: number): string => fakeUuid('b', n);

export const DATUM_GATES = [
  { code: 'A', name: 'MEP Rough-in + Persiapan Struktural', description: 'Penarikan seluruh sistem MEP dan persiapan struktural untuk menerima finishing.', sort_order: 1 },
  { code: 'B', name: 'Pekerjaan Basah / Waterproofing', description: 'Material dinding/lantai (marmer/batu alam) dan sanitair. Sebelum plafon kamar mandi ditutup.', sort_order: 2 },
];

/**
 * SANO project SANO-K27 paired to DATUM K2-7. SANO has LT1-KM-1 (DATUM has it
 * too), LT1-DAPUR and UMUM (DATUM has neither). Three profiles: Budi and Siti
 * match DATUM staff exactly (Budi in another case), "Tak Dikenal" matches no one.
 */
export function world() {
  const store = new FakeStore();
  store.projects.push({ id: PROJECT_ID, code: 'SANO-K27', datum_project_code: 'K2-7' });
  store.gateRefs = DATUM_GATES.map((g) => ({ code: g.code, name_id: g.name, description: g.description }));
  store.rooms = [
    { id: 'room-km1', project_id: PROJECT_ID, room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom', sort_order: 0, active: true, datum_area_id: null },
    { id: 'room-dapur', project_id: PROJECT_ID, room_code: 'LT1-DAPUR', room_name: 'Dapur', floor: 'Lt. 1', area_type: 'kitchen', sort_order: 1, active: true, datum_area_id: null },
    { id: 'room-umum', project_id: PROJECT_ID, room_code: 'UMUM', room_name: 'Area Umum', floor: null, area_type: 'general', sort_order: 9999, active: true, datum_area_id: null },
  ];
  store.profiles = [
    { id: 'u-budi', full_name: 'Budi Santoso', datum_staff_id: null },
    { id: 'u-siti', full_name: 'Siti Aminah', datum_staff_id: null },
    { id: 'u-x', full_name: 'Tak Dikenal', datum_staff_id: null },
  ];
  const datum = fakeDatum({
    projects: [{ id: DATUM_PROJECT_ID, project_code: 'K2-7', project_name: 'Citraland K2-7 Sonny' }],
    areas: [{ id: AREA_KM1, project_id: DATUM_PROJECT_ID, area_code: 'LT1-KM-1', area_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom', sort_order: 0, tracked: true }],
    gates: DATUM_GATES,
    statuses: [
      { project_id: DATUM_PROJECT_ID, area_id: AREA_KM1, gate_code: 'A', status: 'passed', stale: false, last_recomputed_at: '2026-09-26T03:00:00.000Z', updated_at: '2026-09-26T03:00:00.000Z' },
      { project_id: DATUM_PROJECT_ID, area_id: AREA_KM1, gate_code: 'B', status: 'blocked', stale: true, last_recomputed_at: null, updated_at: '2026-09-26T04:00:00.000Z' },
    ],
    staff: [
      { id: STAFF_BUDI, full_name: 'budi  santoso', active: true },
      { id: STAFF_SITI, full_name: 'Siti Aminah', active: true },
    ],
  });
  const clock = { now: new Date(NOW) };
  store.now = () => clock.now;
  const ctx: RunContext = {
    store,
    datum: makeDatumApi({ baseUrl: 'https://datum.test/', secret: 'datum-secret', fetch: datum.fetch }),
    now: () => clock.now,
  };
  return { store, datum, ctx, clock };
}

let eventSeq = 0;
/** An open, confirmed butuh_keputusan in LT1-KM-1, reported by Budi, confirmed by Siti, owned by Budi. */
export function decision(store: FakeStore, over: Partial<FakeEvent> = {}): FakeEvent {
  eventSeq += 1;
  const ev: FakeEvent = {
    id: fakeUuid('e', eventSeq), project_id: PROJECT_ID, room_id: 'room-km1', status: 'open',
    event_type: 'butuh_keputusan', title: `Keputusan ${eventSeq}`, summary: null, due_date: '2026-10-01',
    confirmed_at: new Date(Date.parse('2026-09-20T00:00:00.000Z') + eventSeq * 60_000).toISOString(), reporter_id: 'u-budi',
    confirmed_by: 'u-siti', owner_id: 'u-budi', datum_card_id: null, datum_card_url: null, datum_escalated_at: null, ...over,
  };
  store.events.push(ev);
  return ev;
}
