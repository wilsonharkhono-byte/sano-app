// SANO - datum-sync: the five DATUM calls.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §5.2, §6.
// Every call carries `Authorization: Bearer <DATUM_SANO_SECRET>` and gives up
// after 15 s. A failure comes back as a sentence the Rooms tab can show as
// written (truth contract rule 6): never thrown, never smoothed over.

export interface DatumAreaRow {
  id: string;
  area_code: string;
  area_name: string;
  floor: string | null;
  area_type: string;
  sort_order: number;
}
export interface DatumAreasReply {
  project: { id: string; project_code: string; project_name: string };
  areas: DatumAreaRow[];
}
export interface DatumGate { code: string; name: string; description: string | null; sort_order: number }
export interface DatumStatusRow {
  area_id: string;
  gate_code: string;
  status: string;
  stale: boolean;
  last_recomputed_at: string | null;
  updated_at: string | null;
}
export interface DatumGateStatusReply { gates: DatumGate[]; statuses: DatumStatusRow[]; read_at: string }
export interface DatumPostAreaItem {
  area_code: string;
  area_name: string;
  floor: string | null;
  area_type: string;
  tracked: boolean;
}
/** Additive: a created area may carry a warning that a DATUM-side follow-up (its gate schedule, or its seed) did not run. */
export interface DatumPostAreaWarning { code: 'SCHEDULE_FAILED' | 'SEED_FAILED'; reason: string }
export interface DatumPostAreasReply {
  areas: Array<{ area_code: string; id: string; created: boolean; warning?: DatumPostAreaWarning }>;
  errors: Array<{ area_code: string; code: string }>;
}
export interface DatumStaffReply { staff: Array<{ id: string; full_name: string }> }
export interface DatumEscalateBody {
  project_code: string;
  area_id: string;
  sano_event_id: string;
  sano_url: string;
  title: string;
  summary: string | null;
  room_name: string;
  reporter_name: string;
  confirmer_name: string | null;
  owner_name: string;
  due_date: string;
  confirmed_at: string;
  author_staff_id: string | null;
}
export interface DatumEscalateReply { card_id: string; card_url: string; created: boolean; author: 'linked' | 'system' }

export type DatumResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; error: string };

export interface DatumApi {
  getAreas(projectCode: string): Promise<DatumResult<DatumAreasReply>>;
  getGateStatus(projectCode: string): Promise<DatumResult<DatumGateStatusReply>>;
  postAreas(projectCode: string, areas: DatumPostAreaItem[]): Promise<DatumResult<DatumPostAreasReply>>;
  getStaff(): Promise<DatumResult<DatumStaffReply>>;
  escalate(body: DatumEscalateBody): Promise<DatumResult<DatumEscalateReply>>;
}

export const DATUM_TIMEOUT_MS = 15_000;

/** The sentence a failed DATUM call leaves in the run log. */
export function datumFailureSentence(status: number, code: string, error: string, projectCode?: string): string {
  if (status === 401) return 'DATUM menolak kunci integrasi (401).';
  if (code === 'UNKNOWN_PROJECT') return `Kode proyek DATUM ${projectCode ?? ''} tidak ditemukan di DATUM.`;
  if (code === 'TIMEOUT') return 'DATUM tidak menjawab dalam 15 detik.';
  if (code === 'NETWORK') return `DATUM tidak dapat dihubungi: ${error}`;
  if (code === 'NOT_CONFIGURED') return `DATUM belum siap untuk SANO (503): ${error}`;
  return `DATUM menjawab ${status} ${code}: ${error}`;
}

export function makeDatumApi(opts: {
  baseUrl: string;
  secret: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}): DatumApi {
  const base = `${opts.baseUrl.replace(/\/+$/, '')}/api/integrations/sano`;
  const timeoutMs = opts.timeoutMs ?? DATUM_TIMEOUT_MS;

  async function call<T>(method: 'GET' | 'POST', path: string, body: unknown, projectCode?: string): Promise<DatumResult<T>> {
    let resp: Response;
    try {
      resp = await opts.fetch(`${base}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${opts.secret}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = (err as Error)?.name ?? '';
      const code = name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
      const message = (err as Error)?.message ?? String(err);
      return { ok: false, status: 0, code, error: datumFailureSentence(0, code, message, projectCode) };
    }
    const payload = (await resp.json().catch(() => null)) as ({ ok?: boolean; code?: string; error?: string } & T) | null;
    if (!resp.ok || !payload || payload.ok !== true) {
      const code = payload?.code ?? `HTTP_${resp.status}`;
      const error = payload?.error ?? resp.statusText ?? '';
      return { ok: false, status: resp.status, code, error: datumFailureSentence(resp.status, code, error, projectCode) };
    }
    return { ok: true, data: payload as T };
  }

  const q = (code: string) => `project_code=${encodeURIComponent(code)}`;
  return {
    getAreas: (code) => call<DatumAreasReply>('GET', `areas?${q(code)}`, undefined, code),
    getGateStatus: (code) => call<DatumGateStatusReply>('GET', `gate-status?${q(code)}`, undefined, code),
    postAreas: (code, areas) => call<DatumPostAreasReply>('POST', 'areas', { project_code: code, areas }, code),
    getStaff: () => call<DatumStaffReply>('GET', 'staff', undefined),
    escalate: (body) => call<DatumEscalateReply>('POST', 'escalate', body, body.project_code),
  };
}
