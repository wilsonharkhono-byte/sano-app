// SANO - datum-sync: who may start a run, and how.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §6.1-§6.3, §7.
// Plan: docs/superpowers/plans/2026-09-27-datum-sync.md (Lane F).
//
// Two ways in, both checked here before any service-role work:
//   * The Database Webhook on datum_sync_requests INSERT (hourly, pg_cron):
//     Authorization is exactly `Bearer <WEBHOOK_AUTH_SECRET>`, compared as
//     SHA-256 digests. An unset secret never opens this path. Answers 202
//     and runs on in waitUntil, so a webhook timeout cannot cut a run short.
//   * A signed-in user (the Rooms tab): the caller's JWT, the project read
//     through the caller's own RLS, and is_office_role() - admin, principal
//     or estimator - for a sync and for an import alike. (The spec's first
//     version limited "Sinkron DATUM" to admin and principal; the owner
//     widened it to every office role on 2026-09-27, calibration item 9.)
// The function is deployed with --no-verify-jwt because the webhook presents
// the shared secret, not a JWT; this file is the only gate.

import {
  PAIRING_MISSING,
  SYNC_RUNNING,
  closeRunUnstarted,
  executeImport,
  executeSync,
  startRun,
  type RunContext,
  type RunRequest,
} from './run.ts';

export type CallerCheck =
  | { ok: true; userId: string; isOffice: boolean }
  | { ok: false; status: number; code: string; error: string };

export interface HandlerDeps {
  /** false when any Supabase or DATUM variable is missing: every call is 500 CONFIG. */
  configured: boolean;
  /** WEBHOOK_AUTH_SECRET; empty means the webhook path is closed. */
  webhookSecret: string;
  /** The caller's JWT, their RLS read of the project, and is_office_role(). */
  verifyCaller(authHeader: string, projectId: string): Promise<CallerCheck>;
  /** Builds the service-role store and the DATUM client; called only after a check passed. */
  openContext(): RunContext;
  waitUntil(work: Promise<unknown>): void;
}

export const FORBIDDEN_SYNC = 'Hanya peran kantor (admin, prinsipal, estimator) yang dapat menyinkronkan DATUM.';
export const FORBIDDEN_IMPORT = 'Hanya peran kantor yang dapat mengambil ruangan dari DATUM.';
/**
 * DATUM's area_code has no length limit and the card sends every DATUM-only
 * code, so the request limits are generous; planImport then judges each code
 * alone, and one it cannot use is skipped with its reason while the rest
 * import.
 */
export const MAX_IMPORT_CODES = 500;
export const MAX_IMPORT_CODE_LENGTH = 200;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } });
}

const refuse = (status: number, code: string, error: string) => json({ ok: false, code, error }, status);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Constant time: both sides SHA-256 digested, then compared byte by byte. */
export async function bearerMatches(header: string, secret: string): Promise<boolean> {
  if (!secret) return false;
  const enc = new TextEncoder();
  const [given, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(header)),
    crypto.subtle.digest('SHA-256', enc.encode(`Bearer ${secret}`)),
  ]);
  const a = new Uint8Array(given);
  const b = new Uint8Array(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function parseCodes(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_IMPORT_CODES) return null;
  if (!raw.every((c) => typeof c === 'string' && c.length >= 1 && c.length <= MAX_IMPORT_CODE_LENGTH)) return null;
  return raw as string[];
}

const unexpected = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err);
  return `Kesalahan tak terduga: ${message.slice(0, 280)}`;
};

/**
 * The request is marked before the 202 (handled_at, run_id): the webhook
 * delivered, so the Rooms tab must never read it as waiting, even if the
 * runtime later stops the run (the next run's sweep then writes "terputus"
 * on both). Any throw on this path marks the request with its error, and a
 * run it had opened is closed at once.
 */
async function fromWebhook(deps: HandlerDeps, body: Record<string, unknown>): Promise<Response> {
  const record = body.record as { id?: unknown; project_id?: unknown } | undefined;
  if (body.type !== 'INSERT' || body.table !== 'datum_sync_requests' || !isUuid(record?.id) || !isUuid(record?.project_id)) {
    return refuse(400, 'BAD_REQUEST', 'Bukan kiriman Database Webhook untuk datum_sync_requests.');
  }
  const requestId = record.id;
  const ctx = deps.openContext();
  const req: RunRequest = { projectId: record.project_id, source: 'cron', requestedBy: null, requestId };
  const mark = (runId: string | null, error: string | null) =>
    ctx.store.markRequest(requestId, { handledAt: ctx.now().toISOString(), runId, error });
  let openedRunId: string | null = null;
  try {
    const started = await startRun(ctx, req);
    if (started.kind === 'not_found') {
      await mark(null, 'Proyek tidak ditemukan.');
      return refuse(404, 'NOT_FOUND', 'Proyek tidak ditemukan.');
    }
    if (started.kind === 'pairing_missing') {
      await mark(started.runId, PAIRING_MISSING);
      return json({ ok: false, code: 'PAIRING_MISSING', error: PAIRING_MISSING, runId: started.runId }, 409);
    }
    if (started.kind === 'running') {
      await mark(null, SYNC_RUNNING);
      return refuse(409, 'SYNC_RUNNING', SYNC_RUNNING);
    }
    openedRunId = started.runId;
    await mark(started.runId, null);
    deps.waitUntil(
      executeSync(ctx, started.runId, started.project, req).catch((err) => {
        console.error(`datum-sync: run ${started.runId} failed after 202:`, err);
      }),
    );
    return json({ ok: true, code: 'ACCEPTED', runId: started.runId }, 202);
  } catch (err) {
    const reason = unexpected(err);
    console.error('datum-sync: webhook request failed', err);
    try {
      await mark(openedRunId, reason);
    } catch (markErr) {
      console.error(`datum-sync: request ${requestId} could not be marked:`, markErr);
    }
    if (openedRunId) {
      try {
        await closeRunUnstarted(ctx, openedRunId, reason);
      } catch (closeErr) {
        console.error(`datum-sync: run ${openedRunId} stays open for the sweep:`, closeErr);
      }
    }
    return refuse(500, 'UNEXPECTED', reason);
  }
}

async function fromUser(deps: HandlerDeps, authHeader: string, body: Record<string, unknown>): Promise<Response> {
  if (!authHeader) return refuse(401, 'AUTH', 'Tidak ada otorisasi.');
  if (!isUuid(body.projectId)) return refuse(400, 'BAD_REQUEST', 'projectId tidak valid.');
  const importing = body.importDatumOnly === true;
  let codes: string[] = [];
  if (importing) {
    const parsed = parseCodes(body.areaCodes);
    if (!parsed) {
      return refuse(400, 'BAD_REQUEST', `areaCodes harus 1-${MAX_IMPORT_CODES} kode DATUM, masing-masing 1-${MAX_IMPORT_CODE_LENGTH} karakter.`);
    }
    codes = parsed;
  }

  const caller = await deps.verifyCaller(authHeader, body.projectId);
  if (!caller.ok) return refuse(caller.status, caller.code, caller.error);
  if (!caller.isOffice) return refuse(403, 'FORBIDDEN', importing ? FORBIDDEN_IMPORT : FORBIDDEN_SYNC);

  const ctx = deps.openContext();
  const req: RunRequest = {
    projectId: body.projectId,
    source: importing ? 'import' : 'manual',
    requestedBy: caller.userId,
    requestId: null,
  };
  const started = await startRun(ctx, req);
  if (started.kind === 'not_found') return refuse(404, 'NOT_FOUND', 'Proyek tidak ditemukan.');
  if (started.kind === 'pairing_missing') {
    return json({ ok: false, code: 'PAIRING_MISSING', error: PAIRING_MISSING, runId: started.runId }, 409);
  }
  if (started.kind === 'running') return refuse(409, 'SYNC_RUNNING', SYNC_RUNNING);

  const report = importing
    ? await executeImport(ctx, started.runId, started.project, req, codes)
    : await executeSync(ctx, started.runId, started.project, req);
  return json(report, 200);
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return refuse(405, 'METHOD', 'Gunakan POST.');
    if (!deps.configured) return refuse(500, 'CONFIG', 'Konfigurasi sinkron DATUM di server tidak lengkap.');

    const authHeader = req.headers.get('Authorization') ?? '';
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      body = parsed as Record<string, unknown>;
    } catch {
      return refuse(400, 'BAD_REQUEST', 'Body harus objek JSON.');
    }

    try {
      if (await bearerMatches(authHeader, deps.webhookSecret)) return await fromWebhook(deps, body);
      return await fromUser(deps, authHeader, body);
    } catch (err) {
      console.error('datum-sync: unexpected error', err);
      return refuse(500, 'UNEXPECTED', unexpected(err));
    }
  };
}
