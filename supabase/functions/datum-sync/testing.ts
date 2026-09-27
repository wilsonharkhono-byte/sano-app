// SANO - datum-sync: in-memory fakes for the Deno tests. Never imported by
// index.ts, so never deployed as code that runs.
//
// FakeStore holds SANO's rows and applies the same rules the database does
// where a run depends on them: one open run per project (the partial unique
// index of migration 107), a 23505 on a duplicate room code, the
// datum_staff_id unique index. fakeDatum() serves DATUM's five routes from
// memory, behind the same bearer, and makes one card per SANO event.

import { makeDatumApi } from './datum.ts';
import type { PlanProfile, PlanRoom, RunCounts, RunDifferences, SanoGateWord } from './plan.ts';
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

  closeStaleRuns(projectId: string, olderThanIso: string, nowIso: string): Promise<void> {
    this.maybeFail('closeStaleRuns');
    for (const r of this.runs) {
      if (r.project_id === projectId && r.finished_at === null && r.started_at < olderThanIso) {
        Object.assign(r, { finished_at: nowIso, ok: false, error: 'Sinkron terputus sebelum selesai.' });
      }
    }
    return Promise.resolve();
  }

  openRun(req: RunRequest): Promise<{ runId: string } | { running: true }> {
    this.maybeFail('openRun');
    if (this.runs.some((r) => r.project_id === req.projectId && r.finished_at === null)) return Promise.resolve({ running: true });
    const run: FakeRun = {
      id: this.id('run'), project_id: req.projectId, source: req.source, requested_by: req.requestedBy,
      request_id: req.requestId, started_at: new Date().toISOString(), finished_at: null, ok: null,
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

  listEscalationDue(projectId: string, limit: number): Promise<EscalationDue[]> {
    this.maybeFail('listEscalationDue');
    const person = (id: string | null) => this.profiles.find((p) => p.id === id) ?? null;
    return Promise.resolve(
      this.due(projectId).slice(0, limit).map((e) => {
        const room = this.rooms.find((r) => r.id === e.room_id)!;
        const reporter = person(e.reporter_id);
        const confirmer = person(e.confirmed_by);
        return {
          id: e.id, title: e.title, summary: e.summary, due_date: e.due_date, confirmed_at: e.confirmed_at as string,
          room_code: room.room_code as string, room_name: room.room_name, room_datum_area_id: room.datum_area_id,
          reporter_name: reporter?.full_name ?? null, reporter_staff_id: reporter?.datum_staff_id ?? null,
          confirmer_name: confirmer?.full_name ?? null, confirmer_staff_id: confirmer?.datum_staff_id ?? null,
          owner_name: person(e.owner_id)?.full_name ?? null,
        };
      }),
    );
  }

  countEscalationDue(projectId: string): Promise<number> {
    return Promise.resolve(this.due(projectId).length);
  }

  setEventCard(eventId: string, cardId: string, cardUrl: string, escalatedAtIso: string): Promise<void> {
    this.maybeFail('setEventCard');
    const ev = this.events.find((e) => e.id === eventId);
    if (ev && ev.datum_card_id === null) Object.assign(ev, { datum_card_id: cardId, datum_card_url: cardUrl, datum_escalated_at: escalatedAtIso });
    return Promise.resolve();
  }
}

// ─── A DATUM that answers the five routes from memory ────────────────────────

export interface FakeDatumState {
  secret: string;
  projects: Array<{ id: string; project_code: string; project_name: string }>;
  areas: Array<{ id: string; project_id: string; area_code: string; area_name: string; floor: string | null; area_type: string; sort_order: number; tracked: boolean }>;
  gates: Array<{ code: string; name: string; description: string | null; sort_order: number }>;
  statuses: Array<{ project_id: string; area_id: string; gate_code: string; status: string; stale: boolean; last_recomputed_at: string | null; updated_at: string | null }>;
  staff: Array<{ id: string; full_name: string; active: boolean }>;
  cards: Array<{ id: string; sano_event_id: string; area_id: string; author: string; slug: string }>;
  systemStaffId: string;
  /** Route path (e.g. 'areas', 'staff') to answer with this status instead. */
  failRoute: Record<string, number>;
  calls: Array<{ method: string; path: string; body: unknown }>;
}

export function fakeDatum(seed: Partial<FakeDatumState> = {}): { state: FakeDatumState; fetch: typeof fetch } {
  const state: FakeDatumState = {
    secret: 'datum-secret', projects: [], areas: [], gates: [], statuses: [], staff: [], cards: [],
    systemStaffId: 'staff-system', failRoute: {}, calls: [], ...seed,
  };
  let seq = 0;
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const route = (input: string | URL | Request, init?: RequestInit): Response => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/api\/integrations\/sano\//, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ method, path, body });
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth !== `Bearer ${state.secret}`) return reply(401, { ok: false, code: 'UNAUTHORIZED', error: 'Kunci integrasi SANO tidak cocok.' });
    if (state.failRoute[path]) return reply(state.failRoute[path], { ok: false, code: 'DB_ERROR', error: 'fake failure' });

    const projectCode = (method === 'GET' ? url.searchParams.get('project_code') : body?.project_code) ?? '';
    const project = state.projects.find((p) => p.project_code === String(projectCode).trim().toUpperCase());
    const unknown = () => reply(404, { ok: false, code: 'UNKNOWN_PROJECT', error: `Proyek DATUM dengan kode ${projectCode} tidak ada.` });

    if (path === 'staff' && method === 'GET') {
      return reply(200, { ok: true, staff: state.staff.filter((s) => s.active).map(({ id, full_name }) => ({ id, full_name })) });
    }
    if (path === 'areas' && method === 'GET') {
      if (!project) return unknown();
      const areas = state.areas.filter((a) => a.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order)
        .map(({ id, area_code, area_name, floor, area_type, sort_order }) => ({ id, area_code, area_name, floor, area_type, sort_order }));
      return reply(200, { ok: true, project, areas });
    }
    if (path === 'gate-status' && method === 'GET') {
      if (!project) return unknown();
      const statuses = state.statuses.filter((s) => s.project_id === project.id).map(({ project_id: _p, ...s }) => s);
      return reply(200, { ok: true, gates: state.gates, statuses, read_at: new Date().toISOString() });
    }
    if (path === 'areas' && method === 'POST') {
      if (!project) return unknown();
      const out: Array<{ area_code: string; id: string; created: boolean }> = [];
      for (const item of body.areas as Array<{ area_code: string; area_name: string; floor: string | null; area_type: string; tracked: boolean }>) {
        const known = state.areas.find((a) => a.project_id === project.id && a.area_code === item.area_code);
        if (known) {
          out.push({ area_code: item.area_code, id: known.id, created: false });
          continue;
        }
        seq += 1;
        const id = `area-new-${seq}`;
        const sort = Math.max(-1, ...state.areas.filter((a) => a.project_id === project.id).map((a) => a.sort_order)) + 1;
        state.areas.push({ id, project_id: project.id, ...item, sort_order: sort });
        out.push({ area_code: item.area_code, id, created: true });
      }
      return reply(200, { ok: true, areas: out, errors: [] });
    }
    if (path === 'escalate' && method === 'POST') {
      if (!project) return unknown();
      const found = state.cards.find((c) => c.sano_event_id === body.sano_event_id);
      const author = (id: string) => (id === state.systemStaffId ? 'system' : 'linked');
      if (found) {
        return reply(200, { ok: true, card_id: found.id, card_url: `https://datum.test/project/x/cards/${found.slug}`, created: false, author: author(found.author) });
      }
      seq += 1;
      const staffOk = state.staff.some((s) => s.id === body.author_staff_id && s.active);
      const card = { id: `card-${seq}`, sano_event_id: body.sano_event_id, area_id: body.area_id, author: staffOk ? body.author_staff_id : state.systemStaffId, slug: `kartu-${seq}` };
      state.cards.push(card);
      return reply(200, { ok: true, card_id: card.id, card_url: `https://datum.test/project/x/cards/${card.slug}`, created: true, author: author(card.author) });
    }
    return reply(404, { ok: false, code: 'NOT_FOUND', error: 'no route' });
  };
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => Promise.resolve(route(input, init));
  return { state, fetch: fetchImpl as typeof fetch };
}

// ─── One project, as the run and handler tests share it ──────────────────────


export const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
export const NOW = '2026-09-27T03:00:00.000Z';

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
    projects: [{ id: 'dp-1', project_code: 'K2-7', project_name: 'Citraland K2-7 Sonny' }],
    areas: [{ id: 'area-km1', project_id: 'dp-1', area_code: 'LT1-KM-1', area_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom', sort_order: 0, tracked: true }],
    gates: DATUM_GATES,
    statuses: [
      { project_id: 'dp-1', area_id: 'area-km1', gate_code: 'A', status: 'passed', stale: false, last_recomputed_at: '2026-09-26T03:00:00.000Z', updated_at: '2026-09-26T03:00:00.000Z' },
      { project_id: 'dp-1', area_id: 'area-km1', gate_code: 'B', status: 'blocked', stale: true, last_recomputed_at: null, updated_at: '2026-09-26T04:00:00.000Z' },
    ],
    staff: [
      { id: 'staff-budi', full_name: 'budi  santoso', active: true },
      { id: 'staff-siti', full_name: 'Siti Aminah', active: true },
    ],
  });
  const clock = { now: new Date(NOW) };
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
    id: `ev-${String(eventSeq).padStart(3, '0')}`, project_id: PROJECT_ID, room_id: 'room-km1', status: 'open',
    event_type: 'butuh_keputusan', title: `Keputusan ${eventSeq}`, summary: null, due_date: '2026-10-01',
    confirmed_at: new Date(Date.parse('2026-09-20T00:00:00.000Z') + eventSeq * 60_000).toISOString(), reporter_id: 'u-budi',
    confirmed_by: 'u-siti', owner_id: 'u-budi', datum_card_id: null, datum_card_url: null, datum_escalated_at: null, ...over,
  };
  store.events.push(ev);
  return ev;
}
