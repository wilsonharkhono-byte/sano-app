// SANO - the app side of the DATUM sync (spec 2026-09-27 §7, §8.1).
//
// Three calls and one read:
//   * setDatumProjectCode - migration 107's set_datum_project_code RPC.
//   * syncDatum / importFromDatum - the datum-sync edge function, the way
//     tools/siteEvents.ts invokes site-event-analyze. The answer is either
//     the run the server wrote ({ run }) or a refusal as a sentence
//     ({ error, code }); nothing is claimed before the server answered.
//   * getDatumSyncState - the Rooms-tab card's read of datum_sync_runs and
//     datum_sync_requests. A failed read is an error, never "belum pernah".
//
// Every office role (admin, principal, estimator) may pair, sync and import.
// The spec's first version kept "Sinkron DATUM" to admin and principal; the
// owner widened it on 2026-09-27 (calibration item 9), and the function
// enforces the same rule with is_office_role().

import { supabase } from './supabase';
import type { UserRoleType } from './constants';
import type { RunCounts, RunDifferences, RunReport } from './datumSyncPlan';

export const DATUM_SYNC_FUNCTION = 'datum-sync';
export const DATUM_OFFICE_ROLES: ReadonlyArray<UserRoleType> = ['admin', 'principal', 'estimator'];

export function canPairDatum(role: UserRoleType | null | undefined): boolean {
  return !!role && DATUM_OFFICE_ROLES.includes(role);
}

/** Same set as pairing: the owner's 2026-09-27 decision (a deliberate difference from spec §6.1). */
export function canSyncDatum(role: UserRoleType | null | undefined): boolean {
  return canPairDatum(role);
}

// ─── Pairing ─────────────────────────────────────────────────────────────────

const PAIRING_COPY: Array<[string, string]> = [
  ['DATUM_PAIRING_AUTH', 'Hanya admin, prinsipal atau estimator yang dapat menautkan proyek ke DATUM.'],
  ['DATUM_PAIRING_TAKEN', 'Kode DATUM ini sudah dipakai proyek lain.'],
  ['DATUM_PAIRING_PROJECT', 'Proyek tidak ditemukan.'],
];

export function mapDatumPairingError(message: string): string {
  const hit = PAIRING_COPY.find(([code]) => message.startsWith(`${code}:`));
  return hit ? hit[1] : `Kode DATUM gagal disimpan: ${message}`;
}

export async function setDatumProjectCode(
  projectId: string,
  code: string,
): Promise<{ code: string | null; error?: undefined } | { error: string; code?: undefined }> {
  const { data, error } = await supabase.rpc('set_datum_project_code', { p_project_id: projectId, p_code: code });
  if (error) return { error: mapDatumPairingError(error.message) };
  return { code: ((data as { code?: string | null } | null)?.code ?? null) };
}

// ─── Sync and import ─────────────────────────────────────────────────────────

export type DatumCallResult = { run: RunReport; error?: undefined } | { error: string; code: string; run?: undefined };

/**
 * The app's own sentence for each refusal whose meaning is fixed (the
 * function's codes, handler.ts); each also says what to do. Every other
 * code - FORBIDDEN, BAD_REQUEST, UNEXPECTED and any code added later -
 * carries a reason that varies ("Peran Anda tidak dapat diperiksa: ...",
 * "Proyek gagal dibaca: ..."), so the server's own sentence is shown and
 * never covered by a fixed one.
 */
export const DATUM_SYNC_REFUSALS: Record<string, string> = {
  AUTH: 'Sesi Anda berakhir. Masuk lagi, lalu coba sinkron lagi.',
  NOT_FOUND: 'Proyek tidak ditemukan atau Anda tidak punya akses.',
  PAIRING_MISSING: 'Proyek ini belum ditautkan ke DATUM.',
  SYNC_RUNNING: 'Sinkron DATUM untuk proyek ini sedang berjalan.',
  CONFIG: 'Sinkron DATUM belum dikonfigurasi di server.',
};
/** FORBIDDEN's sentences, only for a refusal that came without one (handler.ts FORBIDDEN_SYNC / FORBIDDEN_IMPORT). */
export const DATUM_SYNC_FORBIDDEN = 'Hanya peran kantor (admin, prinsipal, estimator) yang dapat menyinkronkan DATUM.';
export const DATUM_IMPORT_FORBIDDEN = 'Hanya peran kantor yang dapat mengambil ruangan dari DATUM.';

export function mapDatumSyncRefusal(code: string, serverMessage: string | null | undefined, importing = false): string {
  const fixed = DATUM_SYNC_REFUSALS[code];
  if (fixed) return fixed;
  if (code === 'FORBIDDEN') return serverMessage || (importing ? DATUM_IMPORT_FORBIDDEN : DATUM_SYNC_FORBIDDEN);
  return `${importing ? 'Ambil ruangan dari DATUM gagal' : 'Sinkron DATUM gagal'}: ${serverMessage || code}`;
}

interface FunctionReply extends Partial<RunReport> {
  code?: string;
}

function isRunReport(v: FunctionReply | null): v is RunReport {
  return !!v && typeof v.runId === 'string' && typeof v.ok === 'boolean' && !!v.counts;
}

async function invokeDatumSync(body: Record<string, unknown>, importing: boolean): Promise<DatumCallResult> {
  const { data, error } = await supabase.functions.invoke<FunctionReply>(DATUM_SYNC_FUNCTION, { body });
  if (!error) {
    if (isRunReport(data)) return { run: data };
    return { error: mapDatumSyncRefusal('UNEXPECTED', 'jawaban server tidak dikenal', importing), code: 'UNEXPECTED' };
  }
  // FunctionsHttpError carries the Response as `context`; the function always answers JSON.
  const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
  if (context && typeof context.json === 'function') {
    try {
      const payload = (await context.json()) as { code?: string; error?: string } | null;
      if (payload?.code) return { error: mapDatumSyncRefusal(payload.code, payload.error, importing), code: payload.code };
    } catch {
      // fall through to the generic sentence
    }
  }
  return { error: mapDatumSyncRefusal('INVOKE_FAILED', error.message, importing), code: 'INVOKE_FAILED' };
}

export function syncDatum(projectId: string): Promise<DatumCallResult> {
  return invokeDatumSync({ projectId }, false);
}

/**
 * The function's request limits (supabase/functions/datum-sync/handler.ts
 * MAX_IMPORT_CODES, MAX_IMPORT_CODE_LENGTH): one import carries 1-500 codes
 * of 1-200 characters each, or the whole request is refused. The card sends
 * only codes inside them.
 */
export const DATUM_IMPORT_MAX_CODES = 500;
export const DATUM_IMPORT_MAX_CODE_LENGTH = 200;

export function importFromDatum(projectId: string, areaCodes: string[]): Promise<DatumCallResult> {
  return invokeDatumSync({ projectId, importDatumOnly: true, areaCodes }, true);
}

// ─── The card's read ─────────────────────────────────────────────────────────

export interface DatumRun {
  id: string;
  project_id: string;
  source: 'manual' | 'cron' | 'import';
  requested_by: string | null;
  requester_name: string | null;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  counts: RunCounts;
  differences: RunDifferences;
  error: string | null;
}

export interface DatumSyncState {
  /** The newest run of this project, open or finished. */
  latest: DatumRun | null;
  /** The newest finished run of this project: the differences come from here, except those below. */
  latestFinished: DatumRun | null;
  /**
   * The newest finished run of this project that is not an import. An
   * import run never creates in DATUM or sends decisions, so it writes no
   * create_failed, schedule_warnings or escalate_skipped: those come from
   * here, or an import would make them vanish.
   */
  latestSync: DatumRun | null;
  /** The newest run, of any project, whose staff step was ok: staff matching is global. */
  staffRun: DatumRun | null;
  /** Hourly requests for this project unhandled for more than 2 hours. */
  waiting: { count: number; oldestAt: string } | null;
}

// One string literal on purpose (the tools/rooms.ts ROOM_COLUMNS rule).
const RUN_COLUMNS =
  'id, project_id, source, requested_by, started_at, finished_at, ok, counts, differences, error, requester:profiles!datum_sync_runs_requested_by_fkey(full_name)';

export const DATUM_WAITING_AFTER_MS = 2 * 60 * 60 * 1000;

type RunRow = Omit<DatumRun, 'requester_name'> & { requester?: { full_name?: string | null } | null };

function toRun(row: RunRow | null): DatumRun | null {
  if (!row) return null;
  const { requester, ...rest } = row;
  return {
    ...rest,
    counts: (rest.counts ?? { steps: {} }) as RunCounts,
    differences: (rest.differences ?? {}) as RunDifferences,
    requester_name: requester?.full_name ?? null,
  };
}

export async function getDatumSyncState(
  projectId: string,
  nowIso: string = new Date().toISOString(),
): Promise<DatumSyncState | { error: string }> {
  try {
    const waitingSince = new Date(Date.parse(nowIso) - DATUM_WAITING_AFTER_MS).toISOString();
    const [recent, staff, waiting, sync] = await Promise.all([
      supabase.from('datum_sync_runs').select(RUN_COLUMNS).eq('project_id', projectId)
        .order('started_at', { ascending: false }).limit(2),
      supabase.from('datum_sync_runs').select(RUN_COLUMNS).eq('counts->steps->>staff', 'ok').not('finished_at', 'is', null)
        .order('finished_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('datum_sync_requests').select('requested_at', { count: 'exact' }).eq('project_id', projectId)
        .is('handled_at', null).lt('requested_at', waitingSince).order('requested_at', { ascending: true }).limit(1),
      supabase.from('datum_sync_runs').select(RUN_COLUMNS).eq('project_id', projectId).neq('source', 'import')
        .not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const failed = recent.error ?? staff.error ?? waiting.error ?? sync.error;
    if (failed) return { error: failed.message };

    const runs = ((recent.data ?? []) as unknown as RunRow[]).map((r) => toRun(r) as DatumRun);
    const oldest = ((waiting.data ?? []) as Array<{ requested_at: string }>)[0];
    return {
      latest: runs[0] ?? null,
      latestFinished: runs.find((r) => r.finished_at !== null) ?? null,
      latestSync: toRun(sync.data as unknown as RunRow | null),
      staffRun: toRun(staff.data as unknown as RunRow | null),
      waiting: oldest && (waiting.count ?? 0) > 0 ? { count: waiting.count ?? 0, oldestAt: oldest.requested_at } : null,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
