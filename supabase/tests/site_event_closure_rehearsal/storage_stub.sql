-- supabase/tests/site_event_closure_rehearsal/storage_stub.sql
-- The supabase/postgres image has no storage schema (the storage API creates
-- it in a real project). Migration 105's paste precondition and its evidence
-- rule both read storage.objects, so this builds the two tables they need the
-- way production has them: owned by supabase_storage_admin, RLS on, and
-- granted to postgres, service_role and authenticated. It grants nothing
-- beyond that: whether postgres can read past RLS is exactly the question the
-- 105 precondition asks, and this stub must not answer it for the real
-- project. Run as supabase_admin, before any migration, on every run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  owner               UUID,
  public              BOOLEAN DEFAULT false,
  file_size_limit     BIGINT,
  allowed_mime_types  TEXT[],
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id   TEXT REFERENCES storage.buckets(id),
  name        TEXT,
  owner       UUID,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated, service_role;
GRANT ALL ON storage.buckets, storage.objects TO postgres, service_role;
GRANT SELECT ON storage.buckets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
