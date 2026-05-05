/**
 * Integration test harness for server-side Gate 1 enforcement.
 * Loads .env, builds a service-role Supabase client, exposes fixture builders.
 *
 * IMPORTANT: This client BYPASSES RLS. Run only against test/staging projects.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '../../.env'));

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY for integration tests. ' +
    'Add both to .env before running serverGateEnforcement tests.',
  );
}

export const adminClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_PREFIX = '__SGE_TEST__';

/** Generates a uniquely-prefixed name so cleanup can find all rows we created. */
export function testName(label: string): string {
  return `${TEST_PREFIX}${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface TestProject {
  id: string;
  name: string;
  ownerProfileId: string;
}

/**
 * Creates a project + an auth user (the trigger from migration 027 populates
 * the profiles row automatically). Returns the project id and profile id.
 */
export async function createTestProject(): Promise<TestProject> {
  // Auth user → profile (via handle_new_user trigger in migration 027).
  const email = `${testName('user').toLowerCase()}@example.com`;
  const { data: authResult, error: authErr } = await adminClient.auth.admin.createUser({
    email,
    password: `Test_${Math.random().toString(36).slice(2)}_!1`,
    email_confirm: true,
    user_metadata: { full_name: testName('owner'), role: 'principal' },
  });
  if (authErr || !authResult.user) throw authErr ?? new Error('auth user create failed');
  const ownerProfileId = authResult.user.id;

  const projectName = testName('project');
  const { data: project, error: projErr } = await adminClient
    .from('projects')
    .insert({ code: testName('PRJ'), name: projectName, status: 'ACTIVE' })
    .select('id')
    .single();
  if (projErr || !project) throw projErr ?? new Error('project insert failed');

  return { id: project.id, name: projectName, ownerProfileId };
}

export interface TestBoqItem {
  id: string;
  projectId: string;
  planned: number;
  installed: number;
}

/** Creates a BoQ item with given planned + installed quantities. */
export async function createTestBoqItem(
  projectId: string,
  opts: { planned: number; installed: number; unit?: string },
): Promise<TestBoqItem> {
  const { data, error } = await adminClient
    .from('boq_items')
    .insert({
      project_id: projectId,
      code: testName('boq'),
      label: testName('boq-label'),
      unit: opts.unit ?? 'kg',
      planned: opts.planned,
      installed: opts.installed,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('boq item insert failed');
  return { id: data.id, projectId, planned: opts.planned, installed: opts.installed };
}

export interface TestMaterial {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  unit: string;
}

/** Creates a material_catalog row. */
export async function createTestMaterial(opts: {
  tier: 1 | 2 | 3;
  unit?: string;
}): Promise<TestMaterial> {
  const name = testName('mat');
  const { data, error } = await adminClient
    .from('material_catalog')
    .insert({
      code: testName('mc'),
      name,
      tier: opts.tier,
      unit: opts.unit ?? 'kg',
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('material insert failed');
  return { id: data.id, name, tier: opts.tier, unit: opts.unit ?? 'kg' };
}

/**
 * Publishes an AHS version with one ahs_line per provided material so the
 * Tier 3 spend-cap check has a unit_price to median over. ahs_lines link
 * directly to ahs_version_id and boq_item_id — no intermediate tables.
 *
 * The provided boqItemId becomes the link for every ahs_line.
 */
export async function publishTestAhsVersion(opts: {
  projectId: string;
  boqItemId: string;
  prices: Array<{ materialId: string; unitPrice: number; tier: 1 | 2 | 3; unit?: string }>;
}): Promise<{ ahsVersionId: string }> {
  // Demote any existing current version (matches publishBaselineV2 pattern).
  await adminClient
    .from('ahs_versions')
    .update({ is_current: false })
    .eq('project_id', opts.projectId)
    .eq('is_current', true);

  const { data: version, error: vErr } = await adminClient
    .from('ahs_versions')
    .insert({
      project_id: opts.projectId,
      version: 1,
      is_current: true,
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (vErr || !version) throw vErr ?? new Error('ahs_versions insert failed');

  for (const { materialId, unitPrice, tier, unit } of opts.prices) {
    const { error: lineErr } = await adminClient.from('ahs_lines').insert({
      ahs_version_id: version.id,
      boq_item_id: opts.boqItemId,
      material_id: materialId,
      tier,
      usage_rate: 1,
      unit: unit ?? 'kg',
      unit_price: unitPrice,
      coefficient: 1,
      line_type: 'material',
    });
    if (lineErr) throw lineErr;
  }

  return { ahsVersionId: version.id };
}

/**
 * Builds a Tier 2 envelope using project_material_master_lines (the actual
 * source the v_material_envelopes view aggregates from). Creates a master
 * row tied to a fresh ahs_version, then a master_line that contributes
 * `totalPlanned` to the envelope for `materialId`.
 */
export async function buildTier2Envelope(opts: {
  projectId: string;
  materialId: string;
  boqItemId: string;
  totalPlanned: number;
  unit?: string;
}): Promise<{ masterId: string; ahsVersionId: string }> {
  const { ahsVersionId } = await publishTestAhsVersion({
    projectId: opts.projectId,
    boqItemId: opts.boqItemId,
    prices: [{ materialId: opts.materialId, unitPrice: 100, tier: 2, unit: opts.unit }],
  });

  const { data: master, error: mErr } = await adminClient
    .from('project_material_master')
    .insert({ project_id: opts.projectId, ahs_version_id: ahsVersionId })
    .select('id')
    .single();
  if (mErr || !master) throw mErr ?? new Error('master insert failed');

  const { error: lErr } = await adminClient.from('project_material_master_lines').insert({
    master_id: master.id,
    material_id: opts.materialId,
    boq_item_id: opts.boqItemId,
    planned_quantity: opts.totalPlanned,
    unit: opts.unit ?? 'kg',
  });
  if (lErr) throw lErr;

  return { masterId: master.id, ahsVersionId };
}

/**
 * Inserts a request header + lines + allocations in the order the app uses.
 * Returns the header id so tests can assert on stored values.
 */
export async function submitRequest(opts: {
  projectId: string;
  requesterProfileId: string;
  primaryBoqItemId: string;
  lines: Array<{
    tier: 1 | 2 | 3;
    materialId: string | null;
    customName?: string;
    quantity: number;
    unit: string;
    clientFlag?: string;
    allocations: Array<{
      boqItemId: string | null;
      allocatedQuantity: number;
      basis: 'DIRECT' | 'TIER2_ENVELOPE' | 'GENERAL_STOCK';
    }>;
  }>;
  clientOverallFlag?: string;
}): Promise<{ headerId: string; lineIds: string[] }> {
  const { data: header, error: hErr } = await adminClient
    .from('material_request_headers')
    .insert({
      project_id: opts.projectId,
      boq_item_id: opts.primaryBoqItemId,
      requested_by: opts.requesterProfileId,
      target_date: new Date().toISOString().slice(0, 10),
      urgency: 'NORMAL',
      overall_flag: opts.clientOverallFlag ?? 'OK',
    })
    .select('id')
    .single();
  if (hErr || !header) throw hErr ?? new Error('header insert failed');

  const lineIds: string[] = [];
  for (const line of opts.lines) {
    const { data: createdLine, error: lErr } = await adminClient
      .from('material_request_lines')
      .insert({
        request_header_id: header.id,
        material_id: line.materialId,
        custom_material_name: line.customName ?? null,
        tier: line.tier,
        quantity: line.quantity,
        unit: line.unit,
        line_flag: line.clientFlag ?? 'OK',
      })
      .select('id')
      .single();
    if (lErr || !createdLine) throw lErr ?? new Error('line insert failed');
    lineIds.push(createdLine.id);

    if (line.allocations.length > 0) {
      const rows = line.allocations.map(a => ({
        request_line_id: createdLine.id,
        boq_item_id: a.boqItemId,
        allocated_quantity: a.allocatedQuantity,
        proportion_pct: 100,
        allocation_basis: a.basis,
      }));
      const { error: aErr } = await adminClient
        .from('material_request_line_allocations')
        .insert(rows);
      if (aErr) throw aErr;
    }
  }

  return { headerId: header.id, lineIds };
}

/** Reads stored line_flag, overall_flag, overall_status for assertions. */
export async function readState(headerId: string, lineId?: string): Promise<{
  overallFlag: string;
  overallStatus: string;
  lineFlag: string | null;
}> {
  const { data: h, error: hErr } = await adminClient
    .from('material_request_headers')
    .select('overall_flag, overall_status')
    .eq('id', headerId)
    .single();
  if (hErr || !h) throw hErr ?? new Error('header read failed');

  let lineFlag: string | null = null;
  if (lineId) {
    const { data: l, error: lErr } = await adminClient
      .from('material_request_lines')
      .select('line_flag')
      .eq('id', lineId)
      .single();
    if (lErr || !l) throw lErr ?? new Error('line read failed');
    lineFlag = (l.line_flag ?? null) as string | null;
  }

  return { overallFlag: h.overall_flag as string, overallStatus: h.overall_status as string, lineFlag };
}

/**
 * Deletes every row created with TEST_PREFIX. Call from afterAll.
 * CASCADE on FKs handles allocations + lines + headers via project CASCADE.
 *
 * Auth users must be deleted via the admin API; deleting them cascades to
 * profiles via the FK on profiles.id.
 */
export async function cleanupTestData(): Promise<void> {
  const errors: Error[] = [];

  const { error: projErr } = await adminClient
    .from('projects')
    .delete()
    .like('name', `${TEST_PREFIX}%`);
  if (projErr) errors.push(new Error(`projects delete failed: ${projErr.message}`));

  const { error: matErr } = await adminClient
    .from('material_catalog')
    .delete()
    .like('name', `${TEST_PREFIX}%`);
  if (matErr) errors.push(new Error(`material_catalog delete failed: ${matErr.message}`));

  const perPage = 200;
  const emailPrefix = TEST_PREFIX.toLowerCase();
  let page = 1;
  while (true) {
    const { data, error: listErr } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (listErr) {
      errors.push(new Error(`listUsers page ${page} failed: ${listErr.message}`));
      break;
    }
    const batch = data?.users ?? [];
    for (const u of batch) {
      if (u.email?.startsWith(emailPrefix)) {
        const { error: delErr } = await adminClient.auth.admin.deleteUser(u.id);
        if (delErr) {
          errors.push(new Error(`deleteUser ${u.id} failed: ${delErr.message}`));
        }
      }
    }
    if (batch.length < perPage) break;
    page += 1;
  }

  if (errors.length > 0) {
    throw new Error(
      `cleanupTestData encountered ${errors.length} error(s):\n` +
        errors.map(e => `  - ${e.message}`).join('\n'),
    );
  }
}
