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
  ['CLAIM_PCT', 'Persentase tahap tidak valid.'],
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
