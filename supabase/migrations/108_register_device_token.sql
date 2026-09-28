-- ═══════════════════════════════════════════════════════════════════════════
-- 108 - register_device_token: claim a push token for the signed-in user
--
-- Plan: docs/superpowers/plans/2026-09-28-android-push-notifications.md
--       (Task 1-3 review fixes, FIX 1)
--
-- WHY. expo_push_token identifies the phone install, not the person —
-- device_tokens.expo_push_token is UNIQUE (034) and device_tokens_update_own
-- only lets the CURRENT owner (auth.uid() = user_id) update their own row
-- (034). On a shared phone: user A logs out offline, or the app's local
-- refresh-token signout (workflows/App.tsx:179) races the network, so A's
-- row survives with A as user_id. User B then signs in and the client tries
-- `upsert(..., { onConflict: 'expo_push_token' })`, which the client only
-- sees as an UPDATE of A's existing row — but B is not A, so
-- device_tokens_update_own's USING (auth.uid() = user_id) filters the row
-- out before B's UPDATE ever matches it, and the client gets an RLS error.
-- Registration then reports 'error' forever for B (never retried, never
-- fixed by B logging in again), while A's push token keeps pointing at a
-- phone A no longer uses, so A's notifications are silently delivered to
-- B's device instead.
--
-- This migration adds a SECURITY DEFINER function that reassigns the row's
-- user_id to whoever is calling right now, bypassing device_tokens_update_own
-- entirely (by design: the token is the phone's, so whoever is signed in on
-- it now owns it). tools/notifications.ts calls this RPC instead of the
-- client-side upsert.
--
-- PASTE ORDER. After 034 (device_tokens must already exist). Independent of
-- 105-107.
--
-- RE-PASTE SAFETY. One CREATE OR REPLACE FUNCTION, one REVOKE, one GRANT. No
-- DDL on any table, policy or trigger. A second paste is a no-op.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.register_device_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'register_device_token: not authenticated';
  END IF;
  IF p_platform NOT IN ('ios', 'android', 'web') THEN
    RAISE EXCEPTION 'register_device_token: invalid platform %', p_platform;
  END IF;
  -- The token identifies the phone install, not the person: whoever is signed
  -- in on the phone now owns it, so a previous user's row is taken over.
  INSERT INTO device_tokens (user_id, expo_push_token, platform, last_seen_at)
  VALUES (auth.uid(), p_token, p_platform, now())
  ON CONFLICT (expo_push_token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        last_seen_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.register_device_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_device_token(text, text) TO authenticated;

-- Close-out: every statement that changes anything is above this line. Hand a
-- reused editor connection back with its default lock timeout.
RESET lock_timeout;

SELECT proname, prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
FROM pg_proc
WHERE proname = 'register_device_token';

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; writes nothing beyond the function itself)
--
-- 1. The grid above already answers the main check:
--    EXPECTED: one row, prosecdef = true, proconfig = {search_path=public},
--    anon_exec = false.
--
-- 2. authenticated can call it, PUBLIC cannot:
--      SELECT has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_exec,
--             has_function_privilege('public', oid, 'EXECUTE') AS public_exec
--      FROM pg_proc WHERE proname = 'register_device_token';
--    EXPECTED: auth_exec = true, public_exec = false.
--
-- 3. Manual takeover check (run as a superuser / service role, adjust the
--    uuids to two real profiles.id and a scratch token; rolls back):
--      BEGIN;
--        INSERT INTO device_tokens (user_id, expo_push_token, platform)
--        VALUES ('<user-a-uuid>', 'ExponentPushToken[selfcheck108]', 'android');
--        SET LOCAL request.jwt.claims = '{"sub":"<user-b-uuid>","role":"authenticated"}';
--        SET LOCAL role authenticated;
--        SELECT register_device_token('ExponentPushToken[selfcheck108]', 'android');
--        SELECT user_id FROM device_tokens WHERE expo_push_token = 'ExponentPushToken[selfcheck108]';
--      ROLLBACK;
--    EXPECTED: the final SELECT shows user_id = '<user-b-uuid>' — the row was
--    reassigned to B despite device_tokens_update_own only allowing A.
-- ═══════════════════════════════════════════════════════════════════════════
