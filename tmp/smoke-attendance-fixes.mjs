// tmp/smoke-attendance-fixes.mjs
//
// Post-deployment smoke test for migration 069 (attendance/payroll audit
// fixes — see docs/audits/2026-07-11-attendance-payroll-flow-ui-audit.md).
//
// Run AFTER pasting supabase/migrations/081_attendance_payroll_audit_fixes.sql
// into the Supabase Dashboard SQL Editor:
//
//   node tmp/smoke-attendance-fixes.mjs
//
// Safe to run repeatedly: it creates a fully isolated "ZZ SMOKE" test
// environment (2 users, 1 project, 1 harian contract, 4 workers), exercises
// every fix in the FROZEN CONTRACT via authenticated (non-service-role) RPC
// calls, then deletes everything it created in a `finally` block — even on
// failure — and verifies baseline row counts are unchanged.
//
// Exit codes:
//   0 = all tests PASS
//   1 = at least one test FAILed (cleanup still ran)
//   2 = migration 069 is not applied yet (gate failed, nothing was created)

import fs from 'fs';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────
// 0. Env + clients
// ─────────────────────────────────────────────────────────────────────────

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
const ANON_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const svc = createClient(SUPABASE_URL, SERVICE_KEY);
function newAnonClient() {
  return createClient(SUPABASE_URL, ANON_KEY);
}

const runId = crypto.randomBytes(3).toString('hex');
const MANIFEST_PATH = new URL('./smoke-attendance-manifest.json', import.meta.url).pathname;

// ─────────────────────────────────────────────────────────────────────────
// 1. Small helpers
// ─────────────────────────────────────────────────────────────────────────

function genPassword() {
  return 'Zz' + crypto.randomBytes(18).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) + '!9';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Pure day arithmetic on a 'YYYY-MM-DD' string — no timezone conversion.
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const results = { pass: 0, fail: 0, skip: 0 };

function logPass(tag, msg) {
  results.pass++;
  console.log(`[${tag}] PASS: ${msg}`);
}
function logFail(tag, msg) {
  results.fail++;
  console.log(`[${tag}] FAIL: ${msg}`);
}
function logSkip(tag, msg) {
  results.skip++;
  console.log(`[${tag}] SKIPPED: ${msg}`);
}
function logInfo(tag, msg) {
  console.log(`[${tag}] info: ${msg}`);
}

/** Expect the call to succeed. Returns `data` on success, null on failure (and logs FAIL). */
async function expectSuccess(tag, label, promise) {
  const { data, error } = await promise;
  if (error) {
    logFail(tag, `${label} — unexpected error: ${error.message}`);
    return null;
  }
  logPass(tag, `${label} succeeded`);
  return data;
}

/** Expect the call to fail with an error whose message contains `substr`. */
async function expectErrorContaining(tag, label, promise, substr) {
  const { data, error } = await promise;
  if (!error) {
    logFail(tag, `${label} — expected error containing "${substr}" but got success: ${JSON.stringify(data)}`);
    return false;
  }
  if (error.message && error.message.includes(substr)) {
    logPass(tag, `${label} rejected (${substr})`);
    return true;
  }
  logFail(tag, `${label} — got an error but message didn't contain "${substr}": ${error.message}`);
  return false;
}

/** Expect the call to fail with ANY error (message content not asserted — a loud failure is the contract). */
async function expectAnyError(tag, label, promise) {
  const { data, error } = await promise;
  if (!error) {
    logFail(tag, `${label} — expected a loud error but got success: ${JSON.stringify(data)}`);
    return false;
  }
  logPass(tag, `${label} rejected loudly (${error.message})`);
  return true;
}

async function getEntries(client, contractId, date) {
  const { data, error } = await client
    .from('worker_attendance_entries')
    .select('*')
    .eq('contract_id', contractId)
    .eq('attendance_date', date);
  if (error) throw new Error(`getEntries(${date}): ${error.message}`);
  return data ?? [];
}

async function getHeader(client, id) {
  const { data, error } = await client.from('opname_headers').select('*').eq('id', id).single();
  if (error) throw new Error(`getHeader(${id}): ${error.message}`);
  return data;
}

async function getKasbon(client, id) {
  const { data, error } = await client.from('mandor_kasbon').select('*').eq('id', id).single();
  if (error) throw new Error(`getKasbon(${id}): ${error.message}`);
  return data;
}

async function confirmAll(client, contractId, date) {
  const entries = await getEntries(client, contractId, date);
  for (const e of entries) {
    const { error } = await client.rpc('supervisor_confirm_attendance', { p_entry_id: e.id });
    if (error) logInfo('T5/T8', `supervisor_confirm_attendance(${e.id}) on ${date}: ${error.message}`);
  }
  return entries.map((e) => e.id);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Manifest (in-memory, mirrored to disk for post-mortem recovery)
// ─────────────────────────────────────────────────────────────────────────

const manifest = { runId, createdAt: new Date().toISOString(), entities: [] };
function record(entity) {
  manifest.entities.push(entity);
  try {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  } catch {
    // best-effort only
  }
}

// Typed state used by the FK-safe cleanup routine.
const state = {
  supervisorId: null,
  adminId: null,
  supervisorEmail: null,
  adminEmail: null,
  projectId: null,
  contractId: null,
  workers: {}, // key -> { id, rateId|null, name }
  otRulesId: null,
  boqItemId: null,
  contractRateId: null,
  kasbonId: null,
  header1Id: null,
  header2Id: null,
  allocationIds: [],
  attendanceDates: new Set(), // (contractId is fixed) — dates that may have written rows
};

// ─────────────────────────────────────────────────────────────────────────
// 3. GATE — is migration 069 applied?
// ─────────────────────────────────────────────────────────────────────────

async function checkGateApplied() {
  const fnProbe = await svc.rpc('sano_wib_today');
  const colProbe = await svc.from('opname_headers').select('verified_gross_total').limit(1);
  return {
    applied: !fnProbe.error && !colProbe.error,
    fnProbe,
    colProbe,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Cleanup (FK-safe order) — always runs in `finally`
// ─────────────────────────────────────────────────────────────────────────

async function del(table, ids, guard) {
  ids = (ids ?? []).filter(Boolean);
  if (ids.length === 0) {
    console.log(`  ${table}: nothing to delete`);
    return;
  }
  const { data: rows, error: selErr } = await svc.from(table).select('*').in('id', ids);
  if (selErr) {
    console.log(`  ${table}: SELECT error ${selErr.message}`);
    return;
  }
  if (!rows.length) {
    console.log(`  ${table}: 0/${ids.length} present (already gone)`);
    return;
  }
  let targetIds = rows.map((r) => r.id);
  if (guard) {
    const bad = rows.filter((r) => !guard(r));
    if (bad.length) {
      console.log(`  ${table}: GUARD FAILED for ${bad.map((r) => r.id).join(',')} — skipping those, deleting the rest`);
      targetIds = rows.filter(guard).map((r) => r.id);
      if (targetIds.length === 0) return;
    }
  }
  const { error, count } = await svc.from(table).delete({ count: 'exact' }).in('id', targetIds);
  console.log(`  ${table}: deleted ${count ?? '?'} of ${rows.length} present${error ? ` — ERROR ${error.message}` : ''}`);
}

async function cleanup() {
  console.log('\n=== [T9] cleanup ===');

  // 1. attendance entries — delete outright (also removes their FK reference
  //    into opname_headers before we delete the headers below).
  if (state.contractId) {
    const { data: rows } = await svc
      .from('worker_attendance_entries')
      .select('id')
      .eq('contract_id', state.contractId);
    await del('worker_attendance_entries', (rows ?? []).map((r) => r.id));
  }

  // 2. allocations
  await del('harian_cost_allocations', state.allocationIds);

  // 3. defensively unlink kasbon -> header FK (NO ACTION) before header delete
  if (state.kasbonId) {
    const { error } = await svc
      .from('mandor_kasbon')
      .update({ settled_in_opname_id: null })
      .eq('id', state.kasbonId);
    if (error) console.log(`  mandor_kasbon unlink: ERROR ${error.message}`);
    else console.log('  mandor_kasbon: unlinked settled_in_opname_id (pre-header-delete)');
  }

  // 3b. opname headers
  await del('opname_headers', [state.header1Id, state.header2Id]);

  // 4. kasbon rows (now unlinked)
  await del('mandor_kasbon', [state.kasbonId]);

  // 5. rates / rules / workers
  const workerRateIds = Object.values(state.workers).map((w) => w.rateId).filter(Boolean);
  await del('worker_rates', workerRateIds);
  await del('mandor_overtime_rules', [state.otRulesId]);
  const workerIds = Object.values(state.workers).map((w) => w.id);
  await del('mandor_workers', workerIds, (r) => (r.worker_name || '').startsWith('ZZ SMOKE'));

  // 5b. contract rate + boq item fixtures (T8 kasbon-ceiling setup)
  await del('mandor_contract_rates', [state.contractRateId]);
  await del('boq_items', [state.boqItemId], (r) => (r.label || '').startsWith('ZZ SMOKE'));

  // 6. contract
  await del('mandor_contracts', [state.contractId], (r) => (r.mandor_name || '').startsWith('ZZ SMOKE'));

  // 7. assignments
  if (state.projectId) {
    const { data: assigns } = await svc.from('project_assignments').select('id').eq('project_id', state.projectId);
    await del('project_assignments', (assigns ?? []).map((a) => a.id));
  }

  // 8. project
  await del('projects', [state.projectId], (r) => (r.name || '').startsWith('ZZ SMOKE'));

  // 9. profiles
  await del('profiles', [state.supervisorId, state.adminId], (r) => (r.full_name || '').startsWith('ZZ SMOKE'));

  // 10. auth users
  for (const uid of [state.supervisorId, state.adminId].filter(Boolean)) {
    const { error } = await svc.auth.admin.deleteUser(uid);
    console.log(`  auth.users ${uid.slice(0, 8)}…: ${error ? `ERROR ${error.message}` : 'deleted'}`);
  }

  // Final sweep for any 'ZZ SMOKE%' leftovers.
  console.log('\n--- final ZZ SMOKE% sweep ---');
  const { data: zzP } = await svc.from('projects').select('id, name').ilike('name', 'ZZ SMOKE%');
  const { data: zzPr } = await svc.from('profiles').select('id, full_name').ilike('full_name', 'ZZ SMOKE%');
  const { data: zzC } = await svc.from('mandor_contracts').select('id, mandor_name').ilike('mandor_name', 'ZZ SMOKE%');
  const { data: zzW } = await svc.from('mandor_workers').select('id, worker_name').ilike('worker_name', 'ZZ SMOKE%');
  const { data: zzB } = await svc.from('boq_items').select('id, label').ilike('label', 'ZZ SMOKE%');
  console.log(`  projects ZZ SMOKE%: ${zzP?.length ?? '?'}`);
  console.log(`  profiles ZZ SMOKE%: ${zzPr?.length ?? '?'}`);
  console.log(`  mandor_contracts ZZ SMOKE%: ${zzC?.length ?? '?'}`);
  console.log(`  mandor_workers ZZ SMOKE%: ${zzW?.length ?? '?'}`);
  console.log(`  boq_items ZZ SMOKE%: ${zzB?.length ?? '?'}`);
  const sweepClean =
    (zzP?.length ?? 1) === 0 &&
    (zzPr?.length ?? 1) === 0 &&
    (zzC?.length ?? 1) === 0 &&
    (zzW?.length ?? 1) === 0 &&
    (zzB?.length ?? 1) === 0;
  if (sweepClean) logPass('T9', 'final ZZ SMOKE% sweep — 0 leftovers');
  else logFail('T9', 'final ZZ SMOKE% sweep — leftovers remain (see counts above)');

  try {
    fs.unlinkSync(MANIFEST_PATH);
  } catch {
    // fine if already gone
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Main
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== SANO attendance/payroll smoke test (run ${runId}) ===\n`);

  // ---- GATE ----
  const gate = await checkGateApplied();
  console.log('[GATE] sano_wib_today() probe:', gate.fnProbe.error ? `ERROR: ${gate.fnProbe.error.message}` : `OK (${gate.fnProbe.data})`);
  console.log('[GATE] opname_headers.verified_gross_total probe:', gate.colProbe.error ? `ERROR: ${gate.colProbe.error.message}` : 'OK');
  if (!gate.applied) {
    console.log('\nMIGRATION 081 NOT APPLIED — paste supabase/migrations/081_attendance_payroll_audit_fixes.sql into the Dashboard SQL Editor first');
    process.exit(2);
  }
  console.log('[GATE] migration 069 detected as applied — proceeding.\n');

  const wibToday = gate.fnProbe.data;

  // ---- baseline counts (captured BEFORE any creation) ----
  const baselineTables = ['worker_attendance_entries', 'opname_headers', 'mandor_contracts', 'projects'];
  const baseline = {};
  for (const t of baselineTables) {
    const { count } = await svc.from(t).select('*', { count: 'exact', head: true });
    baseline[t] = count;
  }
  console.log('[T9] baseline counts (pre-run):', JSON.stringify(baseline));

  let supAuth = null;
  let admAuth = null;
  let fatal = null;

  try {
    // ═══════════════════════════════════════════════════════════════════
    // T1 — setup
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n=== [T1] setup ===');

    state.supervisorEmail = `zz-smoke-supervisor-${runId}@sano-audit.test`;
    state.adminEmail = `zz-smoke-admin-${runId}@sano-audit.test`;
    const supPassword = genPassword();
    const admPassword = genPassword();

    const { data: supUserRes, error: supUserErr } = await svc.auth.admin.createUser({
      email: state.supervisorEmail,
      password: supPassword,
      email_confirm: true,
      user_metadata: { full_name: 'ZZ SMOKE Supervisor (temporary)' },
    });
    if (supUserErr) throw new Error(`createUser supervisor: ${supUserErr.message}`);
    state.supervisorId = supUserRes.user.id;
    record({ table: 'auth.users', id: state.supervisorId, email: state.supervisorEmail, note: 'role=supervisor' });

    const { data: admUserRes, error: admUserErr } = await svc.auth.admin.createUser({
      email: state.adminEmail,
      password: admPassword,
      email_confirm: true,
      user_metadata: { full_name: 'ZZ SMOKE Admin (temporary)' },
    });
    if (admUserErr) throw new Error(`createUser admin: ${admUserErr.message}`);
    state.adminId = admUserRes.user.id;
    record({ table: 'auth.users', id: state.adminId, email: state.adminEmail, note: 'role=admin' });

    await sleep(600); // let handle_new_user trigger insert the default profile row

    const { error: supProfileErr } = await svc
      .from('profiles')
      .upsert({ id: state.supervisorId, full_name: 'ZZ SMOKE Supervisor (temporary)', role: 'supervisor' }, { onConflict: 'id' });
    if (supProfileErr) throw new Error(`profiles upsert supervisor: ${supProfileErr.message}`);
    record({ table: 'profiles', id: state.supervisorId, note: 'role=supervisor' });

    const { error: admProfileErr } = await svc
      .from('profiles')
      .upsert({ id: state.adminId, full_name: 'ZZ SMOKE Admin (temporary)', role: 'admin' }, { onConflict: 'id' });
    if (admProfileErr) throw new Error(`profiles upsert admin: ${admProfileErr.message}`);
    record({ table: 'profiles', id: state.adminId, note: 'role=admin' });

    const { data: project, error: projErr } = await svc
      .from('projects')
      .insert({
        code: `ZZ-SMOKE-${runId}`,
        name: `ZZ SMOKE ATTENDANCE TEST (${runId})`,
        location: 'ZZ Smoke — temporary',
        client_name: 'ZZ Smoke Client',
        status: 'ACTIVE',
      })
      .select()
      .single();
    if (projErr) throw new Error(`projects insert: ${projErr.message}`);
    state.projectId = project.id;
    record({ table: 'projects', id: state.projectId, note: project.name });

    for (const uid of [state.supervisorId, state.adminId]) {
      const { data: a, error: aErr } = await svc
        .from('project_assignments')
        .insert({ project_id: state.projectId, user_id: uid })
        .select()
        .single();
      if (aErr) throw new Error(`project_assignments insert (${uid}): ${aErr.message}`);
      record({ table: 'project_assignments', id: a.id, note: uid });
    }

    const { data: contract, error: contractErr } = await svc
      .from('mandor_contracts')
      .insert({
        project_id: state.projectId,
        mandor_name: `ZZ SMOKE Mandor (${runId})`,
        trade_categories: ['lainnya'],
        retention_pct: 10,
        notes: 'ZZ SMOKE temporary contract — delete after smoke test',
        payment_mode: 'harian',
        daily_rate: 150000,
        created_by: state.adminId,
      })
      .select()
      .single();
    if (contractErr) throw new Error(`mandor_contracts insert: ${contractErr.message}`);
    state.contractId = contract.id;
    record({ table: 'mandor_contracts', id: state.contractId, note: contract.mandor_name });

    const workerDefs = [
      { key: 'w150', name: `ZZ SMOKE Worker 1 (${runId})`, skill: 'tukang', rate: 150000 },
      { key: 'w120', name: `ZZ SMOKE Worker 2 (${runId})`, skill: 'kenek', rate: 120000 },
      { key: 'w130', name: `ZZ SMOKE Worker 3 (${runId})`, skill: 'tukang', rate: 130000 },
      { key: 'wNoRate', name: `ZZ SMOKE Worker 4 no-rate (${runId})`, skill: 'lainnya', rate: null },
    ];
    for (const w of workerDefs) {
      const { data: worker, error: workerErr } = await svc
        .from('mandor_workers')
        .insert({
          contract_id: state.contractId,
          project_id: state.projectId,
          worker_name: w.name,
          skill_level: w.skill,
          is_active: true,
          created_by: state.adminId,
        })
        .select()
        .single();
      if (workerErr) throw new Error(`mandor_workers insert (${w.name}): ${workerErr.message}`);
      state.workers[w.key] = { id: worker.id, rateId: null, name: w.name };
      record({ table: 'mandor_workers', id: worker.id, note: w.name });

      if (w.rate != null) {
        const { data: rate, error: rateErr } = await svc
          .from('worker_rates')
          .insert({
            worker_id: worker.id,
            contract_id: state.contractId,
            daily_rate: w.rate,
            effective_from: addDays(wibToday, -30),
            set_by: state.adminId,
          })
          .select()
          .single();
        if (rateErr) throw new Error(`worker_rates insert (${w.name}): ${rateErr.message}`);
        state.workers[w.key].rateId = rate.id;
        record({ table: 'worker_rates', id: rate.id, note: `${w.name} rate=${w.rate}` });
      }
    }

    const { data: otRules, error: otErr } = await svc
      .from('mandor_overtime_rules')
      .insert({
        contract_id: state.contractId,
        normal_hours: 7,
        tier1_threshold_hours: 7,
        tier1_hourly_rate: 20000,
        tier2_threshold_hours: 10,
        tier2_hourly_rate: 30000,
        effective_from: addDays(wibToday, -30),
        created_by: state.adminId,
      })
      .select()
      .single();
    if (otErr) throw new Error(`mandor_overtime_rules insert: ${otErr.message}`);
    state.otRulesId = otRules.id;
    record({ table: 'mandor_overtime_rules', id: state.otRulesId, note: 'contract-level OT rules 7/10/20k/30k' });

    // Fixture for T8's kasbon 30%-of-contract-value ceiling check.
    const { data: boqItem, error: boqErr } = await svc
      .from('boq_items')
      .insert({
        project_id: state.projectId,
        code: `ZZ-SMOKE-BOQ-${runId}`,
        label: `ZZ SMOKE test item (${runId})`,
        unit: 'ls',
        planned: 1,
      })
      .select()
      .single();
    if (boqErr) throw new Error(`boq_items insert: ${boqErr.message}`);
    state.boqItemId = boqItem.id;
    record({ table: 'boq_items', id: state.boqItemId, note: boqItem.label });

    const { data: contractRate, error: crErr } = await svc
      .from('mandor_contract_rates')
      .insert({
        contract_id: state.contractId,
        boq_item_id: state.boqItemId,
        contracted_rate: 2000000,
        boq_labor_rate: 0,
        unit: 'ls',
      })
      .select()
      .single();
    if (crErr) throw new Error(`mandor_contract_rates insert: ${crErr.message}`);
    state.contractRateId = contractRate.id;
    record({ table: 'mandor_contract_rates', id: state.contractRateId, note: 'contract_value=2,000,000 for kasbon 30% ceiling' });

    // Sign in via ANON key as each user — everything below runs authenticated, not service role.
    supAuth = newAnonClient();
    const { error: supSignInErr } = await supAuth.auth.signInWithPassword({ email: state.supervisorEmail, password: supPassword });
    if (supSignInErr) throw new Error(`sign-in supervisor: ${supSignInErr.message}`);

    admAuth = newAnonClient();
    const { error: admSignInErr } = await admAuth.auth.signInWithPassword({ email: state.adminEmail, password: admPassword });
    if (admSignInErr) throw new Error(`sign-in admin: ${admSignInErr.message}`);

    logPass('T1', `setup complete — project ${state.projectId}, contract ${state.contractId}, 4 workers, both users signed in`);

    // ═══════════════════════════════════════════════════════════════════
    // T2 — recording window
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n=== [T2] window ===');
    const crewEntries = ['w150', 'w120', 'w130'].map((k) => ({
      worker_id: state.workers[k].id,
      is_present: true,
      overtime_hours: 0,
    }));

    const dateOk5 = addDays(wibToday, -5);
    const dateBad20 = addDays(wibToday, -20);
    const dateOk3 = addDays(wibToday, 3);
    const dateBad10 = addDays(wibToday, 10);

    await expectSuccess(
      'T2',
      `batch-save ${dateOk5} (5 days ago)`,
      supAuth.rpc('record_worker_attendance_batch', { p_contract_id: state.contractId, p_attendance_date: dateOk5, p_entries: crewEntries }),
    );
    await expectErrorContaining(
      'T2',
      `batch-save ${dateBad20} (20 days ago)`,
      supAuth.rpc('record_worker_attendance_batch', { p_contract_id: state.contractId, p_attendance_date: dateBad20, p_entries: crewEntries }),
      'jendela pencatatan',
    );
    await expectSuccess(
      'T2',
      `batch-save ${dateOk3} (+3 days)`,
      supAuth.rpc('record_worker_attendance_batch', { p_contract_id: state.contractId, p_attendance_date: dateOk3, p_entries: crewEntries }),
    );
    await expectErrorContaining(
      'T2',
      `batch-save ${dateBad10} (+10 days)`,
      supAuth.rpc('record_worker_attendance_batch', { p_contract_id: state.contractId, p_attendance_date: dateBad10, p_entries: crewEntries }),
      'jendela pencatatan',
    );

    // ═══════════════════════════════════════════════════════════════════
    // T3 — loud rate failure + atomicity
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n=== [T3] loud rate failure (atomic) ===');
    const dateT3 = addDays(wibToday, -4);
    const entriesWithNoRateWorker = [
      ...crewEntries,
      { worker_id: state.workers.wNoRate.id, is_present: true, overtime_hours: 0 },
    ];
    await expectAnyError(
      'T3',
      `batch-save ${dateT3} including worker with no active rate`,
      supAuth.rpc('record_worker_attendance_batch', { p_contract_id: state.contractId, p_attendance_date: dateT3, p_entries: entriesWithNoRateWorker }),
    );
    const rowsAfterFailure = await getEntries(supAuth, state.contractId, dateT3);
    if (rowsAfterFailure.length === 0) {
      logPass('T3', `atomicity — 0 rows written for ${dateT3} after the failed batch (no partial insert)`);
    } else {
      logFail('T3', `atomicity — expected 0 rows for ${dateT3}, found ${rowsAfterFailure.length} (partial insert leaked)`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // T4 — pay math (OT tiers)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n=== [T4] pay math ===');
    const dateT4 = addDays(wibToday, -3);
    const t4Entries = [
      { worker_id: state.workers.w150.id, is_present: true, overtime_hours: 5 },
      { worker_id: state.workers.w120.id, is_present: true, overtime_hours: 0 },
      { worker_id: state.workers.w130.id, is_present: true, overtime_hours: 0 },
    ];
    await expectSuccess(
      'T4',
      `batch-save ${dateT4} with OT=5 for the 150k worker`,
      supAuth.rpc('record_worker_attendance_batch', { p_contract_id: state.contractId, p_attendance_date: dateT4, p_entries: t4Entries }),
    );
    const t4Rows = await getEntries(supAuth, state.contractId, dateT4);
    const t4Row = t4Rows.find((r) => r.worker_id === state.workers.w150.id);
    if (!t4Row) {
      logFail('T4', `could not find the 150k worker's row for ${dateT4}`);
    } else {
      const ot = Number(t4Row.overtime_pay);
      const total = Number(t4Row.day_total);
      if (ot === 120000) logPass('T4', `overtime_pay = 120000 (3×20k + 2×30k) — got ${ot}`);
      else logFail('T4', `overtime_pay expected 120000, got ${ot}`);
      if (total === 270000) logPass('T4', `day_total = 270000 — got ${total}`);
      else logFail('T4', `day_total expected 270000, got ${total}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // T5 — verify-freeze
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n=== [T5] verify-freeze ===');
    const weekAStart = addDays(wibToday, -13);
    const weekAEnd = addDays(weekAStart, 5);
    const weekATuesday = addDays(weekAStart, 1);

    await expectSuccess(
      'T5',
      `batch-save week-A Monday (${weekAStart}) for 3 rated workers`,
      supAuth.rpc('record_worker_attendance_batch', { p_contract_id: state.contractId, p_attendance_date: weekAStart, p_entries: crewEntries }),
    );
    await expectSuccess(
      'T5',
      `confirm_weekly_attendance(week_start=${weekAStart})`,
      supAuth.rpc('confirm_weekly_attendance', { p_contract_id: state.contractId, p_week_start: weekAStart }),
    );
    const weekAMondayIds = await confirmAll(supAuth, state.contractId, weekAStart);
    logInfo('T5', `confirmed ${weekAMondayIds.length} Monday entries to CONFIRMED`);

    const header1 = await expectSuccess(
      'T5',
      'create_harian_opname (week 1)',
      admAuth.rpc('create_harian_opname', {
        p_contract_id: state.contractId,
        p_week_number: 1,
        p_opname_date: weekAStart,
        p_week_start: weekAStart,
        p_week_end: weekAEnd,
      }),
    );
    if (header1) {
      state.header1Id = header1.id;
      await expectSuccess('T5', 'submit_opname (week 1)', admAuth.rpc('submit_opname', { p_header_id: state.header1Id }));

      const { data: alloc1, error: alloc1Err } = await admAuth
        .from('harian_cost_allocations')
        .insert({
          header_id: state.header1Id,
          project_id: state.projectId,
          contract_id: state.contractId,
          allocation_scope: 'general_support',
          allocation_pct: 100,
          created_by: state.adminId,
        })
        .select()
        .single();
      if (alloc1Err) logFail('T5', `harian_cost_allocations insert (week 1): ${alloc1Err.message}`);
      else {
        state.allocationIds.push(alloc1.id);
        logPass('T5', 'harian_cost_allocations inserted at 100% (week 1)');
      }

      await expectSuccess('T5', 'verify_opname (week 1, first pass)', admAuth.rpc('verify_opname', { p_header_id: state.header1Id, p_notes: 'ZZ SMOKE verify' }));
      let h1 = await getHeader(admAuth, state.header1Id);
      if (Number(h1.verified_gross_total) === Number(h1.gross_total)) {
        logPass('T5', `verified_gross_total (${h1.verified_gross_total}) matches gross_total (${h1.gross_total}) after first verify`);
      } else {
        logFail('T5', `verified_gross_total (${h1.verified_gross_total}) != gross_total (${h1.gross_total}) after first verify`);
      }

      // Straggler: one more worker-day inside the week, added AFTER verify.
      await expectSuccess(
        'T5',
        `batch-save straggler week-A Tuesday (${weekATuesday}) for 130k worker`,
        supAuth.rpc('record_worker_attendance_batch', {
          p_contract_id: state.contractId,
          p_attendance_date: weekATuesday,
          p_entries: [{ worker_id: state.workers.w130.id, is_present: true, overtime_hours: 0 }],
        }),
      );
      await expectSuccess(
        'T5',
        `confirm_weekly_attendance (straggler pickup, week_start=${weekAStart})`,
        supAuth.rpc('confirm_weekly_attendance', { p_contract_id: state.contractId, p_week_start: weekAStart }),
      );
      await confirmAll(supAuth, state.contractId, weekATuesday);

      await expectErrorContaining(
        'T5',
        'approve_opname (week 1) after straggler changed gross',
        admAuth.rpc('approve_opname', { p_header_id: state.header1Id }),
        'verifikasi ulang',
      );

      await expectSuccess('T5', 're-verify_opname (week 1) after straggler', admAuth.rpc('verify_opname', { p_header_id: state.header1Id, p_notes: 'ZZ SMOKE re-verify' }));
      h1 = await getHeader(admAuth, state.header1Id);
      if (Number(h1.verified_gross_total) === Number(h1.gross_total)) {
        logPass('T5', `verified_gross_total (${h1.verified_gross_total}) matches gross_total (${h1.gross_total}) after re-verify`);
      } else {
        logFail('T5', `verified_gross_total (${h1.verified_gross_total}) != gross_total (${h1.gross_total}) after re-verify`);
      }

      await expectSuccess('T5', 'approve_opname (week 1) after re-verify', admAuth.rpc('approve_opname', { p_header_id: state.header1Id }));
      h1 = await getHeader(admAuth, state.header1Id);
      if (h1.status === 'APPROVED') logPass('T5', 'header status = APPROVED');
      else logFail('T5', `header status expected APPROVED, got ${h1.status}`);

      const weekAAllRows = [...(await getEntries(admAuth, state.contractId, weekAStart)), ...(await getEntries(admAuth, state.contractId, weekATuesday))];
      const allSettled = weekAAllRows.length > 0 && weekAAllRows.every((r) => r.status === 'SETTLED' && r.settled_in_opname_id === state.header1Id);
      if (allSettled) logPass('T5', `all ${weekAAllRows.length} week-A entries SETTLED with settled_in_opname_id=${state.header1Id}`);
      else logFail('T5', `not all week-A entries SETTLED correctly: ${JSON.stringify(weekAAllRows.map((r) => ({ id: r.id, status: r.status, settled_in_opname_id: r.settled_in_opname_id })))}`);

      // ═════════════════════════════════════════════════════════════════
      // T6 — recompute gate
      // ═════════════════════════════════════════════════════════════════
      console.log('\n=== [T6] recompute gate ===');
      await expectErrorContaining(
        'T6',
        'recompute_harian_opname on APPROVED header',
        supAuth.rpc('recompute_harian_opname', { p_header_id: state.header1Id }),
        'tidak bisa dihitung ulang',
      );

      // ═════════════════════════════════════════════════════════════════
      // T7 — void
      // ═════════════════════════════════════════════════════════════════
      console.log('\n=== [T7] void ===');
      await expectAnyError('T7', 'void_opname with empty note', admAuth.rpc('void_opname', { p_header_id: state.header1Id, p_note: '' }));
      await expectAnyError('T7', 'void_opname as SUPERVISOR (role rejection)', supAuth.rpc('void_opname', { p_header_id: state.header1Id, p_note: 'ZZ SMOKE void test' }));
      await expectSuccess('T7', 'void_opname as admin with note', admAuth.rpc('void_opname', { p_header_id: state.header1Id, p_note: 'ZZ SMOKE void test' }));

      h1 = await getHeader(admAuth, state.header1Id);
      if (h1.status === 'VOID') logPass('T7', 'header status = VOID');
      else logFail('T7', `header status expected VOID, got ${h1.status}`);

      const weekAAfterVoid = [...(await getEntries(admAuth, state.contractId, weekAStart)), ...(await getEntries(admAuth, state.contractId, weekATuesday))];
      const allReverted = weekAAfterVoid.length > 0 && weekAAfterVoid.every((r) => r.status === 'CONFIRMED' && r.settled_in_opname_id === null);
      if (allReverted) logPass('T7', `all ${weekAAfterVoid.length} week-A entries back to CONFIRMED with settled_in_opname_id NULL`);
      else logFail('T7', `not all week-A entries reverted correctly: ${JSON.stringify(weekAAfterVoid.map((r) => ({ id: r.id, status: r.status, settled_in_opname_id: r.settled_in_opname_id })))}`);
    } else {
      logFail('T5', 'skipping T5 remainder + T6 + T7 — create_harian_opname (week 1) did not return a header');
    }

    // ═══════════════════════════════════════════════════════════════════
    // T8 — kasbon (best-effort)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n=== [T8] kasbon ===');
    const kasbon = await expectSuccess(
      'T8',
      'request_kasbon(100000)',
      supAuth.rpc('request_kasbon', { p_contract_id: state.contractId, p_amount: 100000, p_reason: 'ZZ SMOKE test advance' }),
    );
    if (kasbon) {
      state.kasbonId = kasbon.id;
      await expectSuccess('T8', 'approve_kasbon', admAuth.rpc('approve_kasbon', { p_kasbon_id: state.kasbonId }));

      const weekBStart = addDays(wibToday, 1);
      const weekBEnd = addDays(weekBStart, 5);

      await expectSuccess(
        'T8',
        `batch-save week-B Monday (${weekBStart}) for 150k worker`,
        supAuth.rpc('record_worker_attendance_batch', {
          p_contract_id: state.contractId,
          p_attendance_date: weekBStart,
          p_entries: [{ worker_id: state.workers.w150.id, is_present: true, overtime_hours: 0 }],
        }),
      );
      await expectSuccess(
        'T8',
        `confirm_weekly_attendance (week_start=${weekBStart})`,
        supAuth.rpc('confirm_weekly_attendance', { p_contract_id: state.contractId, p_week_start: weekBStart }),
      );
      await confirmAll(supAuth, state.contractId, weekBStart);

      const header2 = await expectSuccess(
        'T8',
        'create_harian_opname (week 2)',
        admAuth.rpc('create_harian_opname', {
          p_contract_id: state.contractId,
          p_week_number: 2,
          p_opname_date: weekBStart,
          p_week_start: weekBStart,
          p_week_end: weekBEnd,
        }),
      );
      if (header2) {
        state.header2Id = header2.id;
        await expectSuccess('T8', 'submit_opname (week 2)', admAuth.rpc('submit_opname', { p_header_id: state.header2Id }));

        const { data: alloc2, error: alloc2Err } = await admAuth
          .from('harian_cost_allocations')
          .insert({
            header_id: state.header2Id,
            project_id: state.projectId,
            contract_id: state.contractId,
            allocation_scope: 'general_support',
            allocation_pct: 100,
            created_by: state.adminId,
          })
          .select()
          .single();
        if (alloc2Err) logFail('T8', `harian_cost_allocations insert (week 2): ${alloc2Err.message}`);
        else {
          state.allocationIds.push(alloc2.id);
          logPass('T8', 'harian_cost_allocations inserted at 100% (week 2)');
        }

        await expectSuccess('T8', 'verify_opname (week 2)', admAuth.rpc('verify_opname', { p_header_id: state.header2Id, p_notes: 'ZZ SMOKE verify wk2' }));
        await expectSuccess('T8', 'approve_opname (week 2, no explicit kasbon)', admAuth.rpc('approve_opname', { p_header_id: state.header2Id }));

        const h2 = await getHeader(admAuth, state.header2Id);
        if (Number(h2.kasbon) === 100000) logPass('T8', `header.kasbon = 100000 (auto-settled) — got ${h2.kasbon}`);
        else logFail('T8', `header.kasbon expected 100000, got ${h2.kasbon}`);

        const kasbonAfter = await getKasbon(admAuth, state.kasbonId);
        if (kasbonAfter.status === 'SETTLED' && kasbonAfter.settled_in_opname_id === state.header2Id) {
          logPass('T8', 'mandor_kasbon row SETTLED with settled_in_opname_id = week-2 header');
        } else {
          logFail('T8', `mandor_kasbon row not settled as expected: status=${kasbonAfter.status} settled_in_opname_id=${kasbonAfter.settled_in_opname_id}`);
        }
      } else {
        logFail('T8', 'skipping rest of T8 — create_harian_opname (week 2) did not return a header');
      }
    } else {
      logFail('T8', 'skipping rest of T8 — request_kasbon did not return a row');
    }

    logSkip(
      'T8',
      'advance-larger-than-net partial-carryover scenario — the frozen contract and migration 014 mandor_kasbon schema (REQUESTED/APPROVED/SETTLED, no partial-remaining column) give no way to construct or verify a carryover without guessing 068\'s new schema. Skipped rather than guessed.',
    );
  } catch (e) {
    fatal = e;
    console.error('\nFATAL (unexpected exception, not a designed test case):', e?.stack || e);
    results.fail++;
  } finally {
    if (supAuth) await supAuth.auth.signOut().catch(() => {});
    if (admAuth) await admAuth.auth.signOut().catch(() => {});
    await cleanup();

    console.log('\n=== [T9] baseline verification ===');
    let baselineOk = true;
    for (const t of baselineTables) {
      const { count } = await svc.from(t).select('*', { count: 'exact', head: true });
      const ok = count === baseline[t];
      if (!ok) baselineOk = false;
      console.log(`  ${t}: before=${baseline[t]} after=${count} ${ok ? 'OK' : 'MISMATCH'}`);
    }
    if (baselineOk) logPass('T9', 'baseline counts unchanged after cleanup');
    else logFail('T9', 'baseline counts changed — cleanup left residue');
  }

  console.log(`\n=== SUMMARY === pass=${results.pass} fail=${results.fail} skipped=${results.skip}`);
  if (fatal || results.fail > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL (outside main try/catch):', e?.stack || e);
  process.exit(1);
});
