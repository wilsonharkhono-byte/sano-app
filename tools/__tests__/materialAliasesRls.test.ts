/**
 * Regression guard for migration 040.
 *
 * publishBaselineV2 runs as the logged-in user and loads the alias map via
 *   material_aliases.select('alias, material_catalog!inner(code)')
 * If material_aliases is not readable under RLS for authenticated users, that
 * query returns 0 rows, the alias map is empty, and every alias-dependent
 * breakdown material publishes with material_id = NULL (work-group gate shows
 * "no baseline", Material Balance shows breakdown names). This test fails until
 * migration 040 grants authenticated SELECT on material_aliases.
 */
import { adminClient } from './_serverGateHarness';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

jest.setTimeout(40000);

it('an authenticated user can read material_aliases with the catalog-code embed (publish needs this)', async () => {
  const email = `test_aliasrls_${Date.now()}@example.com`;
  const password = `Pw_${Date.now()}_!1`;
  const { data: u, error: createErr } = await adminClient.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { role: 'estimator' },
  });
  if (createErr || !u?.user) throw createErr ?? new Error('create user failed');

  try {
    const authed = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { error: signInErr } = await authed.auth.signInWithPassword({ email, password });
    expect(signInErr).toBeNull();

    // The exact query publishBaselineV2 uses to build the alias map.
    const { data, error } = await authed
      .from('material_aliases')
      .select('alias, material_catalog!inner(code)')
      .limit(20);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0); // 0 rows here = the bug migration 040 fixes
    const withCode = (data ?? []).filter(a => (a as unknown as { material_catalog?: { code?: string } }).material_catalog?.code).length;
    expect(withCode).toBeGreaterThan(0);
  } finally {
    await adminClient.auth.admin.deleteUser(u.user.id);
  }
});
