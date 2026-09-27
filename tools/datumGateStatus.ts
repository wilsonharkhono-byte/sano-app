// SANO - DATUM readiness on Papan Ruangan (spec 2026-09-27 §8.2).
//
// The chips are DATUM's own word, read verbatim by the datum-sync function
// into room_datum_gate_status (migration 107). Nothing here derives a
// readiness verdict (truth contract rule 1). Old news is marked old, and
// missing news is never shown as "no news" (rule 2): a never-read project
// says so, a failed read says so, and a linked room DATUM holds nothing for
// says that in its own sentence.

import { supabase } from './supabase';
import { formatWibShort, todayIsoWIB } from './timeWindow';

export type DatumReadiness =
  | 'not_started' | 'in_progress' | 'ready_for_handoff' | 'blocked' | 'passed' | 'not_applicable';

/** One fixed Indonesian label per DATUM status (spec §8.2). */
export const DATUM_READINESS_LABELS: Record<DatumReadiness, string> = {
  not_started: 'belum mulai',
  in_progress: 'berjalan',
  ready_for_handoff: 'siap serah terima',
  blocked: 'terhambat',
  passed: 'lolos',
  not_applicable: 'tidak berlaku',
};

export interface DatumGateRow {
  room_id: string;
  gate_code: string;
  datum_area_id: string;
  status: DatumReadiness;
  datum_stale: boolean;
  synced_at: string;
}

export type DatumGateStatusResult =
  | { paired: false }
  | {
      paired: true;
      /** finished_at of the newest run whose gate_status step was ok; null when none ever was. */
      lastGateReadAt: string | null;
      /** The DATUM areas that read covered. A linked area outside it has not been read yet. */
      readAreaIds: string[];
      /** rooms.datum_area_id by room id, for this project. */
      roomLinks: Record<string, string | null>;
      rows: DatumGateRow[];
    }
  | { error: string };

export const DATUM_OLD_AFTER_MS = 24 * 60 * 60 * 1000;

export const DATUM_BOARD_COPY = {
  readError: 'Status DATUM gagal dimuat.',
  retry: 'Coba lagi',
  never: 'Status DATUM belum tersinkron',
  none: 'DATUM belum punya status untuk ruangan ini',
  old: 'lama',
  datumStale: 'sebagian menunggu hitung ulang di DATUM',
} as const;

/** One read per board load: the pairing, the last good gate read, the room links and the cache. */
export async function listDatumGateStatus(projectId: string): Promise<DatumGateStatusResult> {
  try {
    const project = await supabase.from('projects').select('datum_project_code').eq('id', projectId).maybeSingle();
    if (project.error) return { error: project.error.message };
    if (!project.data?.datum_project_code) return { paired: false };

    const [run, rooms, rows] = await Promise.all([
      supabase
        .from('datum_sync_runs')
        .select('finished_at, gate_area_ids:counts->gate_area_ids')
        .eq('project_id', projectId)
        .eq('counts->steps->>gate_status', 'ok')
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('rooms').select('id, datum_area_id').eq('project_id', projectId),
      supabase
        .from('room_datum_gate_status')
        .select('room_id, gate_code, datum_area_id, status, datum_stale, synced_at')
        .eq('project_id', projectId),
    ]);
    const failed = run.error ?? rooms.error ?? rows.error;
    if (failed) return { error: failed.message };

    const roomLinks: Record<string, string | null> = {};
    for (const r of (rooms.data ?? []) as Array<{ id: string; datum_area_id: string | null }>) roomLinks[r.id] = r.datum_area_id;
    const lastRead = run.data as { finished_at: string; gate_area_ids: string[] | null } | null;
    return {
      paired: true,
      lastGateReadAt: lastRead?.finished_at ?? null,
      readAreaIds: lastRead?.gate_area_ids ?? [],
      roomLinks,
      rows: (rows.data ?? []) as DatumGateRow[],
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export type DatumChipState =
  | { kind: 'hidden' }
  | { kind: 'never' }
  | { kind: 'none' }
  | {
      kind: 'chips';
      chips: Array<{ gate_code: string; status: DatumReadiness; label: string }>;
      asOf: string;
      old: boolean;
      datumStale: boolean;
    };

/** "10.00" when the instant is today in WIB, "27 Sep 10.00" otherwise. */
export function datumAsOfLabel(iso: string, nowIso: string): string {
  const full = formatWibShort(iso);
  const sameDay = todayIsoWIB(new Date(iso)) === todayIsoWIB(new Date(nowIso));
  return sameDay ? full.slice(full.lastIndexOf(' ') + 1) : full;
}

/**
 * What one room shows. `hidden` covers an unpaired project (DATUM is not part
 * of it) and a failed read (the board shows one error line instead, so no
 * room pretends to know). Only rows read for the room's CURRENT area count,
 * and "DATUM has nothing" is said only for an area the last good read
 * covered: a room linked in a run whose gate read failed is "not yet read".
 */
export function datumChipsForRoom(
  room: { room_id: string },
  result: DatumGateStatusResult | null,
  nowIso: string,
): DatumChipState {
  if (!result || 'error' in result || !result.paired) return { kind: 'hidden' };
  const link = result.roomLinks[room.room_id] ?? null;
  if (!link || !result.lastGateReadAt) return { kind: 'never' };
  const rows = result.rows
    .filter((r) => r.room_id === room.room_id && r.datum_area_id === link)
    .sort((a, b) => (a.gate_code < b.gate_code ? -1 : a.gate_code > b.gate_code ? 1 : 0));
  if (rows.length === 0) return result.readAreaIds.includes(link) ? { kind: 'none' } : { kind: 'never' };
  const newest = rows.reduce((max, r) => (r.synced_at > max ? r.synced_at : max), rows[0].synced_at);
  return {
    kind: 'chips',
    chips: rows.map((r) => ({ gate_code: r.gate_code, status: r.status, label: DATUM_READINESS_LABELS[r.status] ?? r.status })),
    asOf: datumAsOfLabel(newest, nowIso),
    old: Date.parse(nowIso) - Date.parse(newest) > DATUM_OLD_AFTER_MS,
    datumStale: rows.some((r) => r.datum_stale),
  };
}
