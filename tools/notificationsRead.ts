// SANO — reliable notification read-acknowledgement.
//
// Extracted from workflows/screens/NotificationsScreen.tsx, which used to
// fire this write with `void supabase.from(...).update(...)` — unawaited,
// no error check, no revert. On a dropped request the optimistic UI showed
// the notification as read while the server never recorded it, so the
// unread badge (useUnreadCount) resurrected the item on next launch/focus.
//
// This helper is awaited by the caller and never throws — every failure
// mode (network error, RLS no-op) resolves to { ok: false, error }, so the
// caller can revert its optimistic update instead of lying to the user.

import { supabase } from './supabase';

export interface MarkNotificationReadResult {
  ok: boolean;
  error: string | null;
}

/**
 * Mark a single notification as read. Uses `.select('id')` so PostgREST
 * returns the updated row(s) — this is what catches a *silent* RLS no-op
 * (the update matches zero rows: wrong recipient, already-deleted row,
 * policy denial) that would otherwise look identical to success with a
 * bare `.update().eq()` call.
 */
export async function markNotificationRead(
  id: string,
  readAt: string,
): Promise<MarkNotificationReadResult> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('id', id)
      .select('id');

    if (error) {
      return { ok: false, error: error.message };
    }
    if (!data || data.length === 0) {
      return { ok: false, error: 'No notification row was updated (not found or not permitted)' };
    }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
