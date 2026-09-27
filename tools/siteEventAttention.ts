// SANO - "Perlu ditindak" and the digest health line (closure spec 2026-09-26 §5.6).
//
// Reads migration 106's two views. v_site_event_attention is the SAME
// predicate the 07:00 digest counts, so the number in a push and the rows seen
// on tapping it cannot disagree. Both reads return a read error rather than an
// empty result on failure (the RoomBoardResult shape, tools/roomBoard.ts): a
// dropped connection must never render as "nothing needs attention" (CLAUDE.md §12).

import { supabase } from './supabase';
import type { SiteEventType } from './types';

/** The list shows at most this many rows; the title then says "(200 teratas)". */
export const ATTENTION_LIMIT = 200;

/** Every column of v_site_event_attention, one literal (see the ROOM_COLUMNS note in tools/rooms.ts). */
export const ATTENTION_COLUMNS =
  'event_id, project_id, room_id, room_code, room_name, floor, gate_code, event_type, title, summary, ' +
  'owner_id, owner_name, owner_on_project, due_date, is_blocking, confirmed_at, is_overdue, days_overdue';

export interface AttentionRow {
  event_id: string;
  project_id: string;
  room_id: string;
  room_code: string | null;
  room_name: string;
  floor: string | null;
  gate_code: string | null;
  event_type: SiteEventType | null;
  title: string | null;
  summary: string | null;
  owner_id: string | null;
  owner_name: string | null;
  /** NULL when the reader's own RLS cannot see the owner's membership (a supervisor, for a colleague's item). */
  owner_on_project: boolean | null;
  due_date: string | null;
  is_blocking: boolean;
  confirmed_at: string | null;
  is_overdue: boolean;
  days_overdue: number;
}

export type AttentionResult = { rows: AttentionRow[] } | { error: string };

export async function listSiteEventAttention(projectId: string): Promise<AttentionResult> {
  const { data, error } = await supabase
    .from('v_site_event_attention')
    .select(ATTENTION_COLUMNS)
    .eq('project_id', projectId)
    .order('days_overdue', { ascending: false })
    .order('due_date', { ascending: true })
    .order('confirmed_at', { ascending: true })
    .order('event_id', { ascending: true })
    .limit(ATTENTION_LIMIT);
  if (error) {
    console.warn('listSiteEventAttention failed:', error.message);
    return { error: error.message };
  }
  return { rows: (data ?? []) as unknown as AttentionRow[] };
}

export interface DigestHealth {
  last_run_date: string;
  last_sent_at: string;
  recipients: number;
}

/** `last` is null when the log has no row at all: no digest has ever landed. */
export type DigestHealthResult = { last: DigestHealth | null } | { error: string };

export async function getDigestHealth(): Promise<DigestHealthResult> {
  const { data, error } = await supabase
    .from('v_site_event_digest_health')
    .select('last_run_date, last_sent_at, recipients')
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('getDigestHealth failed:', error.message);
    return { error: error.message };
  }
  return { last: (data as DigestHealth | null) ?? null };
}

// ─── Pure ────────────────────────────────────────────────────────────────────

/**
 * A SITE_EVENT_DIGEST tap lands on Papan Ruangan with { projectId, attention,
 * mine } (spec §5.6). This turns those route params into the list's "Milik
 * saya" request: null when the screen was not opened from a digest, else a
 * NEW object on every call, so a second tap of the same notification
 * (routeDeeplink copies params, workflows/pendingDeeplink.ts) re-applies it
 * even when the list is already on screen. Screens memoise it on the params.
 */
export function attentionMineRequest(
  params: Readonly<Record<string, unknown>> | null | undefined,
): { mine: boolean } | null {
  return params?.attention ? { mine: params.mine === true } : null;
}

/** "Milik saya": the same rows, filtered, with no second query. */
export function filterMine(rows: ReadonlyArray<AttentionRow>, viewerId: string | null): AttentionRow[] {
  if (!viewerId) return [];
  return rows.filter((r) => r.owner_id === viewerId);
}

/**
 * "Perlu ditindak (n)", or "(200 teratas)" when the read hit the cap. With
 * "Milik saya" on over a capped read the filter saw only those 200 rows, so
 * the count says so: "(n dari 200 teratas)", never a bare n that reads as
 * everything the viewer owns (CLAUDE.md §12).
 */
export function attentionHeading(totalRead: number, shown: number, mine: boolean): string {
  if (totalRead < ATTENTION_LIMIT) return `Perlu ditindak (${shown})`;
  return mine ? `Perlu ditindak (${shown} dari ${ATTENTION_LIMIT} teratas)` : `Perlu ditindak (${ATTENTION_LIMIT} teratas)`;
}

/**
 * The empty text. With "Milik saya" on over a capped read, the viewer may
 * well own items beyond the first 200: say only what the read can prove.
 */
export function attentionEmptyText(totalRead: number, mine: boolean): string {
  if (!mine) return 'Tidak ada yang perlu ditindak.';
  return totalRead >= ATTENTION_LIMIT
    ? `Tidak ada tugas Anda di ${ATTENTION_LIMIT} teratas.`
    : 'Tidak ada tugas Anda yang perlu ditindak.';
}

/** "LT1-R01 · Kamar Tidur 1", or the name alone when the room has no code. */
export function attentionRoomLabel(row: Pick<AttentionRow, 'room_code' | 'room_name'>): string {
  return row.room_code ? `${row.room_code} · ${row.room_name}` : row.room_name;
}

export type AttentionChipTone = 'late' | 'block' | 'pending' | 'owner' | 'unowned';

export interface AttentionChip {
  label: string;
  tone: AttentionChipTone;
}

/**
 * The row's chips, in order. The owner chip is for office layouts only; it
 * says "Tanpa penanggung jawab" only when the view KNOWS the owner is gone
 * (owner_on_project false), never when the reader simply cannot see it (null).
 */
export function attentionChips(
  row: AttentionRow,
  opts: { showOwner: boolean; closePending: boolean },
): AttentionChip[] {
  const chips: AttentionChip[] = [];
  if (row.days_overdue >= 1) chips.push({ label: `Lewat ${row.days_overdue} hari`, tone: 'late' });
  if (row.is_blocking) chips.push({ label: 'Menghambat', tone: 'block' });
  if (opts.closePending) chips.push({ label: 'Menunggu kirim', tone: 'pending' });
  if (opts.showOwner) {
    if (row.owner_on_project === false) chips.push({ label: 'Tanpa penanggung jawab', tone: 'unowned' });
    else if (row.owner_name) chips.push({ label: row.owner_name, tone: 'owner' });
  }
  return chips;
}
