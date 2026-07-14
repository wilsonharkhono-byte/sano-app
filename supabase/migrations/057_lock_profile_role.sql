-- 057 — Lock profiles.role against self-escalation (Task 0.1, CRITICAL)
--
-- Problem: profiles_self_update (001_core_tables.sql:420) is
--   FOR UPDATE USING (auth.uid() = id) with no WITH CHECK and no column
--   guard. Any authenticated user can PATCH /profiles?id=eq.<self> with
--   role='admin' via PostgREST and inherit is_office_role() everywhere —
--   collapsing every RBAC boundary in the app (Tier-1/Tier-3 server gates,
--   admin/principal-only writes, etc).
--
-- Fix: RLS WITH CHECK can't see the OLD row, so the role-pin can't be
--   expressed as a policy alone. Enforce it with a BEFORE UPDATE OF role
--   trigger instead: reject any change to profiles.role unless the actor's
--   own profile.role is admin/principal. profiles_update_managers (024)
--   remains the intended path for admins/principals changing another
--   user's role; this trigger is the backstop, and it also covers the
--   "own row" case that profiles_self_update already permits at the RLS
--   layer today.
--
-- Two deliberate exceptions to "actor must be admin/principal":
--   1. auth.uid() IS NULL — the Supabase Dashboard SQL editor and the
--      service-role key both run with no JWT, so auth.uid() is NULL, yet
--      triggers (unlike RLS policies) still fire for those connections.
--      supabase/functions/invite-user/index.ts sets the role on a
--      freshly-invited profile via the service-role client (~line 117);
--      it already verifies the caller is admin/principal before touching
--      the Admin API, so re-checking here would be redundant and would
--      also break that flow, plus any Dashboard admin fix-up. NULL actor
--      is let through.
--   2. Defensive NULL guard on the looked-up actor_role — if auth.uid()
--      IS NOT NULL but no profiles row matches it (mid-signup race, or a
--      stale JWT for a deleted profile), `actor_role NOT IN
--      ('admin','principal')` would evaluate to NULL (not TRUE) once
--      actor_role is NULL, and plpgsql treats a NULL IF-condition as
--      false — i.e. it would silently skip the RAISE and ALLOW the
--      change. `actor_role IS NULL OR ...` closes that gap explicitly; a
--      missing profile row must never be treated as an authorized actor.
--
-- Idempotent / re-paste-safe: CREATE OR REPLACE FUNCTION, and
--   DROP TRIGGER IF EXISTS before CREATE TRIGGER. Safe to paste into the
--   Supabase Dashboard SQL editor more than once.

CREATE OR REPLACE FUNCTION enforce_profile_role_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_role TEXT;
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Service-role key / Dashboard SQL editor: no JWT, auth.uid() is NULL.
    -- These are trusted execution contexts — invite-user already checks
    -- the caller's role itself before touching profiles, and the
    -- Dashboard is an operator with direct DB access. Let it through.
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT role INTO actor_role FROM profiles WHERE id = auth.uid();

    -- No matching profile row for this JWT must never fall through to
    -- "allowed" (see exception #2 above) — spelled out explicitly rather
    -- than relying on `NOT IN` alone.
    IF actor_role IS NULL OR actor_role NOT IN ('admin', 'principal') THEN
      RAISE EXCEPTION 'role change not permitted for %', COALESCE(actor_role, 'anon');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_role_immutable_trg ON profiles;
CREATE TRIGGER profiles_role_immutable_trg
  BEFORE UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_profile_role_immutable();
