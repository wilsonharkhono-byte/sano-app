-- Creates the requested office users with username-style logins.
-- Username login works through the app by mapping:
--   <username> -> <username>@sano.local
--
-- Credentials after running this script:
--   krisanto  / password123
--   andi      / password123
--   suhartono / password123
--   saiful    / password123
--   reynaldo  / password123
--   julius    / password123
--   arfin     / password123

-- Repair the auth -> profiles sync trigger so future user creation works again.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'supervisor')
  )
  ON CONFLICT (id) DO UPDATE
  SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DO $$
DECLARE
  shared_password_hash TEXT;
  uid_krisanto  UUID := '00000000-0000-0000-0000-000000000011';
  uid_andi      UUID := '00000000-0000-0000-0000-000000000012';
  uid_suhartono UUID := '00000000-0000-0000-0000-000000000013';
  uid_saiful    UUID := '00000000-0000-0000-0000-000000000014';
  uid_reynaldo  UUID := '00000000-0000-0000-0000-000000000015';
  uid_julius    UUID := '00000000-0000-0000-0000-000000000016';
  uid_arfin     UUID := '00000000-0000-0000-0000-000000000017';
BEGIN
  SELECT encrypted_password
  INTO shared_password_hash
  FROM auth.users
  WHERE email = 'supervisor@sano.test'
  LIMIT 1;

  IF shared_password_hash IS NULL THEN
    shared_password_hash := crypt('password123', gen_salt('bf'));
  END IF;

  DELETE FROM auth.users
  WHERE email IN (
    'krisanto@sano.local',
    'andi@sano.local',
    'suhartono@sano.local',
    'saiful@sano.local',
    'reynaldo@sano.local',
    'julius@sano.local',
    'arfin@sano.local'
  )
  AND id NOT IN (
    uid_krisanto,
    uid_andi,
    uid_suhartono,
    uid_saiful,
    uid_reynaldo,
    uid_julius,
    uid_arfin
  );

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  )
  VALUES
    (
      '00000000-0000-0000-0000-000000000000',
      uid_krisanto,
      'authenticated',
      'authenticated',
      'krisanto@sano.local',
      shared_password_hash,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Krisanto","username":"krisanto","role":"supervisor"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      uid_andi,
      'authenticated',
      'authenticated',
      'andi@sano.local',
      shared_password_hash,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Andi","username":"andi","role":"supervisor"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      uid_suhartono,
      'authenticated',
      'authenticated',
      'suhartono@sano.local',
      shared_password_hash,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Suhartono","username":"suhartono","role":"estimator"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      uid_saiful,
      'authenticated',
      'authenticated',
      'saiful@sano.local',
      shared_password_hash,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Saiful","username":"saiful","role":"estimator"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      uid_reynaldo,
      'authenticated',
      'authenticated',
      'reynaldo@sano.local',
      shared_password_hash,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Reynaldo","username":"reynaldo","role":"estimator"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      uid_julius,
      'authenticated',
      'authenticated',
      'julius@sano.local',
      shared_password_hash,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Julius","username":"julius","role":"estimator"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      uid_arfin,
      'authenticated',
      'authenticated',
      'arfin@sano.local',
      shared_password_hash,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Arfin","username":"arfin","role":"admin"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = EXCLUDED.email_confirmed_at,
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = now();

  INSERT INTO public.profiles (id, full_name, phone, role)
  VALUES
    (uid_krisanto,  'Krisanto',  NULL, 'supervisor'),
    (uid_andi,      'Andi',      NULL, 'supervisor'),
    (uid_suhartono, 'Suhartono', NULL, 'estimator'),
    (uid_saiful,    'Saiful',    NULL, 'estimator'),
    (uid_reynaldo,  'Reynaldo',  NULL, 'estimator'),
    (uid_julius,    'Julius',    NULL, 'estimator'),
    (uid_arfin,     'Arfin',     NULL, 'admin')
  ON CONFLICT (id) DO UPDATE
  SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role;
END $$;
