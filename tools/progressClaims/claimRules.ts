// tools/progressClaims/claimRules.ts
// SANO — progress-claim rules shared by the screens and mirrored by the
// migration 104 RPCs (spec §6.2, §18). Pure.
//
// A project has at most one claim in progress (DRAFT, SUBMITTED or RETURNED).
// The supervisor edits DRAFT and RETURNED claims; the estimator or admin
// verifies a SUBMITTED one; the principal only reads. Every percent is per
// stage of the row's stored weights, 0..100 with one decimal.
import { claimDelta, clampPct, rowFraction, type ClaimDelta, type StagePct } from './stageMath';
import { stagesOf, type StageWeights } from './stageWeights';

export const CLAIM_STATUSES = ['DRAFT', 'SUBMITTED', 'RETURNED', 'VERIFIED'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export function isClaimEditable(status: ClaimStatus): boolean {
  return status === 'DRAFT' || status === 'RETURNED';
}

/** Supervisors record progress; estimators and admins may too (they sit on site visits). The principal reads. */
export function canSaveClaimLine(role: string | null | undefined): boolean {
  return role === 'supervisor' || role === 'estimator' || role === 'admin';
}

export function canVerifyClaim(role: string | null | undefined): boolean {
  return role === 'estimator' || role === 'admin';
}

/**
 * Separation of duties: whoever submitted a claim, or filled any of its lines,
 * never verifies it, whatever their role. verify_progress_claim refuses it too.
 */
export function canVerifyClaimAs(
  role: string | null | undefined,
  uid: string | null | undefined,
  submittedBy: string | null | undefined,
  lineAuthors: ReadonlyArray<string | null | undefined> = [],
): boolean {
  return canVerifyClaim(role) && !!uid && uid !== submittedBy && !lineAuthors.includes(uid);
}

export function canEditStageWeights(role: string | null | undefined): boolean {
  return role === 'estimator' || role === 'admin';
}

export type PctValidation = { ok: true; pct: StagePct } | { ok: false; reason: string };

/** Exactly the weights' own stages, each a number 0..100 (one decimal kept). */
export function validateClaimPct(weights: StageWeights, raw: unknown): PctValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'persentase harus berupa objek' };
  const r = raw as Record<string, unknown>;
  const stages = stagesOf(weights);
  const keys = Object.keys(r);
  if (keys.length !== stages.length || !stages.every((s) => keys.includes(s))) {
    return { ok: false, reason: 'isi persentase untuk setiap tahap, tidak lebih' };
  }
  const pct: StagePct = {};
  for (const s of stages) {
    const v = r[s];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) return { ok: false, reason: 'persentase harus angka 0 sampai 100' };
    pct[s] = clampPct(v) as number;
  }
  return { ok: true, pct };
}

/** True when any stage would go below what was already verified. */
export function isRegression(weights: StageWeights, previous: StagePct, next: StagePct): boolean {
  return stagesOf(weights).some((s) => (next[s] ?? 0) < (previous[s] ?? 0));
}

export interface ClaimLineView {
  previousFraction: number;
  claimedFraction: number;
  delta: ClaimDelta;
  regression: boolean;
}

export function claimLineView(weights: StageWeights, previous: StagePct, claimed: StagePct, planned: number): ClaimLineView {
  const previousFraction = rowFraction(weights, previous);
  const claimedFraction = rowFraction(weights, claimed);
  return {
    previousFraction,
    claimedFraction,
    delta: claimDelta(planned, previousFraction, claimedFraction),
    regression: isRegression(weights, previous, claimed),
  };
}

/** Migration 104 raises `CODE: …`; each code maps to one Indonesian sentence. A static test pins both lists together. */
export const CLAIM_RPC_ERROR_COPY: ReadonlyArray<[string, string]> = [
  ['CLAIM_AUTH', 'Anda tidak ditugaskan ke proyek ini.'],
  ['CLAIM_ROLE', 'Peran Anda tidak dapat melakukan aksi ini.'],
  ['CLAIM_NOT_FOUND', 'Klaim tidak ditemukan. Muat ulang halaman.'],
  ['CLAIM_ROW', 'Baris BoQ bukan milik proyek ini atau sudah tidak berlaku.'],
  ['CLAIM_NO_WEIGHTS', 'Bobot tahapan baris ini belum diatur. Minta estimator menerapkan bobot di Baseline.'],
  ['CLAIM_PCT', 'Persentase tahap tidak cocok dengan bobot baris. Buka baris itu dan isi ulang persentasenya.'],
  ['CLAIM_LOCKED', 'Klaim sedang diverifikasi. Tunggu hasilnya sebelum menambah progres.'],
  ['CLAIM_STATE', 'Status klaim sudah berubah. Muat ulang halaman.'],
  ['CLAIM_EMPTY', 'Klaim belum berisi baris progres.'],
  ['CLAIM_REGRESS_REASON', 'Penurunan progres wajib disertai alasan.'],
  ['CLAIM_NO_PLANNED', 'Volume rencana baris ini 0, jadi progresnya tidak bisa diklaim. Minta estimator memeriksa BoQ.'],
  ['CLAIM_EVIDENCE', 'Lampiran foto tidak valid. Ambil ulang fotonya dari aplikasi.'],
  ['CLAIM_RETURN_NOTE', 'Tulis alasan pengembalian klaim.'],
  ['CLAIM_LINES', 'Daftar baris verifikasi tidak cocok dengan klaim. Muat ulang halaman.'],
  ['CLAIM_SELF_VERIFY', 'Klaim yang Anda kirim atau isi sendiri harus diverifikasi estimator atau admin lain.'],
  ['WEIGHTS_INVALID', 'Bobot tahapan tidak valid. Jumlah ketiga tahap harus 100%.'],
  ['WEIGHTS_CLASS', 'Kelas referensi bobot tidak dikenal.'],
  ['WEIGHTS_SHAPE_LOCKED', 'Baris ini sudah punya klaim terverifikasi, jadi jenis bobotnya (satu tahap atau tiga tahap) tidak bisa diubah. Ubah nilainya saja.'],
  ['PROGRESS_SINGLE_WRITER', 'Progres BoQ hanya berubah lewat verifikasi klaim progres.'],
];

export function mapClaimRpcError(message: string | null | undefined): string {
  const text = message ?? '';
  for (const [code, copy] of CLAIM_RPC_ERROR_COPY) {
    if (text.includes(`${code}:`)) return copy;
  }
  return text ? `Gagal menyimpan: ${text}` : 'Gagal menyimpan. Coba lagi.';
}

/** The refusal code in an RPC error message (for example `CLAIM_REGRESS_REASON`), or null. */
export function claimRpcErrorCode(message: string | null | undefined): string | null {
  const text = message ?? '';
  for (const [code] of CLAIM_RPC_ERROR_COPY) {
    if (text.includes(`${code}:`)) return code;
  }
  return null;
}

/**
 * A refused claim RPC. `message` is the Indonesian sentence for the user, led
 * by the BoQ code when the server named one; `code` is the refusal code a
 * screen can act on, `rowCode` that BoQ code, and `detail` the server's text.
 */
export class ClaimRpcError extends Error {
  readonly code: string | null;
  readonly rowCode: string | null;
  readonly detail: string;

  constructor(detail: string | null | undefined) {
    const rowCode = claimRpcRowCode(detail);
    const sentence = mapClaimRpcError(detail);
    super(rowCode ? `${rowCode}: ${sentence}` : sentence);
    this.name = 'ClaimRpcError';
    this.code = claimRpcErrorCode(detail);
    this.rowCode = rowCode;
    this.detail = detail ?? '';
    Object.setPrototypeOf(this, ClaimRpcError.prototype);
  }
}

/** The BoQ code a CLAIM_REGRESS_REASON refusal names (104 raises it with the row code), or null. */
export function regressReasonRowCode(detail: string | null | undefined): string | null {
  const match = /CLAIM_REGRESS_REASON: baris (.+?) turun dari progres terverifikasi/.exec(detail ?? '');
  return match ? match[1] : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The BoQ code a refusal names, as 103 and 104 raise it ("baris T1-003 sudah
 * tidak berlaku"), or null when it names none or only a row id.
 */
export function claimRpcRowCode(detail: string | null | undefined): string | null {
  const match = /\bbaris (\S+) (?:sudah|bukan|belum|adalah|turun|tidak)\b/.exec(detail ?? '');
  if (!match || match[1] === '-' || UUID_RE.test(match[1])) return null;
  return match[1];
}

/** Refusals that mean the screen shows an outdated claim, row or weights: reload it. */
const STALE_CLAIM_CODES: ReadonlySet<string> = new Set([
  'CLAIM_STATE', 'CLAIM_LOCKED', 'CLAIM_NOT_FOUND', 'CLAIM_ROW', 'CLAIM_PCT', 'CLAIM_NO_WEIGHTS', 'CLAIM_NO_PLANNED', 'CLAIM_LINES',
]);

export function isStaleClaimRefusal(code: string | null | undefined): boolean {
  return !!code && STALE_CLAIM_CODES.has(code);
}

interface ClaimStamp { id: string; status: string; submitted_at: string | null; updated_at: string }
interface LineStamp { id: string; updated_at: string }

/**
 * The claim a verifier loaded is no longer the one stored: it stopped waiting
 * for verification, was returned and sent again, or a line changed. Line ids
 * survive edits, so verify_progress_claim alone cannot tell.
 */
export function claimChangedSince(
  loaded: { claim: ClaimStamp; lines: ReadonlyArray<LineStamp> },
  now: { claim: ClaimStamp | null; lines: ReadonlyArray<LineStamp> },
): boolean {
  const claim = now.claim;
  if (!claim || claim.id !== loaded.claim.id || claim.status !== 'SUBMITTED') return true;
  if (claim.submitted_at !== loaded.claim.submitted_at || claim.updated_at !== loaded.claim.updated_at) return true;
  if (now.lines.length !== loaded.lines.length) return true;
  const before = new Map(loaded.lines.map((l) => [l.id, l.updated_at]));
  return now.lines.some((l) => before.get(l.id) !== l.updated_at);
}
