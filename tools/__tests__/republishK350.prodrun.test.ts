/**
 * LIVE re-publish harness — Citraland K2-7 / Bukit Darmo D-18, K-350 concrete.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS SUITE MUTATES THE LIVE DATABASE. It skips by default and runs only  ║
 * ║  with ALLOW_PROD_DB_TESTS=1 (the _serverGateHarness opt-in knob).         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHAT IT DOES, in the app's own order (BaselineScreen.handlePublish):
 *   1. Pre-flight (read-only): the parser's concrete name "Readymix K-350" must
 *      already resolve to CON-RM30 — i.e. migration 091's aliases are applied.
 *      publishBaselineV2 reads material_aliases at publish time, so an alias
 *      added afterwards is too late. Fails loudly with the fix command.
 *   2. Uploads the patched workbook to Storage and opens a NEW v2 import
 *      session (createImportSession), exactly as the upload screen does.
 *   3. parseAndStageWorkbook → the simplified-input parser → staging rows.
 *      Refuses to continue if any row came back needs_review + PENDING (the
 *      app's own pre-publish gate — a human reviews those in the UI).
 *   4. Rebuilds the REAL revision context: current master, envelope activity,
 *      the new-material activity probe, computePlanRevisionDiff, and the
 *      Indonesian notify sentence — the same four calls BaselineScreen makes.
 *   5. publishBaselineV2(sessionId, projectId, { revisionContext }).
 *   6. Prints warnings + the new master id, then asserts the world afterwards.
 *
 * ── ON diffLines AND THE TEAM NOTIFICATION ────────────────────────────────
 * computePlanRevisionDiff emits an individual line only for a material that has
 * ACTIVITY (a non-rejected request, a non-cancelled PO, or a receipt) AND
 * changed. Verified on 2026-08-25: CON-RM30 has ZERO activity in both projects
 * and every other material's planned total is unchanged, so the honest diff is
 * EMPTY and publish's own `if (diffLines.length > 0)` fan-out will not fire.
 *
 * We do NOT manufacture a diff line to force it. Fabricating plan_revision_lines
 * (planned_before/after, ordered_at_time…) would write invented numbers into an
 * append-only audit trail — precisely what CLAUDE.md §1.1 forbids. Instead, when
 * the diff is empty and NOTIFY_TEAMS is on (default), the harness calls
 * notify_plan_revised ITSELF, after a successful publish, with the REAL revision
 * id and a sentence built from the real figures. The teams get told; the audit
 * trail still says exactly what happened.
 *
 * ── REQUIRED ENV ──────────────────────────────────────────────────────────
 *   ALLOW_PROD_DB_TESTS=1   opt-in guard (without it the suite skips)
 *   PROJECT_ID=<uuid>       the project to re-publish
 *   WORKBOOK=<path>         patched .xlsx, relative to the repo root or absolute
 *   EXPECTED_BETON=<m3>     the beton total you expect, e.g. 820.51 (2-dp)
 * ── OPTIONAL ENV ──────────────────────────────────────────────────────────
 *   BEFORE_DUMP=<path>      before-state JSON (default: looked up from
 *                           tmp/b4-republish/_index.json by PROJECT_ID)
 *   UPLOADER_PROFILE_ID=<uuid>  who the import session is attributed to
 *                           (default: the uploader of the project's most recent
 *                           PUBLISHED session — the same estimator as last time)
 *   NOTIFY_TEAMS=0          suppress the explicit PLAN_REVISED fan-out
 *
 * Run:
 *   ALLOW_PROD_DB_TESTS=1 PROJECT_ID=… WORKBOOK=… EXPECTED_BETON=… \
 *     npx jest --runTestsByPath tools/__tests__/republishK350.prodrun.test.ts
 */

// Service-role client injected in place of the app's react-native Supabase
// module — the only way publishBaselineV2 is importable outside the app.
// (Copied from publishBreakdownTrial.test.ts.)
jest.mock('../supabase', () => {
  const { createClient } = require('@supabase/supabase-js');
  const fs = require('node:fs');
  // .env is absent in CI — this mock factory runs at import time, BEFORE the
  // ALLOW_PROD_DB_TESTS skip guard, so a hard readFileSync would fail the
  // whole suite there instead of letting it skip.
  if (fs.existsSync('.env')) {
    for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    // No credentials (CI): the suite is about to skip on the ALLOW_PROD_DB_TESTS
    // guard anyway — hand back a stub that only throws if something touches it.
    return {
      supabase: new Proxy({}, {
        get() { throw new Error('republishK350: no Supabase credentials — suite should have skipped'); },
      }),
    };
  }
  return { supabase: createClient(url, key, { auth: { persistSession: false } }) };
});

import fs from 'node:fs';
import path from 'node:path';
import { createImportSession, parseAndStageWorkbook, updateImportStatus } from '../baseline';
import {
  publishBaselineV2,
  previewNewMasterTotals,
  loadCatalogAndAliases,
  resolveCatalogId,
  type RevisionContext,
} from '../publishBaselineV2';
import {
  computePlanRevisionDiff,
  type MaterialActivity,
  type PlanRevisionDiffResult,
  type PlanRevisionSummary,
} from '../planRevisionDiff';
import { parseSimplifiedInput } from '../simplifiedInput';
import { supabase } from '../supabase';
import { adminClient, prodDbTestsEnabled } from './_serverGateHarness';

const itDb = prodDbTestsEnabled ? it : it.skip;
const describeDb = prodDbTestsEnabled ? describe : describe.skip;

jest.setTimeout(15 * 60 * 1000); // a full publish writes thousands of rows

// ── env ────────────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '../..');
const PROJECT_ID = process.env.PROJECT_ID ?? '';
const WORKBOOK = process.env.WORKBOOK ?? '';
const EXPECTED_BETON = Number(process.env.EXPECTED_BETON ?? NaN);
const NOTIFY_TEAMS = !/^(0|false|no)$/i.test(process.env.NOTIFY_TEAMS ?? '1');
const BETON_MATERIAL_CODE = 'CON-RM30';
const BETON_COMPONENT_NAME = 'Readymix K-350';
/** Rounding slack against the operator-supplied 2-dp EXPECTED_BETON figure. */
const ROUNDING_SLACK = 0.005;
/** Everything else is compared against the before-dump at full precision. */
const EXACT = 1e-6;

const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line no-console

interface BeforeDump {
  project: { code: string; id: string; label: string };
  latestMaster: { id: string; ahs_version_id: string; created_at: string } | null;
  plannedByMaterial: Record<string, { material_id: string | null; code: string | null; name: string | null; planned_total: number }>;
  boqActiveCount: number;
  boqActiveIds: string[];
  boqItemsActive: Array<{ id: string; code: string; planned: number; installed: number; progress: number | null }>;
  requests: {
    headerCount: number; headerIds: string[]; headerStatusTally: Record<string, number>;
    lineCount: number; lineIds: string[]; lineFlagTally: Record<string, number>;
    allocationCount: number; allocationIds: string[]; allocationBasisTally: Record<string, number>;
  };
  priceBookCount: number;
  priceBookNames: string[];
  baselineSnapshots: Array<{ material_id: string; baseline_planned_qty: number; code: string | null }>;
  notificationCountProject: number;
  currentAhsVersionId: string | null;
}

function loadBeforeDump(): BeforeDump {
  const explicit = process.env.BEFORE_DUMP;
  if (explicit) return JSON.parse(fs.readFileSync(path.resolve(ROOT, explicit), 'utf8'));
  const indexPath = path.join(ROOT, 'tmp/b4-republish/_index.json');
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      'No before-state dump found. Run `npx tsx tmp/b4-republish-dump.mjs` first ' +
        '(or pass BEFORE_DUMP=<path>) — the post-publish assertions diff against it.',
    );
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
    projects: Array<{ id: string; file: string }>;
  };
  const entry = index.projects.find(p => p.id === PROJECT_ID);
  if (!entry) throw new Error(`tmp/b4-republish/_index.json has no entry for PROJECT_ID=${PROJECT_ID}`);
  return JSON.parse(fs.readFileSync(path.join(ROOT, entry.file), 'utf8'));
}

const tally = (rows: Array<Record<string, unknown>>, field: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[field] ?? 'NULL');
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

async function selectAll<T>(
  table: string,
  columns: string,
  apply?: (q: any) => any,
): Promise<T[]> {
  const rows: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = adminClient.from(table).select(columns).range(from, from + page - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
  }
  return rows;
}

// ── the app's revision-context helpers, replicated ─────────────────────────
// (BaselineScreen.tsx fetchCurrentMaster / fetchProjectActivity /
//  fetchActivityForNewMaterials / buildNotifySummary — same queries, same
//  ordering, so the context this harness builds is the one the UI would build.)

async function fetchCurrentMaster(projectId: string) {
  const { data: master } = await adminClient
    .from('project_material_master')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!master) return { isRepublish: false, lines: [] as Array<{ material_id: string; planned_quantity: number }> };
  const lines = await selectAll<{ material_id: string | null; planned_quantity: unknown }>(
    'project_material_master_lines',
    'material_id, planned_quantity',
    q => q.eq('master_id', master.id),
  );
  return {
    isRepublish: true,
    masterId: master.id as string,
    lines: lines
      .filter(l => !!l.material_id)
      .map(l => ({ material_id: l.material_id as string, planned_quantity: Number(l.planned_quantity) || 0 })),
  };
}

async function fetchProjectActivity(projectId: string) {
  const activity = new Map<string, MaterialActivity>();
  const names = new Map<string, string>();
  const { data } = await adminClient
    .from('v_material_envelope_status')
    .select('material_id, material_name, total_ordered, total_requested, total_received')
    .eq('project_id', projectId);
  for (const r of data ?? []) {
    if (!r.material_id) continue;
    activity.set(r.material_id as string, {
      ordered: Number(r.total_ordered) || 0,
      requested: Number(r.total_requested) || 0,
      receiptsExist: (Number(r.total_received) || 0) > 0,
    });
    if (r.material_name) names.set(r.material_id as string, r.material_name as string);
  }
  return { activity, names };
}

async function fetchActivityForNewMaterials(projectId: string, materialIds: string[]) {
  const out = new Map<string, MaterialActivity>();
  if (materialIds.length === 0) return out;
  const bump = (id: string) => {
    let a = out.get(id);
    if (!a) { a = { ordered: 0, requested: 0, receiptsExist: false }; out.set(id, a); }
    return a;
  };
  const [reqRes, poRes, rcptRes] = await Promise.all([
    adminClient
      .from('material_request_lines')
      .select('material_id, quantity, material_request_headers!inner(project_id, overall_status)')
      .in('material_id', materialIds)
      .eq('material_request_headers.project_id', projectId)
      .neq('material_request_headers.overall_status', 'REJECTED'),
    adminClient
      .from('purchase_order_lines')
      .select('material_id, quantity, purchase_orders!inner(project_id, status)')
      .in('material_id', materialIds)
      .eq('purchase_orders.project_id', projectId)
      .neq('purchase_orders.status', 'CANCELLED'),
    adminClient
      .from('receipt_lines')
      .select('material_id, receipts!inner(project_id)')
      .in('material_id', materialIds)
      .eq('receipts.project_id', projectId),
  ]);
  for (const r of (reqRes.data ?? []) as Array<{ material_id: string | null; quantity: unknown }>) {
    if (r.material_id) bump(r.material_id).requested += Number(r.quantity) || 0;
  }
  for (const r of (poRes.data ?? []) as Array<{ material_id: string | null; quantity: unknown }>) {
    if (r.material_id) bump(r.material_id).ordered += Number(r.quantity) || 0;
  }
  for (const r of (rcptRes.data ?? []) as Array<{ material_id: string | null }>) {
    if (r.material_id) bump(r.material_id).receiptsExist = true;
  }
  return out;
}

function buildNotifySummary(s: PlanRevisionSummary): string {
  const parts: string[] = [];
  if (s.raisedAbsolvingOverage) parts.push(`${s.raisedAbsolvingOverage} kenaikan menutup over-order`);
  if (s.raised) parts.push(`${s.raised} dinaikkan`);
  if (s.loweredBelowOrdered) parts.push(`${s.loweredBelowOrdered} turun di bawah order`);
  if (s.removedWithActivity) parts.push(`${s.removedWithActivity} dihapus (masih ada aktivitas)`);
  if (s.added) parts.push(`${s.added} ditambah`);
  if (s.lowered) parts.push(`${s.lowered} diturunkan`);
  return parts.length
    ? `Rencana material diperbarui: ${parts.join(', ')}.`
    : 'Rencana material proyek diperbarui.';
}

// ── run state, filled by beforeAll ─────────────────────────────────────────
let before: BeforeDump;
let sessionId = '';
let newMasterId = '';
let publishResult: Awaited<ReturnType<typeof publishBaselineV2>>;
let diff: PlanRevisionDiffResult;
/** Full-precision beton total read straight off the patched workbook. */
let workbookBetonTotal = 0;
/** code → full-precision planned, from the patched workbook. */
let workbookPlannedByCode = new Map<string, number>();
/** codes whose recipe actually carries a concrete component (rebar-only rows do not). */
const workbookBetonCodes = new Set<string>();
let betonMaterialId = '';
let afterPlannedByMaterial = new Map<string, number>();

beforeAll(async () => {
  if (!prodDbTestsEnabled) return;

  // ── env validation ──────────────────────────────────────────────────────
  const missing = [
    ['PROJECT_ID', PROJECT_ID],
    ['WORKBOOK', WORKBOOK],
    ['EXPECTED_BETON', process.env.EXPECTED_BETON],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`missing required env: ${missing.join(', ')}`);
  if (!Number.isFinite(EXPECTED_BETON)) throw new Error(`EXPECTED_BETON is not a number: ${process.env.EXPECTED_BETON}`);
  const wbPath = path.resolve(ROOT, WORKBOOK);
  if (!fs.existsSync(wbPath)) throw new Error(`WORKBOOK not found: ${wbPath}`);

  before = loadBeforeDump();
  if (before.project.id !== PROJECT_ID) {
    throw new Error(`before-dump is for ${before.project.id}, not PROJECT_ID=${PROJECT_ID}`);
  }
  const { data: project } = await adminClient.from('projects').select('code, name').eq('id', PROJECT_ID).single();
  log(`\n╔══ RE-PUBLISH ${project?.code} — ${project?.name}`);
  log(`║  workbook       : ${WORKBOOK}`);
  log(`║  before-dump    : ${before.project.code} (master ${before.latestMaster?.id})`);
  log(`║  expected beton : ${EXPECTED_BETON} m³`);
  log('╚═════════════════════════════════════════════════════════════════');

  // ── 1. pre-flight: the alias must already exist ─────────────────────────
  const { catalog, aliasMap } = await loadCatalogAndAliases();
  const resolvedId = resolveCatalogId(BETON_COMPONENT_NAME, catalog, aliasMap);
  const betonRow = catalog.find(c => c.code === BETON_MATERIAL_CODE);
  if (!betonRow) throw new Error(`catalog has no ${BETON_MATERIAL_CODE} row`);
  betonMaterialId = betonRow.id;
  if (resolvedId !== betonMaterialId) {
    throw new Error(
      `PRE-FLIGHT FAILED: "${BETON_COMPONENT_NAME}" resolves to ` +
        `${resolvedId ? catalog.find(c => c.id === resolvedId)?.code : 'NOTHING'}, expected ${BETON_MATERIAL_CODE}. ` +
        'Apply the aliases first:  npx tsx tmp/apply-k350-aliases.mjs --apply  ' +
        '(publishBaselineV2 reads material_aliases at publish time — adding them after is too late).',
    );
  }
  log(`pre-flight ok: "${BETON_COMPONENT_NAME}" -> ${BETON_MATERIAL_CODE} / ${betonRow.name}`);

  // ── the workbook's own numbers, for exact comparison later ──────────────
  const wbBuf = fs.readFileSync(wbPath);
  const wbRows = parseSimplifiedInput(wbBuf).stagingRows.filter(r => r.row_type === 'boq');
  for (const r of wbRows) {
    const pd = r.parsed_data as { code: string; planned: number; recipe?: { components?: Array<{ materialName?: string }> } };
    workbookPlannedByCode.set(pd.code, Number(pd.planned));
    if ((pd.recipe?.components ?? []).some(c => c.materialName === BETON_COMPONENT_NAME)) {
      workbookBetonTotal += Number(pd.planned);
      workbookBetonCodes.add(pd.code);
    }
  }
  log(`workbook: ${wbRows.length} work areas, beton total ${workbookBetonTotal} m³ (${workbookBetonTotal.toFixed(2)})`);
  if (Math.abs(workbookBetonTotal - EXPECTED_BETON) > ROUNDING_SLACK) {
    throw new Error(
      `WORKBOOK/EXPECTED mismatch before touching anything: the workbook totals ` +
        `${workbookBetonTotal.toFixed(4)} m³ but EXPECTED_BETON=${EXPECTED_BETON}. Refusing to publish.`,
    );
  }

  // ── 2. upload + session, as the upload screen does ──────────────────────
  const fileName = path.basename(wbPath);
  const storagePath = `imports/${PROJECT_ID}/${Date.now()}_${fileName}`;
  let persistedFilePath = storagePath;
  const { error: upErr } = await supabase.storage.from('project-files').upload(storagePath, wbBuf, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  if (upErr) {
    persistedFilePath = `local://imports/${PROJECT_ID}/${fileName}`;
    log(`WARN: storage upload failed (${upErr.message}) — session records ${persistedFilePath}`);
  } else {
    log(`uploaded source to ${storagePath}`);
  }

  let uploaderId = process.env.UPLOADER_PROFILE_ID ?? '';
  if (!uploaderId) {
    const { data: prev } = await adminClient
      .from('import_sessions')
      .select('uploaded_by')
      .eq('project_id', PROJECT_ID)
      .eq('status', 'PUBLISHED')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    uploaderId = (prev?.uploaded_by as string) ?? '';
  }
  if (!uploaderId) throw new Error('could not determine an uploader profile — pass UPLOADER_PROFILE_ID');
  const { data: uploader } = await adminClient.from('profiles').select('id, full_name, role').eq('id', uploaderId).maybeSingle();
  log(`import session attributed to ${uploaderId} (${uploader?.full_name ?? '?'} / ${uploader?.role ?? '?'})`);

  const session = await createImportSession(PROJECT_ID, uploaderId, persistedFilePath, fileName, 'v2');
  if (!session.session) throw new Error(`createImportSession failed: ${session.error}`);
  sessionId = session.session.id as string;
  log(`import session ${sessionId}`);

  // ── 3. parse + stage ────────────────────────────────────────────────────
  const ab = new ArrayBuffer(wbBuf.byteLength);
  new Uint8Array(ab).set(wbBuf);
  const staged = await parseAndStageWorkbook(sessionId, PROJECT_ID, ab, fileName);
  if (!staged.success) throw new Error(`parseAndStageWorkbook failed: ${staged.error}`);

  const stagingRows = await selectAll<{ id: string; row_type: string; needs_review: boolean; review_status: string; raw_data: any; parsed_data: any }>(
    'import_staging_rows',
    'id, row_type, needs_review, review_status, raw_data, parsed_data',
    q => q.eq('session_id', sessionId),
  );
  const boqStaged = stagingRows.filter(r => r.row_type === 'boq');
  const matStaged = stagingRows.filter(r => r.row_type === 'material');
  log(`staged ${stagingRows.length} rows (${boqStaged.length} boq, ${matStaged.length} project materials)`);

  // The app refuses to publish while any flagged row is still PENDING. Do NOT
  // auto-approve here — a flagged row means the parser could not read something
  // and a human must look at it in the review queue.
  const pendingFlagged = stagingRows.filter(r => r.needs_review && r.review_status === 'PENDING');
  if (pendingFlagged.length > 0) {
    throw new Error(
      `${pendingFlagged.length} staged row(s) need review before publish ` +
        `(${pendingFlagged.slice(0, 5).map(r => `${r.parsed_data?.code ?? r.id}: ${r.raw_data?.flag_reason ?? 'structural'}`).join('; ')}). ` +
        `Review them in the app, then re-run. Session ${sessionId} is left in REVIEW.`,
    );
  }

  // The staged concrete must carry the grade — otherwise the patched column
  // was not read and the whole point of the re-publish is lost.
  const betonNames = new Set<string>();
  for (const r of boqStaged) {
    for (const c of (r.parsed_data?.recipe?.components ?? []) as Array<{ materialName?: string }>) {
      if (/ready\s*mix|readymix/i.test(c.materialName ?? '')) betonNames.add(c.materialName as string);
    }
  }
  log(`staged concrete component names: ${JSON.stringify([...betonNames])}`);
  if (betonNames.size !== 1 || !betonNames.has(BETON_COMPONENT_NAME)) {
    throw new Error(
      `staged concrete is ${JSON.stringify([...betonNames])}, expected only "${BETON_COMPONENT_NAME}" — ` +
        'the "Mutu Beton" column was not picked up. Session left unpublished.',
    );
  }

  // ── 4. the real revision context ────────────────────────────────────────
  const current = await fetchCurrentMaster(PROJECT_ID);
  if (!current.isRepublish) throw new Error('no current master — this project has never been published; harness is for RE-publish only');
  if (current.masterId !== before.latestMaster?.id) {
    throw new Error(
      `the current master moved since the before-dump (${before.latestMaster?.id} -> ${current.masterId}). ` +
        'Someone published in between. Re-run tmp/b4-republish-dump.mjs and start over.',
    );
  }

  const preview = await previewNewMasterTotals(sessionId);
  if (preview.error) throw new Error(`previewNewMasterTotals failed: ${preview.error}`);
  const newRows = [...preview.totals].map(([material_id, planned_quantity]) => ({ material_id, planned_quantity }));
  log(`proposed master: ${newRows.length} materials`);

  const activityInfo = await fetchProjectActivity(PROJECT_ID);
  const newMaterialIds = newRows.map(r => r.material_id).filter(id => id && !activityInfo.activity.has(id));
  if (newMaterialIds.length > 0) {
    const probed = await fetchActivityForNewMaterials(PROJECT_ID, newMaterialIds);
    for (const [id, a] of probed) activityInfo.activity.set(id, a);
  }

  diff = computePlanRevisionDiff(newRows, current.lines, activityInfo.activity);
  log(`diff: ${diff.lines.length} line(s), warning classes ${JSON.stringify(diff.warningClasses)}, summary ${JSON.stringify(diff.summary)}`);
  for (const l of diff.lines) {
    const name = activityInfo.names.get(l.material_id) ?? l.material_id;
    log(`  ${l.classification}  ${name}: ${l.planned_before} -> ${l.planned_after} (ordered ${l.ordered_at_time}, requested ${l.requested_at_time})`);
  }
  if (diff.warningClasses.length > 0) {
    throw new Error(
      `the diff carries WARNING classes ${JSON.stringify(diff.warningClasses)} — those need a human ` +
        'acknowledgment in the app checklist (and possibly a principal ceiling approval). ' +
        `Publish this one through BaselineScreen instead. Session ${sessionId} left unpublished.`,
    );
  }

  const revisionContext: RevisionContext = {
    diffLines: diff.lines,
    summary: diff.summary,
    acknowledgedAt: new Date().toISOString(),
    acknowledgedBy: uploaderId,
    notifySummaryText: buildNotifySummary(diff.summary),
  };

  // ── 5. publish ──────────────────────────────────────────────────────────
  log('\n--- publishBaselineV2 ---');
  publishResult = await publishBaselineV2(sessionId, PROJECT_ID, { revisionContext });
  log(JSON.stringify({
    success: publishResult.success,
    error: publishResult.error,
    boqCount: publishResult.boqCount,
    ahsCount: publishResult.ahsCount,
    masterLineCount: publishResult.masterLineCount,
    unresolvedComponentCount: publishResult.unresolvedComponentCount,
    supersededCount: publishResult.supersededCount,
    resurrectedCount: publishResult.resurrectedCount,
    skippedZeroPlanned: publishResult.skippedZeroPlanned,
    quarantinedRows: publishResult.quarantinedRows,
  }, null, 2));
  for (const w of publishResult.warnings ?? []) log(`  WARNING: ${w}`);
  if (!publishResult.success) throw new Error(`publish FAILED: ${publishResult.error}`);

  // This harness calls publishBaselineV2 directly, bypassing the app's
  // publishBaseline() wrapper — which, on success, flips the session to
  // PUBLISHED (tools/baseline.ts:594-596, comment there explains why: a
  // v2 publish never touches the session row itself, so without this the
  // session stays REVIEW and could be re-published, spawning duplicate
  // ahs_versions). Mirror that here, fail-closed: only on success, and
  // only after publishResult.success has already been checked above.
  await updateImportStatus(sessionId, 'PUBLISHED');
  log(`session ${sessionId} marked PUBLISHED`);

  const { data: master } = await adminClient
    .from('project_material_master')
    .select('id, created_at')
    .eq('project_id', PROJECT_ID)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .single();
  newMasterId = master!.id as string;
  log(`\nNEW MASTER: ${newMasterId} (was ${before.latestMaster?.id})`);

  const afterLines = await selectAll<{ material_id: string | null; planned_quantity: unknown }>(
    'project_material_master_lines',
    'material_id, planned_quantity',
    q => q.eq('master_id', newMasterId),
  );
  afterPlannedByMaterial = new Map();
  for (const l of afterLines) {
    if (!l.material_id) continue;
    afterPlannedByMaterial.set(
      l.material_id,
      (afterPlannedByMaterial.get(l.material_id) ?? 0) + (Number(l.planned_quantity) || 0),
    );
  }

  // ── 6. tell the teams ───────────────────────────────────────────────────
  // publish already fired the fan-out if the diff had lines. When it did not
  // (no material with prior activity changed), notify explicitly — with the
  // real revision id and a sentence built from real figures, never a fabricated
  // diff line. See the header.
  if (NOTIFY_TEAMS && diff.lines.length === 0) {
    const { data: revision } = await adminClient
      .from('plan_revisions')
      .select('id')
      .eq('project_id', PROJECT_ID)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!revision) {
      log('WARN: no plan_revisions row to attach a notification to — skipping the fan-out');
    } else {
      const betonAfter = afterPlannedByMaterial.get(betonMaterialId) ?? 0;
      const body =
        `Rencana material diperbarui: beton ${BETON_COMPONENT_NAME} kini masuk rencana ` +
        `(${betonAfter.toFixed(2)} m³). Kuantitas material lain tidak berubah.`;
      const { error: notifyErr } = await adminClient.rpc('notify_plan_revised', {
        p_project_id: PROJECT_ID,
        p_revision_id: revision.id,
        p_summary: body,
        p_raise_count: 0, // nothing was raised — no principal FYI
      });
      log(notifyErr ? `WARN: notify_plan_revised failed: ${notifyErr.message}` : `notified supervisors: "${body}"`);
    }
  }
});

describeDb('K-350 re-publish — post-publish verification', () => {
  itDb('publish succeeded and created a NEW material master', () => {
    expect(publishResult.success).toBe(true);
    expect(newMasterId).toBeTruthy();
    expect(newMasterId).not.toBe(before.latestMaster?.id);
  });

  itDb('reported no unresolved components', () => {
    expect(publishResult.unresolvedComponentCount ?? 0).toBe(0);
  });

  itDb(`new master carries ${BETON_MATERIAL_CODE} at the workbook's beton total`, () => {
    const actual = afterPlannedByMaterial.get(betonMaterialId);
    expect(actual).toBeDefined();
    // exact against the workbook, and 2-dp against what the operator expected
    expect(Math.abs((actual as number) - workbookBetonTotal)).toBeLessThan(EXACT);
    expect(Math.abs((actual as number) - EXPECTED_BETON)).toBeLessThanOrEqual(ROUNDING_SLACK);
  });

  itDb('every OTHER material planned total is unchanged from the before-dump', () => {
    const beforeByMaterial = new Map<string, { planned_total: number; code: string | null }>();
    for (const v of Object.values(before.plannedByMaterial)) {
      if (v.material_id) beforeByMaterial.set(v.material_id, { planned_total: v.planned_total, code: v.code });
    }
    const drift: string[] = [];
    for (const [mid, b] of beforeByMaterial) {
      const a = afterPlannedByMaterial.get(mid);
      if (a === undefined) { drift.push(`${b.code ?? mid}: DISAPPEARED (was ${b.planned_total})`); continue; }
      if (Math.abs(a - b.planned_total) > EXACT) drift.push(`${b.code ?? mid}: ${b.planned_total} -> ${a}`);
    }
    const added = [...afterPlannedByMaterial.keys()].filter(m => !beforeByMaterial.has(m) && m !== betonMaterialId);
    expect({ drift, unexpectedlyAdded: added }).toEqual({ drift: [], unexpectedlyAdded: [] });
    // …and the only addition is the concrete.
    expect(afterPlannedByMaterial.size).toBe(beforeByMaterial.size + 1);
  });

  itDb('active boq_items: same ids, same count, same installed/progress', async () => {
    const rows = await selectAll<{ id: string; code: string; planned: unknown; installed: unknown; progress: unknown }>(
      'boq_items',
      'id, code, planned, installed, progress',
      q => q.eq('project_id', PROJECT_ID).is('superseded_at', null),
    );
    expect(rows.length).toBe(before.boqActiveCount);
    expect(rows.map(r => r.id).sort()).toEqual([...before.boqActiveIds].sort());

    const beforeById = new Map(before.boqItemsActive.map(b => [b.id, b]));
    const changed: string[] = [];
    for (const r of rows) {
      const b = beforeById.get(r.id);
      if (!b) { changed.push(`${r.code}: not in before-dump`); continue; }
      if (Number(r.installed) !== Number(b.installed)) changed.push(`${r.code}: installed ${b.installed} -> ${r.installed}`);
      if (Number(r.progress ?? 0) !== Number(b.progress ?? 0)) changed.push(`${r.code}: progress ${b.progress} -> ${r.progress}`);
    }
    expect(changed).toEqual([]);
  });

  itDb('requests / lines / allocations are untouched', async () => {
    const headers = await selectAll<{ id: string; overall_status: string }>(
      'material_request_headers', 'id, overall_status', q => q.eq('project_id', PROJECT_ID),
    );
    expect(headers.length).toBe(before.requests.headerCount);
    expect(headers.map(h => h.id).sort()).toEqual([...before.requests.headerIds].sort());
    expect(tally(headers, 'overall_status')).toEqual(before.requests.headerStatusTally);

    const headerIds = headers.map(h => h.id);
    const lines = headerIds.length
      ? await selectAll<{ id: string; line_flag: string }>(
          'material_request_lines', 'id, line_flag', q => q.in('request_header_id', headerIds),
        )
      : [];
    expect(lines.length).toBe(before.requests.lineCount);
    expect(lines.map(l => l.id).sort()).toEqual([...before.requests.lineIds].sort());
    expect(tally(lines, 'line_flag')).toEqual(before.requests.lineFlagTally);

    const lineIds = lines.map(l => l.id);
    const allocs = lineIds.length
      ? await selectAll<{ id: string; allocation_basis: string }>(
          'material_request_line_allocations', 'id, allocation_basis', q => q.in('request_line_id', lineIds),
        )
      : [];
    expect(allocs.length).toBe(before.requests.allocationCount);
    expect(allocs.map(a => a.id).sort()).toEqual([...before.requests.allocationIds].sort());
    expect(tally(allocs, 'allocation_basis')).toEqual(before.requests.allocationBasisTally);
  });

  itDb('ahs_price_book has no "Kolom Balok Praktis" rows', async () => {
    const pb = await selectAll<{ material_name: string; material_id: string | null; tier: number }>(
      'ahs_price_book', 'material_name, material_id, tier', q => q.eq('project_id', PROJECT_ID),
    );
    const junk = pb.filter(r => /kolom\s+balok\s+praktis/i.test(r.material_name ?? ''));
    expect(junk).toEqual([]);
    // and nothing unlinkable survived the rebuild
    expect(pb.filter(r => r.material_id == null)).toEqual([]);
    log(`ahs_price_book: ${before.priceBookCount} -> ${pb.length} rows`);
  });

  itDb('pre-existing baseline snapshots are untouched; the concrete gains one', async () => {
    const snaps = await selectAll<{ material_id: string; baseline_planned_qty: unknown }>(
      'material_baseline_snapshots', 'material_id, baseline_planned_qty', q => q.eq('project_id', PROJECT_ID),
    );
    const byId = new Map(snaps.map(s => [s.material_id, Number(s.baseline_planned_qty)]));
    const changed: string[] = [];
    for (const b of before.baselineSnapshots) {
      const a = byId.get(b.material_id);
      if (a === undefined) { changed.push(`${b.code ?? b.material_id}: snapshot DISAPPEARED`); continue; }
      if (Math.abs(a - Number(b.baseline_planned_qty)) > EXACT) {
        changed.push(`${b.code ?? b.material_id}: ${b.baseline_planned_qty} -> ${a}`);
      }
    }
    expect(changed).toEqual([]);
    expect(byId.has(betonMaterialId)).toBe(true);
  });

  itDb('a work-group envelope for a beton group returns the concrete row', async () => {
    // Take the chapter with the most concrete and ask the envelope RPC the app
    // asks — the whole point of the re-publish is that this row now exists.
    const rows = await selectAll<{ id: string; code: string; chapter: string | null; unit: string }>(
      'boq_items', 'id, code, chapter, unit',
      q => q.eq('project_id', PROJECT_ID).is('superseded_at', null),
    );
    const byChapter = new Map<string, Array<{ id: string; code: string }>>();
    for (const r of rows) {
      if (!workbookPlannedByCode.has(r.code)) continue;
      const key = r.chapter ?? '(none)';
      if (!byChapter.has(key)) byChapter.set(key, []);
      byChapter.get(key)!.push({ id: r.id, code: r.code });
    }
    let best: { chapter: string; ids: string[]; expected: number } | null = null;
    for (const [chapter, items] of byChapter) {
      // Only rows that actually carry a concrete component contribute. A
      // rebar-only work area ("Umum ; Kolom Balok Praktis") is staged as
      // planned = 1 'ls' with NO beton line, so counting its planned would
      // inflate the expectation by exactly 1 m³ of concrete that isn't there.
      const expected = items
        .filter(i => workbookBetonCodes.has(i.code))
        .reduce((s, i) => s + (workbookPlannedByCode.get(i.code) ?? 0), 0);
      if (!best || expected > best.expected) best = { chapter, ids: items.map(i => i.id), expected };
    }
    expect(best).not.toBeNull();
    log(`work group "${best!.chapter}": ${best!.ids.length} boq rows, expected beton ${best!.expected}`);

    const { data, error } = await adminClient.rpc('get_workgroup_material_envelopes', {
      p_project_id: PROJECT_ID,
      p_boq_item_ids: best!.ids,
    });
    expect(error).toBeNull();
    const betonRow = ((data ?? []) as Array<{ material_id: string; planned: number }>)
      .find(r => r.material_id === betonMaterialId);
    expect(betonRow).toBeDefined();
    // The rebar-only work area in the group has no concrete, so the group total
    // is the sum over its concrete rows only.
    expect(Math.abs(Number(betonRow!.planned) - best!.expected)).toBeLessThan(1e-4);
  });

  itDb('the import session is marked PUBLISHED and staging rows are retained', async () => {
    const { data: s } = await adminClient
      .from('import_sessions')
      .select('status, published_at')
      .eq('id', sessionId)
      .single();
    expect(s!.status).toBe('PUBLISHED');
    const staging = await selectAll<{ id: string }>('import_staging_rows', 'id', q => q.eq('session_id', sessionId));
    expect(staging.length).toBeGreaterThan(0);
  });
});
