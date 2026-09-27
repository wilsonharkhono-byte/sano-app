// SANO - datum-sync: SyncStore over the service-role client.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §4, §6.
// The only file in this function that talks to SANO's database. It writes
// exactly these columns, and tools/__tests__/datumSyncPlanTwin.test.ts (jest,
// which CI runs) pins the list:
//   datum_sync_runs    finished_at, ok, counts, differences, error (+ the insert)
//   datum_sync_requests handled_at, run_id, error
//   rooms              datum_area_id (+ the import's insert)
//   profiles           datum_staff_id, only where it is NULL
//   room_datum_gate_status (upsert)
//   site_events        datum_card_id, datum_card_url, datum_escalated_at, only where the card id is NULL
// Migration 107's guards refuse every one of these writes from app roles; the
// service role passes them. profiles has no `active` column on the live
// project, so none is read.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlanProfile, PlanRoom, SanoGateWord } from './plan.ts';
import { RUN_INTERRUPTED, type EscalationDue, type ProjectRow, type SyncStore } from './run.ts';

function check(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

// rooms!inner, not aliased, so the room's link filters the events themselves
// (PostgREST: rooms.datum_area_id=is.null / not.is.null on an inner embed).
const DUE_SELECT =
  'id, title, summary, due_date, confirmed_at, rooms!inner(room_code, room_name, datum_area_id), reporter:profiles!site_events_reporter_id_fkey(full_name, datum_staff_id), confirmer:profiles!site_events_confirmed_by_fkey(full_name, datum_staff_id), owner:profiles!site_events_owner_id_fkey(full_name)';

type Person = { full_name: string | null; datum_staff_id?: string | null } | null;
type DueRow = {
  id: string;
  title: string;
  summary: string | null;
  due_date: string;
  confirmed_at: string;
  rooms: { room_code: string; room_name: string; datum_area_id: string | null } | null;
  reporter: Person;
  confirmer: Person;
  owner: Person;
};

export function makeSupabaseStore(admin: SupabaseClient): SyncStore {
  return {
    async getProject(projectId) {
      const { data, error } = await admin.from('projects').select('id, code, datum_project_code').eq('id', projectId).maybeSingle();
      check('projects', error);
      return (data as ProjectRow | null) ?? null;
    },

    async closeStaleRuns(projectId, olderThanIso, nowIso) {
      const { data, error } = await admin.from('datum_sync_runs')
        .update({ finished_at: nowIso, ok: false, error: RUN_INTERRUPTED })
        .eq('project_id', projectId)
        .is('finished_at', null)
        .lt('started_at', olderThanIso)
        .select('id, request_id');
      check('datum_sync_runs', error);
      return ((data ?? []) as Array<{ id: string; request_id: string | null }>).map((r) => ({ runId: r.id, requestId: r.request_id }));
    },

    async openRun(req) {
      const { data, error } = await admin.from('datum_sync_runs')
        .insert({ project_id: req.projectId, source: req.source, requested_by: req.requestedBy, request_id: req.requestId })
        .select('id')
        .single();
      if (error?.code === '23505') return { running: true };
      check('datum_sync_runs', error);
      return { runId: (data as { id: string }).id };
    },

    async insertFinishedRun(req, fields) {
      const { data, error } = await admin.from('datum_sync_runs')
        .insert({
          project_id: req.projectId, source: req.source, requested_by: req.requestedBy, request_id: req.requestId,
          finished_at: fields.finishedAt, ok: false, error: fields.error,
        })
        .select('id')
        .single();
      check('datum_sync_runs', error);
      return (data as { id: string }).id;
    },

    async finishRun(runId, fields) {
      const { error } = await admin.from('datum_sync_runs')
        .update({ finished_at: fields.finishedAt, ok: fields.ok, counts: fields.counts, differences: fields.differences, error: fields.error })
        .eq('id', runId);
      check('datum_sync_runs', error);
    },

    async markRequest(requestId, fields) {
      const { error } = await admin.from('datum_sync_requests')
        .update({ handled_at: fields.handledAt, run_id: fields.runId, error: fields.error })
        .eq('id', requestId);
      check('datum_sync_requests', error);
    },

    async listRooms(projectId) {
      const { data, error } = await admin.from('rooms')
        .select('id, room_code, room_name, floor, area_type, sort_order, active, datum_area_id')
        .eq('project_id', projectId);
      check('rooms', error);
      return (data ?? []) as PlanRoom[];
    },

    async setRoomLink(roomId, areaId) {
      const { error } = await admin.from('rooms')
        .update({ datum_area_id: areaId })
        .eq('id', roomId);
      check('rooms', error);
    },

    async insertImportedRoom(row) {
      const { data, error } = await admin.from('rooms').insert(row).select('id').single();
      if (error?.code === '23505') return null;
      check('rooms', error);
      return (data as { id: string }).id;
    },

    async listGateRefs() {
      const { data, error } = await admin.from('gate_refs').select('code, name_id, description');
      check('gate_refs', error);
      return (data ?? []) as SanoGateWord[];
    },

    async upsertGateStatus(rows) {
      const { error } = await admin.from('room_datum_gate_status').upsert(rows, { onConflict: 'room_id,gate_code' });
      check('room_datum_gate_status', error);
    },

    async listProfiles() {
      const { data, error } = await admin.from('profiles').select('id, full_name, datum_staff_id');
      check('profiles', error);
      return (data ?? []) as PlanProfile[];
    },

    async setProfileStaffLink(profileId, staffId) {
      const { error } = await admin.from('profiles')
        .update({ datum_staff_id: staffId })
        .eq('id', profileId)
        .is('datum_staff_id', null);
      check('profiles', error);
    },

    async listEscalationDue(projectId, rooms, limit) {
      const { data, error, count } = await admin.from('site_events')
        .select(DUE_SELECT, { count: 'exact' })
        .eq('project_id', projectId)
        .eq('status', 'open')
        .eq('event_type', 'butuh_keputusan')
        .not('confirmed_at', 'is', null)
        .is('datum_card_id', null)
        .filter('rooms.datum_area_id', rooms === 'linked' ? 'not.is' : 'is', null)
        .order('confirmed_at', { ascending: true })
        .limit(limit);
      check('site_events', error);
      const rows = ((data ?? []) as unknown as DueRow[]).map((e): EscalationDue => ({
        id: e.id,
        title: e.title,
        summary: e.summary,
        due_date: e.due_date,
        confirmed_at: e.confirmed_at,
        room_code: e.rooms?.room_code ?? '',
        room_name: e.rooms?.room_name ?? '',
        room_datum_area_id: e.rooms?.datum_area_id ?? null,
        reporter_name: e.reporter?.full_name ?? null,
        reporter_staff_id: e.reporter?.datum_staff_id ?? null,
        confirmer_name: e.confirmer?.full_name ?? null,
        confirmer_staff_id: e.confirmer?.datum_staff_id ?? null,
        owner_name: e.owner?.full_name ?? null,
      }));
      return { rows, total: count ?? rows.length };
    },

    async setEventCard(eventId, cardId, cardUrl, escalatedAtIso) {
      const { error } = await admin.from('site_events')
        .update({ datum_card_id: cardId, datum_card_url: cardUrl, datum_escalated_at: escalatedAtIso })
        .eq('id', eventId)
        .is('datum_card_id', null);
      check('site_events', error);
    },
  };
}
