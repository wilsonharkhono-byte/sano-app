// SANO — Tambah material proyek: client half of migration 095.
//
// Spec: docs/superpowers/specs/2026-09-02-add-project-material-line-design.md
//
// The server RPC add_project_material_line is the authority. This module
// (1) mirrors its guards so the form can refuse before a round trip,
// (2) maps its RAISE prefixes to Indonesian copy, (3) wraps the RPC with a
// minimal injected client so it is testable without supabase-js, and
// (4) detects incrementally-added materials that a staged re-publish workbook
// omits — publish rebuilds the plan from the file, so those would vanish.
// No React, no direct supabase import.

export type AddLineErrorCode =
  | 'ADD_LINE_AUTH'
  | 'ADD_LINE_NO_MASTER'
  | 'ADD_LINE_MATERIAL'
  | 'ADD_LINE_ASSET'
  | 'ADD_LINE_TIER1'
  | 'ADD_LINE_UNIT'
  | 'ADD_LINE_EXISTS'
  | 'ADD_LINE_QTY'
  | 'ADD_LINE_PRICE_REQUIRED'
  | 'ADD_LINE_PRICE'
  | 'ADD_LINE_RACE'
  | 'ADD_LINE_PUBLISH_IN_PROGRESS';

/** Indonesian copy per server prefix (spec §4.2). */
export const ADD_LINE_MESSAGES: Record<AddLineErrorCode, string> = {
  ADD_LINE_AUTH: 'Hanya estimator/admin yang dapat menambah material proyek.',
  ADD_LINE_NO_MASTER: 'Proyek belum dipublish. Gunakan Publish untuk rencana pertama.',
  ADD_LINE_MATERIAL: 'Material tidak ditemukan di katalog.',
  ADD_LINE_ASSET: 'Alat/aset dicatat di tab Alat, bukan di rencana material.',
  ADD_LINE_TIER1: 'Material Tier 1 harus lewat file SANO Input (butuh area kerja).',
  ADD_LINE_UNIT: 'Satuan material di katalog kosong. Perbaiki katalog dulu.',
  ADD_LINE_EXISTS: 'Material sudah ada di rencana. Ubah jumlah lewat re-publish.',
  ADD_LINE_QTY: 'Jumlah rencana harus lebih dari 0.',
  ADD_LINE_PRICE_REQUIRED: 'Tier 3 adalah anggaran Rupiah: harga satuan wajib diisi.',
  ADD_LINE_PRICE: 'Harga satuan harus lebih dari 0.',
  ADD_LINE_RACE: 'Rencana proyek berubah saat menyimpan (ada publish lain). Coba lagi.',
  ADD_LINE_PUBLISH_IN_PROGRESS: 'Ada publish yang sedang berjalan atau terputus untuk proyek ini. Selesaikan atau ulangi publish dari file master, lalu coba lagi.',
};

const ERROR_CODES = Object.keys(ADD_LINE_MESSAGES) as AddLineErrorCode[];

/** Name of the partial unique index created by 095 §1. */
export const PROJECT_LEVEL_LINE_INDEX = 'uq_pmml_project_level_material';

export interface AddLineInput {
  materialId: string | null;
  tier: number | null;
  isAsset: boolean;
  unit: string | null;
  /** Parsed number; NaN or null means "not a valid number". */
  plannedQty: number | null;
  /** null = not provided; NaN = provided but unparseable. */
  unitPrice: number | null;
}

export type AddLineValidation =
  | { ok: true }
  | { ok: false; code: AddLineErrorCode; message: string };

function fail(code: AddLineErrorCode): AddLineValidation {
  return { ok: false, code, message: ADD_LINE_MESSAGES[code] };
}

/**
 * Client twin of the server guards, in the server's order, so the form shows
 * the same reason the RPC would. Access, master, and race checks are server-only.
 */
export function validateAddLineInput(input: AddLineInput): AddLineValidation {
  if (!input.materialId) return fail('ADD_LINE_MATERIAL');
  if (input.isAsset) return fail('ADD_LINE_ASSET');
  if (input.tier === 1) return fail('ADD_LINE_TIER1');
  if (!input.unit || input.unit.trim() === '') return fail('ADD_LINE_UNIT');
  if (input.plannedQty == null || !Number.isFinite(input.plannedQty) || input.plannedQty <= 0) {
    return fail('ADD_LINE_QTY');
  }
  if (input.tier === 3 && input.unitPrice == null) return fail('ADD_LINE_PRICE_REQUIRED');
  if (input.unitPrice != null && (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0)) {
    return fail('ADD_LINE_PRICE');
  }
  return { ok: true };
}

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(err);
}

/**
 * Prefix → copy. A unique-index violation is the concurrent-add case and reads
 * as ADD_LINE_EXISTS. Anything unrecognized is returned verbatim — never swallowed.
 */
export function mapAddLineError(err: unknown): string {
  const raw = messageOf(err);
  if (raw.includes(PROJECT_LEVEL_LINE_INDEX)) return ADD_LINE_MESSAGES.ADD_LINE_EXISTS;
  for (const code of ERROR_CODES) {
    if (raw.includes(`${code}:`)) return ADD_LINE_MESSAGES[code];
  }
  return raw;
}

export interface AddProjectMaterialLineResult {
  line_id: string;
  revision_id: string;
  master_id: string;
  material_name: string;
  unit: string;
  tier: number;
  planned_after: number;
  price_book_written: 'inserted' | 'updated' | 'skipped';
  snapshot_written: boolean;
  /** false when notify_plan_revised failed server-side (non-fatal); tell supervisors directly. */
  notified: boolean;
}

export interface AddProjectMaterialLineParams {
  projectId: string;
  materialId: string;
  plannedQty: number;
  unitPrice: number | null;
  note: string | null;
}

/** The slice of supabase-js this module needs; tests pass a stub. */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function addProjectMaterialLine(
  client: RpcClient,
  params: AddProjectMaterialLineParams,
): Promise<AddProjectMaterialLineResult> {
  const { data, error } = await client.rpc('add_project_material_line', {
    p_project_id: params.projectId,
    p_material_id: params.materialId,
    p_planned_qty: params.plannedQty,
    p_unit_price: params.unitPrice ?? null,
    p_note: params.note ?? null,
  });
  if (error) throw error;
  return data as AddProjectMaterialLineResult;
}

export interface IncrementalAddMissing {
  material_id: string;
  material_name: string;
}

/**
 * From plan_revisions rows (any shape), pick the INCREMENTAL_ADD ones whose
 * material is absent from the staged workbook's resolved material ids.
 * Deduplicated by material id, in first-seen order. Non-incremental or
 * malformed summaries are ignored.
 */
export function findIncrementalAddsMissingFromStaging(
  revisions: ReadonlyArray<{ summary: unknown }>,
  stagedMaterialIds: Iterable<string>,
): IncrementalAddMissing[] {
  const staged = new Set(stagedMaterialIds);
  const seen = new Set<string>();
  const missing: IncrementalAddMissing[] = [];
  for (const rev of revisions) {
    const s = rev.summary as { kind?: unknown; material_id?: unknown; material_name?: unknown } | null;
    if (!s || s.kind !== 'INCREMENTAL_ADD') continue;
    const id = typeof s.material_id === 'string' ? s.material_id : null;
    if (!id || staged.has(id) || seen.has(id)) continue;
    seen.add(id);
    missing.push({
      material_id: id,
      material_name: typeof s.material_name === 'string' && s.material_name ? s.material_name : id,
    });
  }
  return missing;
}
