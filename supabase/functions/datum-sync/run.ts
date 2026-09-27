// SANO - datum-sync: one run, step by step.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §6.2-§6.3.
//
// A sync runs areas, link, create, gate_status, staff, escalate in that
// order; an import runs areas, import, gate_status. Each step lands in
// counts.steps as ok, error or skipped, with its reason in counts.step_errors,
// and a failed step skips only the steps that need its output (decision 10).
// Every database access goes through SyncStore (store.ts over the service-role
// client in production, an in-memory fake in the tests), and every DATUM call
// through DatumApi (datum.ts). Nothing here deletes a row, renames anything or
// writes a column other than those store.ts names.

import {
  ESCALATE_AREA_UNKNOWN,
  ESCALATE_BATCH,
  ESCALATE_ROOM_UNLINKED,
  createGateOpen,
  createGateSentence,
  diffGateWords,
  escalationAuthor,
  importRaced,
  planImport,
  planRoomSync,
  planStaffLinks,
  runVerdict,
  sanoRoomUrl,
  staffCounts,
  type CreateFailedItem,
  type EscalateSkipItem,
  type ImportSkip,
  type PlanArea,
  type PlanProfile,
  type PlanRoom,
  type RunCounts,
  type RunDifferences,
  type RunReport,
  type SanoGateWord,
  type SyncSource,
  type SyncStep,
} from './plan.ts';
import type { DatumApi, DatumEscalateBody } from './datum.ts';

export interface ProjectRow { id: string; code: string; datum_project_code: string | null }
export type PairedProject = ProjectRow & { datum_project_code: string };

/** An open, confirmed butuh_keputusan with no card yet, with the names DATUM's note needs. */
export interface EscalationDue {
  id: string;
  title: string;
  summary: string | null;
  due_date: string;
  confirmed_at: string;
  room_code: string;
  room_name: string;
  room_datum_area_id: string | null;
  reporter_name: string | null;
  reporter_staff_id: string | null;
  confirmer_name: string | null;
  confirmer_staff_id: string | null;
  owner_name: string | null;
}

export interface GateStatusCacheRow {
  room_id: string;
  gate_code: string;
  project_id: string;
  datum_area_id: string;
  status: string;
  datum_stale: boolean;
  datum_updated_at: string | null;
  datum_recomputed_at: string | null;
  synced_at: string;
  run_id: string;
}

export interface ImportedRoomRow {
  project_id: string;
  room_code: string;
  room_name: string;
  floor: string | null;
  area_type: string;
  sort_order: number;
  datum_area_id: string;
  created_by: string | null;
}

export interface RunRequest {
  projectId: string;
  source: SyncSource;
  requestedBy: string | null;
  requestId: string | null;
}

/** Every method throws an Error naming the table on a database error. */
export interface SyncStore {
  getProject(projectId: string): Promise<ProjectRow | null>;
  closeStaleRuns(projectId: string, olderThanIso: string, nowIso: string): Promise<void>;
  openRun(req: RunRequest): Promise<{ runId: string } | { running: true }>;
  insertFinishedRun(req: RunRequest, fields: { finishedAt: string; error: string }): Promise<string>;
  finishRun(
    runId: string,
    fields: { finishedAt: string; ok: boolean; counts: RunCounts; differences: RunDifferences; error: string | null },
  ): Promise<void>;
  markRequest(requestId: string, fields: { handledAt: string; runId: string | null; error: string | null }): Promise<void>;
  listRooms(projectId: string): Promise<PlanRoom[]>;
  setRoomLink(roomId: string, areaId: string): Promise<void>;
  /** The new room's id, or null when a room with that code was made meanwhile (23505). */
  insertImportedRoom(row: ImportedRoomRow): Promise<string | null>;
  listGateRefs(): Promise<SanoGateWord[]>;
  upsertGateStatus(rows: GateStatusCacheRow[]): Promise<void>;
  listProfiles(): Promise<PlanProfile[]>;
  setProfileStaffLink(profileId: string, staffId: string): Promise<void>;
  /**
   * Open, confirmed butuh_keputusan with no card yet, oldest confirmed first,
   * in rooms that have a DATUM area ('linked') or not ('unlinked'): at most
   * `limit` rows, and the total. Filtered in the query, so decisions in
   * unlinked rooms never take the batch from newer ones in linked rooms.
   */
  listEscalationDue(projectId: string, rooms: 'linked' | 'unlinked', limit: number): Promise<{ rows: EscalationDue[]; total: number }>;
  setEventCard(eventId: string, cardId: string, cardUrl: string, escalatedAtIso: string): Promise<void>;
}

export interface RunContext { store: SyncStore; datum: DatumApi; now: () => Date }

export const RUN_INTERRUPTED = 'Sinkron terputus sebelum selesai.';
export const PAIRING_MISSING = 'Proyek ini belum ditautkan ke DATUM.';
export const SYNC_RUNNING = 'Sinkron DATUM untuk proyek ini sedang berjalan.';
export const AREAS_UNREAD = 'Area DATUM tidak terbaca pada sinkron ini.';
export const STALE_RUN_MS = 10 * 60 * 1000;
/** DATUM's POST areas takes 1-200 items per call. */
export const CREATE_BATCH = 200;

/*
 * Wall time. A run must end well inside the platform's 150 s limit, however
 * DATUM behaves. Every DATUM call gives up after 15 s (datum.ts). The fixed
 * calls are areas, the first create batch, gate-status and staff; the loops
 * are bounded by the run's own clock, and a failure that says DATUM is gone
 * (no answer, 401, 503) ends a loop at once, because every later call would
 * fail the same way:
 *   areas                          ends by  15 s
 *   create batch 1                 ends by  30 s
 *   create batches 2..n            start before 45 s, so end by 60 s
 *   gate-status, staff             end by  90 s
 *   escalations                    start before 100 s, so end by 115 s
 * then a handful of database writes (the card link, the run row, the
 * request). What a loop does not reach is deferred and said so: rooms under
 * create_failed with CREATE_DEFERRED, decisions in escalate_deferred.
 */
export const CREATE_BATCH_START_BEFORE_MS = 45_000;
export const ESCALATE_START_BEFORE_MS = 100_000;
export const CREATE_DEFERRED = 'Belum dikirim ke DATUM: waktu sinkron ini habis. Dikirim pada sinkron berikutnya.';

/** No answer (timeout, network), a refused key, or DATUM not configured: the next call would fail the same way. */
export function datumUnreachable(status: number): boolean {
  return status === 0 || status === 401 || status === 503;
}

const READINESS = new Set(['not_started', 'in_progress', 'ready_for_handoff', 'blocked', 'passed', 'not_applicable']);

const CREATE_ITEM_ERRORS: Record<string, string> = {
  CODE_NOT_NORMALIZED: 'DATUM menolak kodenya: bukan kode yang sudah dinormalkan.',
  INVALID: 'DATUM menolak nama, lantai atau tipenya.',
  DB_ERROR: 'DATUM gagal menyimpannya.',
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export type StartOutcome =
  | { kind: 'started'; runId: string; project: PairedProject }
  | { kind: 'pairing_missing'; runId: string }
  | { kind: 'running' }
  | { kind: 'not_found' };

/** §6.2 steps 1-2: the pairing, the stale-run sweep, then the lock (one open run per project). */
export async function startRun(ctx: RunContext, req: RunRequest): Promise<StartOutcome> {
  const project = await ctx.store.getProject(req.projectId);
  if (!project) return { kind: 'not_found' };
  const now = ctx.now();
  if (!project.datum_project_code) {
    const runId = await ctx.store.insertFinishedRun(req, { finishedAt: now.toISOString(), error: PAIRING_MISSING });
    return { kind: 'pairing_missing', runId };
  }
  await ctx.store.closeStaleRuns(req.projectId, new Date(now.getTime() - STALE_RUN_MS).toISOString(), now.toISOString());
  const opened = await ctx.store.openRun(req);
  if ('running' in opened) return { kind: 'running' };
  return { kind: 'started', runId: opened.runId, project: project as PairedProject };
}

class Recorder {
  counts: RunCounts = { steps: {}, step_errors: {} };
  differences: RunDifferences = {};
  ok(step: SyncStep): void {
    this.counts.steps[step] = 'ok';
  }
  fail(step: SyncStep, reason: string): void {
    this.counts.steps[step] = 'error';
    this.counts.step_errors![step] = reason;
  }
  skip(step: SyncStep, reason: string): void {
    this.counts.steps[step] = 'skipped';
    this.counts.step_errors![step] = reason;
  }
}

async function readAreas(ctx: RunContext, rec: Recorder, code: string): Promise<PlanArea[] | null> {
  const reply = await ctx.datum.getAreas(code);
  if (!reply.ok) {
    rec.fail('areas', reply.error);
    return null;
  }
  rec.ok('areas');
  rec.counts.datum_project_name = reply.data.project.project_name;
  return reply.data.areas;
}

async function readRooms(ctx: RunContext, projectId: string): Promise<{ rooms: PlanRoom[] } | { error: string }> {
  try {
    return { rooms: await ctx.store.listRooms(projectId) };
  } catch (err) {
    return { error: `Ruangan SANO gagal dibaca: ${message(err)}` };
  }
}

function linkLocally(rooms: PlanRoom[], roomId: string, areaId: string): void {
  const room = rooms.find((r) => r.id === roomId);
  if (room) room.datum_area_id = areaId;
}

function recordPlanDifferences(rec: Recorder, plan: ReturnType<typeof planRoomSync>, nowInSano: ReadonlySet<string>): void {
  const datumOnly = plan.datumOnly.filter((a) => !nowInSano.has(a.area_id));
  rec.counts.datum_only = datumOnly.length;
  rec.counts.field_conflicts = plan.fieldConflicts.length;
  rec.counts.retired_missing = plan.retiredMissing.length;
  if (datumOnly.length) {
    rec.differences.datum_only = datumOnly.map((a) => ({
      area_code: a.area_code, area_name: a.area_name, floor: a.floor, area_type: a.area_type,
    }));
  }
  if (plan.fieldConflicts.length) rec.differences.field_conflicts = plan.fieldConflicts;
  if (plan.datumDuplicates.length) rec.differences.datum_duplicates = plan.datumDuplicates;
}

async function linkAndCreate(
  ctx: RunContext,
  rec: Recorder,
  project: PairedProject,
  rooms: PlanRoom[] | null,
  roomsError: string | null,
  areas: PlanArea[] | null,
  startedMs: number,
): Promise<void> {
  if (!areas) {
    rec.skip('link', AREAS_UNREAD);
    rec.skip('create', AREAS_UNREAD);
    return;
  }
  if (!rooms) {
    rec.fail('link', roomsError ?? 'Ruangan SANO gagal dibaca.');
    rec.skip('create', roomsError ?? 'Ruangan SANO gagal dibaca.');
    return;
  }
  const plan = planRoomSync(rooms, areas);
  recordPlanDifferences(rec, plan, new Set());

  let linkedNow = 0;
  let linkError: string | null = null;
  for (const item of plan.link) {
    try {
      await ctx.store.setRoomLink(item.room_id, item.area_id);
      linkLocally(rooms, item.room_id, item.area_id);
      linkedNow += 1;
    } catch (err) {
      linkError ??= `Tautan ruangan ${item.room_code} gagal disimpan: ${message(err)}`;
    }
  }
  if (linkError) rec.fail('link', linkError);
  else rec.ok('link');

  const createFailed: CreateFailedItem[] = [...plan.createFailed];
  let created = 0;
  if (!createGateOpen(plan, areas.length)) {
    rec.skip('create', createGateSentence(rec.counts.datum_project_name ?? project.datum_project_code));
  } else if (plan.create.length === 0) {
    rec.ok('create');
  } else {
    let createError: string | null = null;
    const byCode = new Map(plan.create.map((c) => [c.area_code, c]));
    for (let start = 0; start < plan.create.length; start += CREATE_BATCH) {
      const batch = plan.create.slice(start, start + CREATE_BATCH);
      if (start > 0 && ctx.now().getTime() - startedMs >= CREATE_BATCH_START_BEFORE_MS) {
        for (const item of plan.create.slice(start)) createFailed.push({ room_code: item.area_code, reason: CREATE_DEFERRED });
        break;
      }
      const posted = await ctx.datum.postAreas(
        project.datum_project_code,
        batch.map(({ area_code, area_name, floor, area_type, tracked }) => ({ area_code, area_name, floor, area_type, tracked })),
      );
      if (!posted.ok) {
        createError ??= posted.error;
        if (datumUnreachable(posted.status)) break;
        continue;
      }
      for (const area of posted.data.areas) {
        const item = byCode.get(area.area_code);
        if (!item) continue;
        try {
          await ctx.store.setRoomLink(item.room_id, area.id);
          linkLocally(rooms, item.room_id, area.id);
          linkedNow += 1;
          if (area.created) created += 1;
        } catch (err) {
          createError ??= `Tautan ruangan ${item.area_code} gagal disimpan: ${message(err)}`;
        }
      }
      for (const e of posted.data.errors) {
        createFailed.push({ room_code: e.area_code, reason: CREATE_ITEM_ERRORS[e.code] ?? `DATUM menolak: ${e.code}` });
      }
    }
    if (createError) rec.fail('create', createError);
    else rec.ok('create');
  }
  rec.counts.rooms_linked_now = linkedNow;
  rec.counts.rooms_created = created;
  if (createFailed.length) rec.differences.create_failed = createFailed;
}

async function gateStatusStep(
  ctx: RunContext,
  rec: Recorder,
  runId: string,
  project: PairedProject,
  rooms: PlanRoom[] | null,
  roomsError: string | null,
): Promise<void> {
  const reply = await ctx.datum.getGateStatus(project.datum_project_code);
  if (!reply.ok) {
    rec.fail('gate_status', reply.error);
    return;
  }
  if (!rooms) {
    rec.fail('gate_status', roomsError ?? 'Ruangan SANO gagal dibaca.');
    return;
  }
  try {
    const refs = await ctx.store.listGateRefs();
    const known = new Set(refs.map((r) => r.code));
    const roomsByArea = new Map<string, string[]>();
    for (const r of rooms) {
      if (r.datum_area_id) roomsByArea.set(r.datum_area_id, [...(roomsByArea.get(r.datum_area_id) ?? []), r.id]);
    }
    const syncedAt = ctx.now().toISOString();
    const rows: GateStatusCacheRow[] = [];
    let unlinked = 0;
    for (const s of reply.data.statuses) {
      const roomIds = roomsByArea.get(s.area_id);
      if (!roomIds || !known.has(s.gate_code) || !READINESS.has(s.status)) {
        unlinked += 1;
        continue;
      }
      for (const roomId of roomIds) {
        rows.push({
          room_id: roomId, gate_code: s.gate_code, project_id: project.id, datum_area_id: s.area_id,
          status: s.status, datum_stale: s.stale === true, datum_updated_at: s.updated_at,
          datum_recomputed_at: s.last_recomputed_at, synced_at: syncedAt, run_id: runId,
        });
      }
    }
    if (rows.length) await ctx.store.upsertGateStatus(rows);
    rec.counts.gate_rows = rows.length;
    rec.counts.gate_rows_unlinked = unlinked;
    rec.counts.gate_area_ids = [...roomsByArea.keys()].sort();
    const words = diffGateWords(reply.data.gates, refs);
    if (words.length) rec.differences.gate_words = words;
    rec.ok('gate_status');
  } catch (err) {
    rec.fail('gate_status', `Status gerbang DATUM gagal disimpan: ${message(err)}`);
  }
}

async function staffStep(ctx: RunContext, rec: Recorder): Promise<void> {
  const reply = await ctx.datum.getStaff();
  if (!reply.ok) {
    rec.fail('staff', reply.error);
    return;
  }
  let profiles: PlanProfile[];
  try {
    profiles = await ctx.store.listProfiles();
  } catch (err) {
    rec.fail('staff', `Profil SANO gagal dibaca: ${message(err)}`);
    return;
  }
  const plan = planStaffLinks(profiles, reply.data.staff);
  let setError: string | null = null;
  let setFailed = 0;
  for (const s of plan.set) {
    try {
      await ctx.store.setProfileStaffLink(s.profile_id, s.staff_id);
    } catch (err) {
      setFailed += 1;
      setError ??= `Tautan staf gagal disimpan: ${message(err)}`;
    }
  }
  const counts = staffCounts(plan);
  rec.counts.staff = { ...counts, linked: counts.linked - setFailed, linked_now: counts.linked_now - setFailed };
  rec.differences.staff = { unmatched: plan.unmatched, ambiguous: plan.ambiguous, stale: plan.stale };
  if (setError) rec.fail('staff', setError);
  else rec.ok('staff');
}

async function escalateStep(ctx: RunContext, rec: Recorder, project: PairedProject, startedMs: number): Promise<void> {
  let linked: { rows: EscalationDue[]; total: number };
  let unlinked: { rows: EscalationDue[]; total: number };
  try {
    [linked, unlinked] = await Promise.all([
      ctx.store.listEscalationDue(project.id, 'linked', ESCALATE_BATCH),
      ctx.store.listEscalationDue(project.id, 'unlinked', ESCALATE_BATCH),
    ]);
  } catch (err) {
    rec.fail('escalate', `Keputusan SANO gagal dibaca: ${message(err)}`);
    return;
  }
  const skip = (ev: EscalationDue, reason: string): EscalateSkipItem => ({ event_id: ev.id, room_code: ev.room_code, title: ev.title, reason });
  const skipped: EscalateSkipItem[] = unlinked.rows.map((ev) => skip(ev, ESCALATE_ROOM_UNLINKED));
  let escalated = 0;
  let asSystem = 0;
  let failed = 0;
  let areaUnknown = 0;
  let firstError: string | null = null;
  /** Areas DATUM answered UNKNOWN_AREA for in this run: their other decisions would get the same answer. */
  const unknownAreas = new Set<string>();
  /** Linked decisions this run dealt with (sent, failed or skipped); the rest of the total is deferred. */
  let handled = 0;
  for (const ev of linked.rows) {
    const areaId = ev.room_datum_area_id as string;
    if (unknownAreas.has(areaId)) {
      handled += 1;
      areaUnknown += 1;
      skipped.push(skip(ev, ESCALATE_AREA_UNKNOWN));
      continue;
    }
    if (ctx.now().getTime() - startedMs >= ESCALATE_START_BEFORE_MS) break;
    handled += 1;
    const body: DatumEscalateBody = {
      project_code: project.datum_project_code,
      area_id: areaId,
      sano_event_id: ev.id,
      sano_url: sanoRoomUrl(project.code, ev.room_code),
      title: ev.title,
      summary: ev.summary,
      room_name: ev.room_name,
      reporter_name: ev.reporter_name ?? '',
      confirmer_name: ev.confirmer_name,
      owner_name: ev.owner_name ?? '',
      due_date: ev.due_date,
      confirmed_at: ev.confirmed_at,
      author_staff_id: escalationAuthor(ev.reporter_staff_id, ev.confirmer_staff_id),
    };
    const reply = await ctx.datum.escalate(body);
    if (!reply.ok) {
      failed += 1;
      firstError ??= reply.error;
      if (reply.code === 'UNKNOWN_AREA') unknownAreas.add(areaId);
      skipped.push(skip(ev, `Gagal dikirim: ${reply.error}`));
      if (datumUnreachable(reply.status)) break;
      continue;
    }
    try {
      await ctx.store.setEventCard(ev.id, reply.data.card_id, reply.data.card_url, ctx.now().toISOString());
      escalated += 1;
      if (reply.data.author === 'system') asSystem += 1;
    } catch (err) {
      failed += 1;
      const reason = `Kartu DATUM sudah dibuat, tetapi SANO gagal mencatatnya: ${message(err)}`;
      firstError ??= reason;
      skipped.push(skip(ev, reason));
    }
  }
  rec.counts.escalated = escalated;
  rec.counts.escalated_as_system = asSystem;
  rec.counts.escalate_failed = failed;
  rec.counts.escalate_skipped = unlinked.total + areaUnknown;
  rec.counts.escalate_deferred = Math.max(0, linked.total - handled);
  if (skipped.length) rec.differences.escalate_skipped = skipped;
  if (firstError) rec.fail('escalate', firstError);
  else rec.ok('escalate');
}

async function finish(ctx: RunContext, runId: string, req: RunRequest, rec: Recorder, rooms: PlanRoom[] | null): Promise<RunReport> {
  if (rooms) rec.counts.rooms_linked = rooms.filter((r) => r.active && r.datum_area_id).length;
  const verdict = runVerdict(rec.counts);
  const at = ctx.now().toISOString();
  await ctx.store.finishRun(runId, {
    finishedAt: at, ok: verdict.ok, counts: rec.counts, differences: rec.differences, error: verdict.error,
  });
  if (req.requestId) await ctx.store.markRequest(req.requestId, { handledAt: at, runId, error: verdict.error });
  return { ok: verdict.ok, runId, counts: rec.counts, differences: rec.differences, error: verdict.error };
}

const SYNC_STEPS: ReadonlyArray<SyncStep> = ['areas', 'link', 'create', 'gate_status', 'staff', 'escalate'];
const IMPORT_STEPS: ReadonlyArray<SyncStep> = ['areas', 'import', 'gate_status'];

/**
 * An unexpected throw still closes the run: the step it happened in is
 * `error`, the steps after it `skipped`, both with the reason, and the lock
 * frees at once instead of after ten minutes.
 */
async function guarded(
  ctx: RunContext,
  runId: string,
  req: RunRequest,
  rec: Recorder,
  steps: ReadonlyArray<SyncStep>,
  body: () => Promise<PlanRoom[] | null>,
): Promise<RunReport> {
  let rooms: PlanRoom[] | null = null;
  try {
    rooms = await body();
  } catch (err) {
    const reason = `Kesalahan tak terduga: ${message(err)}`;
    steps
      .filter((s) => rec.counts.steps[s] === undefined)
      .forEach((s, i) => (i === 0 ? rec.fail(s, reason) : rec.skip(s, reason)));
  }
  return finish(ctx, runId, req, rec, rooms);
}

/** §6.2: a sync. */
export function executeSync(ctx: RunContext, runId: string, project: PairedProject, req: RunRequest): Promise<RunReport> {
  const rec = new Recorder();
  const startedMs = ctx.now().getTime();
  return guarded(ctx, runId, req, rec, SYNC_STEPS, async () => {
    const areas = await readAreas(ctx, rec, project.datum_project_code);
    const read = await readRooms(ctx, project.id);
    const rooms = 'rooms' in read ? read.rooms : null;
    const roomsError = 'error' in read ? read.error : null;
    await linkAndCreate(ctx, rec, project, rooms, roomsError, areas, startedMs);
    await gateStatusStep(ctx, rec, runId, project, rooms, roomsError);
    await staffStep(ctx, rec);
    await escalateStep(ctx, rec, project, startedMs);
    return rooms;
  });
}

/** §6.3: "Ambil {n} ruangan dari DATUM", only the codes the user confirmed. */
export function executeImport(
  ctx: RunContext,
  runId: string,
  project: PairedProject,
  req: RunRequest,
  confirmedCodes: ReadonlyArray<string>,
): Promise<RunReport> {
  const rec = new Recorder();
  return guarded(ctx, runId, req, rec, IMPORT_STEPS, async () => {
    const areas = await readAreas(ctx, rec, project.datum_project_code);
    const read = await readRooms(ctx, project.id);
    const rooms = 'rooms' in read ? read.rooms : null;
    const roomsError = 'error' in read ? read.error : null;

    if (!areas) {
      rec.skip('import', AREAS_UNREAD);
    } else if (!rooms) {
      rec.fail('import', roomsError ?? 'Ruangan SANO gagal dibaca.');
    } else {
      const plan = planRoomSync(rooms, areas);
      const toImport = planImport(plan, confirmedCodes);
      const skipped: ImportSkip[] = [...toImport.skipped];
      // Areas that now have a SANO room with their code: imported here, or
      // made in SANO meanwhile. Neither is "only in DATUM" any more.
      const imported = new Set<string>();
      const nowInSano = new Set<string>();
      let importError: string | null = null;
      for (const item of toImport.insert) {
        try {
          const roomId = await ctx.store.insertImportedRoom({
            project_id: project.id, room_code: item.room_code, room_name: item.room_name, floor: item.floor,
            area_type: item.area_type, sort_order: item.sort_order, datum_area_id: item.area_id, created_by: req.requestedBy,
          });
          if (roomId === null) {
            nowInSano.add(item.area_id);
            skipped.push({ area_code: item.area_code, reason: importRaced(item.room_code) });
            continue;
          }
          imported.add(item.area_id);
          nowInSano.add(item.area_id);
          rooms.push({
            id: roomId, room_code: item.room_code, room_name: item.room_name, floor: item.floor, area_type: item.area_type,
            sort_order: item.sort_order, active: true, datum_area_id: item.area_id,
          });
        } catch (err) {
          const reason = `Gagal dibuat di SANO: ${message(err)}`;
          importError ??= reason;
          skipped.push({ area_code: item.area_code, reason });
        }
      }
      recordPlanDifferences(rec, plan, nowInSano);
      rec.counts.rooms_imported = imported.size;
      if (skipped.length) rec.differences.import_skipped = skipped;
      if (importError) rec.fail('import', importError);
      else rec.ok('import');
    }
    await gateStatusStep(ctx, rec, runId, project, rooms, roomsError);
    return rooms;
  });
}
