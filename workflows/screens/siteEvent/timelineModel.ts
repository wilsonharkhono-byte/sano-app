// SANO - Room timeline rules (pure). Spec §9.
//
// The timeline shows a room's events newest first and offers three actions:
// "Selesai", editing the owner and due date, and opening the linked Catatan
// Perubahan. Which of those a given viewer gets is a rule, not a styling
// choice, and migration 099 enforces the same rule in SQL - so it lives here,
// tested, rather than inline in a screen where the two could drift apart.
//
// isOverdue comes from plan 2's detailModel rather than being restated: one
// definition of "late" across the detail screen and the timeline.

import { isOverdue } from './detailModel';
import { isActionableType, isIsoDate } from '../../../tools/siteEventRules';
import type { CloseJob } from '../../../tools/captureQueue';
import type { SiteEvent } from '../../../tools/types';

export { isOverdue };

/** What the timeline needs from an event to order and label it. */
export type TimelineEvent = Pick<
  SiteEvent,
  'id' | 'status' | 'event_type' | 'title' | 'summary' | 'owner_id' | 'due_date'
  | 'confirmed_at' | 'created_at' | 'closed_at' | 'site_change_id' | 'reporter_id'
  | 'gate_code' | 'step_code' | 'is_blocking'
>;

/**
 * Newest first, on the moment a human last acted: an event is placed by its
 * confirmation, and one still waiting for a human by its arrival. Ties break on
 * id so the order is stable across re-reads rather than shuffling.
 */
export function sortTimeline<T extends Pick<TimelineEvent, 'id' | 'confirmed_at' | 'created_at'>>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const ta = a.confirmed_at ?? a.created_at;
    const tb = b.confirmed_at ?? b.created_at;
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

/**
 * Spec §9: office roles and the reporter. Migration 099 raises
 * SITE_EVENT_ASSIGN_ROLE for anybody else, and SITE_EVENT_ASSIGN_NOT_OPEN for
 * an event that is not open, so hiding the control here only spares the user
 * a refusal they would otherwise meet after typing.
 *
 * Being the current OWNER is neither a grant nor a bar: an office role or the
 * reporter who happens to also be the owner can still hand the item on. Spec
 * §9 names exactly two groups; owner-ness is not a third test layered on top
 * of them.
 */
export const OFFICE_ROLES: ReadonlyArray<string> = ['admin', 'estimator', 'principal'];

export function canEditAssignment(
  ev: Pick<TimelineEvent, 'status' | 'reporter_id'>,
  viewer: { id: string | null; role: string | null } | null,
): boolean {
  if (ev.status !== 'open') return false;
  if (!viewer?.id) return false;
  return OFFICE_ROLES.includes(viewer.role ?? '') || ev.reporter_id === viewer.id;
}

/**
 * "Selesai" is offered on an open event to any project member (097's
 * close_site_event checks membership), unless this phone already holds a
 * close job for it that has not reached the server (closure spec §4.5).
 */
export function canClose(ev: Pick<TimelineEvent, 'status'>, closePending = false): boolean {
  return ev.status === 'open' && !closePending;
}

/**
 * The badge a close still on this phone adds beside the server's status
 * (closure spec §4.5), or null when there is none. A job that needs attention
 * (the server refused it, or it ran out of attempts) is not on its way, so it
 * says "Belum terkirim" - the detail screen's "Penutupan belum terkirim" -
 * never "Menunggu kirim".
 */
export function pendingCloseBadge(
  job: Pick<CloseJob, 'needsAttention'> | null | undefined,
): 'Menunggu kirim' | 'Belum terkirim' | null {
  if (!job) return null;
  return job.needsAttention ? 'Belum terkirim' : 'Menunggu kirim';
}

/**
 * True when an event that had a pending close on this phone no longer has one
 * (it closed, was superseded, was cancelled, or can no longer send): the
 * timeline then reads the server again rather than keep showing the stale
 * "Terbuka" and "Selesai" (the detail screen's hadPendingClose rule).
 */
export function pendingCloseLeft(before: ReadonlyArray<string>, after: ReadonlyArray<string>): boolean {
  const now = new Set(after);
  return before.some((id) => !now.has(id));
}

/**
 * The due-date rule migration 099 applies, restated so the form can refuse
 * before the round trip: a MOVED due date may not be in the past, but an event
 * that is already late stays reassignable without inventing a new date.
 * Returns null when the pair is acceptable.
 */
export function validateAssignment(
  ev: Pick<TimelineEvent, 'event_type' | 'due_date'>,
  next: { ownerId: string | null; dueDate: string | null },
  today: string,
): string | null {
  if (isActionableType(ev.event_type) && (!next.ownerId || !next.dueDate)) {
    return 'Kejadian ini wajib punya pemilik dan tenggat.';
  }
  // Checked before the past-date comparison below: a string < comparison on
  // something like "besok" or "12/09/2026" can sort either side of `today`
  // and would otherwise reach Postgres, which refuses in English. Same copy
  // as the confirm screen's CONFIRM_ERRORS.dueFormat, so the two forms agree.
  if (next.dueDate && !isIsoDate(next.dueDate)) {
    return 'Format tenggat harus YYYY-MM-DD.';
  }
  if (next.dueDate && next.dueDate !== ev.due_date && next.dueDate < today) {
    return 'Tenggat tidak boleh sebelum hari ini.';
  }
  return null;
}

/** "Tenggat 12-09-2026" / "Lewat tenggat 2 hari" / null when the event carries no date. */
export function dueLabel(ev: Pick<TimelineEvent, 'status' | 'due_date'>, today: string): string | null {
  if (!ev.due_date) return null;
  if (!isOverdue(ev, today)) return `Tenggat ${fmtDate(ev.due_date)}`;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ev.due_date}T00:00:00Z`)) / 86400000);
  return days === 1 ? 'Lewat tenggat 1 hari' : `Lewat tenggat ${days} hari`;
}

/** DD-MM-YYYY, the spelling migration 099's notification body uses. */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}
