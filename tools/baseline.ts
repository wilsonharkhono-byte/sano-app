// SAN Contractor — Baseline Import & Management Service
// Phase 2: BoQ/AHS import pipeline, staging, review, and publish

import { supabase } from './supabase';
import { BaselineReviewStatus, AnomalyResolution } from './constants';
import { fetchAllPaged } from './queryHelpers';

/**
 * Resolve a file input to an ArrayBuffer for parsers that can't read paths.
 *
 * v1's parser (`parseBoqWorkbook`) accepts a string path directly and lets
 * `XLSX.readFile` handle it. v2's parser only accepts `Buffer | ArrayBuffer`,
 * so when the dispatcher receives a string path we must read it into memory
 * ourselves before handing it off.
 *
 * The string-path branch only fires in Node tests/CLI — React Native always
 * hands an ArrayBuffer (from storage download or document picker). We hide
 * the `fs` require from Metro's static analyzer so the RN bundle stays
 * resolvable; the require never executes at runtime in RN because the
 * typeof check short-circuits first.
 */
async function resolveFileInput(
  fileInput: ArrayBuffer | string,
): Promise<ArrayBuffer> {
  if (typeof fileInput !== 'string') return fileInput;
  // eslint-disable-next-line no-eval
  const nodeRequire: NodeRequire = eval('require');
  const fs = nodeRequire('fs') as typeof import('fs');
  const buf = await fs.promises.readFile(fileInput);
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}
import type {
  ImportSession,
  ImportStagingRow,
  BoqItem,
  AhsLine,
  Material,
  MaterialSpec,
  ProjectMaterialMaster,
  ProjectMaterialMasterLine,
} from './types';

// ─── Import Session Management ────────────────────────────────────────

export async function createImportSession(
  projectId: string,
  userId: string,
  filePath: string,
  fileName: string,
  parserVersion: 'v1' | 'v2' = 'v2',
): Promise<{ session: ImportSession | null; error: string | null }> {
  const { data, error } = await supabase
    .from('import_sessions')
    .insert({
      project_id: projectId,
      uploaded_by: userId,
      original_file_path: filePath,
      original_file_name: fileName,
      parser_version: parserVersion,
      status: 'UPLOADED',
    })
    .select()
    .single();

  if (error) {
    console.warn('Create import session error:', error.message);
    return {
      session: null,
      error: error.message,
    };
  }
  return {
    session: data,
    error: null,
  };
}

export async function getImportSession(sessionId: string): Promise<ImportSession | null> {
  const { data, error } = await supabase
    .from('import_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error) return null;
  return data;
}

export async function getProjectImportSessions(projectId: string): Promise<ImportSession[]> {
  const { data, error } = await supabase
    .from('import_sessions')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) return [];
  return data ?? [];
}

export async function deleteImportSession(
  session: ImportSession,
): Promise<{ success: boolean; error?: string }> {
  if (session.status === 'PUBLISHED') {
    return {
      success: false,
      error: 'Baseline yang sudah dipublish tidak bisa dihapus dari layar import.',
    };
  }

  if (
    session.original_file_path &&
    !session.original_file_path.startsWith('local-import://')
  ) {
    const { error: storageError } = await supabase
      .storage
      .from('project-files')
      .remove([session.original_file_path]);

    if (storageError) {
      console.warn('Delete baseline source file warning:', storageError.message);
    }
  }

  const { error } = await supabase
    .from('import_sessions')
    .delete()
    .eq('id', session.id);

  if (error) {
    return {
      success: false,
      error: error.message,
    };
  }

  return { success: true };
}

export async function updateImportStatus(
  sessionId: string,
  status: ImportSession['status'],
  errorMessage?: string,
): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (errorMessage) update.error_message = errorMessage;
  if (status === 'PUBLISHED') update.published_at = new Date().toISOString();

  await supabase.from('import_sessions').update(update).eq('id', sessionId);
}

// ─── Staging Row Management ───────────────────────────────────────────

export async function insertStagingRows(
  sessionId: string,
  rows: Array<{
    row_number: number;
    row_type: ImportStagingRow['row_type'];
    raw_data: object;
    parsed_data: object | null;
    confidence: number;
    needs_review: boolean;
  }>,
): Promise<number> {
  const records = rows.map(r => ({
    session_id: sessionId,
    row_number: r.row_number,
    row_type: r.row_type,
    raw_data: r.raw_data,
    parsed_data: r.parsed_data,
    confidence: r.confidence,
    needs_review: r.needs_review,
    review_status: BaselineReviewStatus.PENDING,
  }));

  const { error, count } = await supabase
    .from('import_staging_rows')
    .insert(records);

  if (error) {
    throw new Error(`Gagal menyimpan staging rows: ${error.message}`);
  }
  return count ?? rows.length;
}

export async function getStagingRows(
  sessionId: string,
  options?: { needsReview?: boolean; rowType?: string },
): Promise<ImportStagingRow[]> {
  // A single unpaginated select silently truncates at Supabase's 1000-row
  // cap — for a large multi-building baseline the Audit Trace pivot would
  // undercount without any error. Page through all rows instead. fetchAllPaged
  // throws on a query error rather than swallowing it as an empty session
  // (see below — this used to `if (error) return []`).
  return fetchAllPaged<ImportStagingRow>((from, to) => {
    let query = supabase
      .from('import_staging_rows')
      .select('*')
      .eq('session_id', sessionId);

    if (options?.needsReview !== undefined) {
      query = query.eq('needs_review', options.needsReview);
    }
    if (options?.rowType) {
      query = query.eq('row_type', options.rowType);
    }

    return query.order('row_number').range(from, to) as unknown as PromiseLike<{
      data: ImportStagingRow[] | null;
      error: { message?: string } | null;
    }>;
  });
}

export async function reviewStagingRow(
  rowId: string,
  status: 'APPROVED' | 'REJECTED' | 'MODIFIED',
  notes?: string,
  modifiedData?: object,
): Promise<void> {
  const update: Record<string, unknown> = {
    review_status: status,
    reviewer_notes: notes ?? null,
  };
  if (modifiedData) update.parsed_data = modifiedData;

  await supabase.from('import_staging_rows').update(update).eq('id', rowId);
}

/**
 * Approve/reject many staging rows in one round-trip. Used by the
 * exception-based review flow to clear all clean (high-confidence,
 * non-flagged) rows at once instead of one server call per row.
 */
export async function bulkReviewStagingRows(
  rowIds: string[],
  status: 'APPROVED' | 'REJECTED',
): Promise<{ success: boolean; error?: string; count: number }> {
  if (rowIds.length === 0) return { success: true, count: 0 };
  const { error } = await supabase
    .from('import_staging_rows')
    .update({ review_status: status })
    .in('id', rowIds);
  if (error) return { success: false, error: error.message, count: 0 };
  return { success: true, count: rowIds.length };
}

/**
 * Audit-trace edits update both parsed_data and raw_data and auto-mark the
 * row as MODIFIED. publishBaseline reads coefficient/unit_price from raw_data
 * first, so writes to coefficient-family fields must land in both places.
 */
export async function updateStagingRowAudit(
  rowId: string,
  parsedData: object,
  rawData: object,
  notes?: string,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('import_staging_rows')
    .update({
      parsed_data: parsedData,
      raw_data: rawData,
      review_status: BaselineReviewStatus.MODIFIED,
      reviewer_notes: notes ?? 'Audit trace edit',
    })
    .eq('id', rowId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Insert a single new AHS staging row from the audit trace screen.
 * Used when the estimator adds a missing AHS component to an existing BoQ.
 */
export async function insertAuditAhsRow(
  sessionId: string,
  rowNumber: number,
  parsedData: ParsedAhsRow,
  rawData: object,
): Promise<{ success: boolean; row?: ImportStagingRow; error?: string }> {
  const { data, error } = await supabase
    .from('import_staging_rows')
    .insert({
      session_id: sessionId,
      row_number: rowNumber,
      row_type: 'ahs',
      raw_data: rawData,
      parsed_data: parsedData,
      confidence: 1,
      needs_review: false,
      review_status: BaselineReviewStatus.MODIFIED,
      reviewer_notes: 'Added via audit trace',
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, row: data as ImportStagingRow };
}

/**
 * Hard-delete a staging row from the audit trace screen. Only safe during
 * REVIEW phase — nothing references staging rows from outside the session.
 */
export async function deleteStagingRow(
  rowId: string,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('import_staging_rows')
    .delete()
    .eq('id', rowId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Parsing Helpers ──────────────────────────────────────────────────

export interface ParsedBoqRow {
  code: string;
  label: string;
  unit: string;
  planned: number;
}

export interface ParsedAhsRow {
  boq_code: string;
  material_code?: string | null;
  material_name: string;
  material_spec: string | null;
  // NOT 1|2|3|4: this feeds ahs_lines eventually, whose tier CHECK is still
  // (1,2,3) — see tools/types.ts AhsLine.tier for the full DB-scope note.
  // determineTier() (excelParser.ts) never returns 4 either, so this stays
  // accurate to what the parser actually produces.
  tier: 1 | 2 | 3;
  usage_rate: number;
  unit: string;
  waste_factor: number;
}

export interface ParsedMaterialRow {
  code: string;
  name: string;
  category: string;
  // material_catalog.tier allows 4 (untracked consumable) since migration
  // 047_material_tier_budget_control.sql.
  tier: 1 | 2 | 3 | 4;
  unit: string;
  supplier_unit?: string;
  /** Base units per ONE supplier_unit (kg per batang for rebar). null = 1:1. */
  base_qty_per_supplier_unit?: number | null;
  reference_unit_price?: number | null;
  aliases?: string[];
}

/**
 * Score confidence of a parsed row based on completeness.
 * Returns 0.0 - 1.0 where < 0.7 flags for review.
 */
export function scoreConfidence(parsed: Record<string, unknown>, requiredKeys: string[]): number {
  if (!parsed) return 0;
  let filled = 0;
  for (const key of requiredKeys) {
    const val = parsed[key];
    if (val !== null && val !== undefined && val !== '') filled++;
  }
  return requiredKeys.length > 0 ? filled / requiredKeys.length : 0;
}

const REVIEW_THRESHOLD = 0.7;

export function needsReview(confidence: number): boolean {
  return confidence < REVIEW_THRESHOLD;
}

// ─── Excel Parse & Stage (Phase 2b) ──────────────────────────────────

import { type ParsedWorkbook } from './excelParser';
import { parseBoqV2 } from './boqParserV2';
import { detectBoqSheetOptionFromBuffer } from './boqParserV2/multiSheetScanner';
import { publishBaselineV2, type RevisionContext } from './publishBaselineV2';
import { isSimplifiedInputWorkbook, parseSimplifiedInput } from './simplifiedInput';
import type { StagingRowV2, ValidationReport } from './boqParserV2/types';
import type { ImportAnomaly } from './types';

/**
 * Parse an uploaded Excel BoQ file and populate staging rows + anomalies.
 * This is the orchestrator that connects upload → parse → stage → review.
 *
 * Flow:
 *   1. Read the Excel file (buffer or path)
 *   2. Parse all sheets (RAB, Analisa, Material, Upah)
 *   3. Reconcile materials against the global catalog
 *   4. Convert to staging rows
 *   5. Insert staging rows into the database
 *   6. Insert detected anomalies
 *   7. Update session status to REVIEW
 *
 * Returns the parsed workbook for inspection and the anomaly count.
 */
export async function parseAndStageWorkbook(
  sessionId: string,
  projectId: string,
  fileInput: ArrayBuffer | string,
  fileName: string,
): Promise<{
  success: boolean;
  error?: string;
  parsed?: ParsedWorkbook;
  stagingRowCount?: number;
  anomalyCount?: number;
}> {
  try {
    // Mark session as parsing
    await updateImportStatus(sessionId, 'PARSING');

    // v2 dispatch — if the session is tagged parser_version='v2', use the
    // new parser. v1 path is untouched.
    const { data: sessionRow } = await supabase
      .from('import_sessions')
      .select('parser_version')
      .eq('id', sessionId)
      .single();
    if (sessionRow?.parser_version === 'v2') {
      // Task 22 bug fix: previously a string fileInput was coerced to an
      // empty ArrayBuffer, which made v2 silently parse nothing. Resolve
      // the path the same way v1 would (read local file into memory).
      const v2Buffer = await resolveFileInput(fileInput);
      // Simplified "SANO Input" two-sheet format (Tier-1 work-group matrix +
      // tiered Others list) — an alternative to full RAB parsing. Detected by
      // its exact sheet names; emits the same { stagingRows, validationReport }
      // the rest of this function consumes. See
      // docs/superpowers/specs/2026-07-14-simplified-boq-input-parser-design.md
      let v2Result: { stagingRows: StagingRowV2[]; validationReport: ValidationReport };
      if (isSimplifiedInputWorkbook(v2Buffer)) {
        // Tier-2/3 "Others" are staged as project-level material rows (no BoQ
        // relation) and reconciled to the catalogue at publish; they are never
        // flagged/blocked here (file wins), so nothing can silently drop them.
        v2Result = parseSimplifiedInput(v2Buffer);
      } else {
        // Default ingest is single-sheet `RAB (A)` (unchanged). Add-on rule: a
        // multi-building workbook whose materials span `RAB (B)`…`RAB (E)`
        // (e.g. Nusa Golf) is detected from its sheet-tagged breakdown sheets and
        // parsed across all RAB sheets, so its materials aren't lost. See
        // detectBoqSheetOption.
        const boqSheet = detectBoqSheetOptionFromBuffer(v2Buffer);
        v2Result = await parseBoqV2(v2Buffer, { boqSheet });
      }
      // Insert v2 staging rows with the new fields populated.
      const inserts = v2Result.stagingRows.map(r => ({
        session_id: sessionId,
        row_number: r.row_number,
        row_type: r.row_type,
        raw_data: r.raw_data,
        parsed_data: r.parsed_data,
        needs_review: r.needs_review,
        confidence: r.confidence,
        review_status: r.review_status,
        cost_basis: r.cost_basis,
        parent_ahs_staging_id: null, // post-fixed below after rows have UUIDs
        ref_cells: r.ref_cells,
        cost_split: r.cost_split,
      }));
      const { data: inserted, error: insErr } = await supabase
        .from('import_staging_rows')
        .insert(inserts)
        .select('id, row_number');
      if (insErr) return { success: false, error: insErr.message };

      // Post-fix: translate `block:<row_number>` synthetic parent keys to
      // real UUIDs now that rows have IDs.
      const uuidByRowNumber = new Map<number, string>();
      for (const ins of inserted ?? []) {
        uuidByRowNumber.set(ins.row_number as number, ins.id as string);
      }
      const parentUpdates: Array<{ id: string; parent_uuid: string }> = [];
      for (let i = 0; i < v2Result.stagingRows.length; i++) {
        const sr = v2Result.stagingRows[i];
        if (sr.cost_basis !== 'nested_ahs' || !sr.parent_ahs_staging_id) continue;
        const m = /^block:(\d+)$/.exec(sr.parent_ahs_staging_id);
        if (!m) continue;
        const parentRow = Number(m[1]);
        const parentUuid = uuidByRowNumber.get(parentRow);
        const childUuid = uuidByRowNumber.get(sr.row_number);
        if (parentUuid && childUuid) {
          parentUpdates.push({ id: childUuid, parent_uuid: parentUuid });
        }
      }
      if (parentUpdates.length > 0) {
        await Promise.all(
          parentUpdates.map(u =>
            supabase
              .from('import_staging_rows')
              .update({ parent_ahs_staging_id: u.parent_uuid })
              .eq('id', u.id),
          ),
        );
      }

      // Persist the v2-only validation_report column with a raw update —
      // updateImportStatus doesn't know about this field, but we still run
      // the status transition through the helper so any side effects
      // (published_at stamping, future notifications) stay consistent.
      await supabase
        .from('import_sessions')
        .update({ validation_report: v2Result.validationReport })
        .eq('id', sessionId);
      await updateImportStatus(sessionId, 'REVIEW');

      return { success: true };
    }

    // Legacy v1 import path removed. All current uploads are tagged
    // parser_version='v2' (see createImportSession default). A non-v2 session
    // can only be abandoned legacy data, so fail loudly instead of running the
    // deleted v1 parse+stage path.
    return {
      success: false,
      error: 'Legacy v1 import path removed — re-upload with the current (v2) parser.',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateImportStatus(sessionId, 'FAILED', msg);
    return { success: false, error: msg };
  }
}

/**
 * Get anomalies for an import session, for review UI.
 */
export async function getImportAnomalies(
  sessionId: string,
  onlyPending = false,
): Promise<ImportAnomaly[]> {
  let query = supabase
    .from('import_anomalies')
    .select('*')
    .eq('session_id', sessionId)
    .order('severity', { ascending: true });

  if (onlyPending) {
    query = query.eq('resolution', AnomalyResolution.PENDING);
  }

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

/**
 * Resolve an anomaly (accept, correct, or dismiss).
 */
export async function resolveAnomaly(
  anomalyId: string,
  resolution: 'ACCEPTED' | 'CORRECTED' | 'DISMISSED',
  resolvedBy: string,
): Promise<void> {
  await supabase.from('import_anomalies').update({
    resolution,
    resolved_by: resolvedBy,
    resolved_at: new Date().toISOString(),
  }).eq('id', anomalyId);
}

// ─── Baseline Publish ─────────────────────────────────────────────────

/**
 * Publish approved staging rows into live project baseline.
 * Creates BoQ items, AHS version + lines, materials, and material master.
 *
 * This is the core publish action — only called after estimator review.
 */
export async function publishBaseline(
  sessionId: string,
  projectId: string,
  options?: { revisionContext?: RevisionContext; ceilingApprovalTaskId?: string },
): Promise<{ success: boolean; error?: string; boqCount?: number; ahsCount?: number; materialCount?: number; masterLineCount?: number; unresolvedComponentCount?: number; skippedZeroPlanned?: string[]; quarantinedRows?: string[]; warnings?: string[]; ceilingApprovalRequired?: boolean }> {
  try {
    const { data: session } = await supabase
      .from('import_sessions')
      .select('parser_version')
      .eq('id', sessionId)
      .single();
    if (session?.parser_version === 'v2') {
      const result = await publishBaselineV2(sessionId, projectId, options);
      // publishBaselineV2 writes the baseline rows but does not touch the
      // session row, and this v2 branch returns before the v1 path's
      // updateImportStatus(...'PUBLISHED') below. Without this, a successfully
      // published v2 session stays 'REVIEW' in the UI and can be re-published,
      // spawning duplicate ahs_versions. Mark it published on success only.
      if (result.success) {
        await updateImportStatus(sessionId, 'PUBLISHED');
      }
      return result;
    }

    // Legacy v1 publish path removed. Only v2 sessions are publishable now;
    // a non-v2 session is abandoned legacy data, so fail loudly.
    return {
      success: false,
      error: 'Legacy v1 publish path removed — re-upload with the current (v2) parser.',
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Material Master Generation ───────────────────────────────────────

/**
 * Generate a project material master from published AHS data.
 * Aggregates planned material quantities per BoQ item across AHS lines.
 */
export async function generateMaterialMaster(
  projectId: string,
): Promise<{ success: boolean; lineCount?: number; error?: string }> {
  try {
    // Get the CURRENT AHS version for project. v2 publishes all write version=1,
    // so ordering by version is a tie that can return a stale, demoted version —
    // filter on is_current (maintained by publish) and break ties by recency.
    const { data: ahsVersion } = await supabase
      .from('ahs_versions')
      .select('id')
      .eq('project_id', projectId)
      .eq('is_current', true)
      .order('published_at', { ascending: false })
      .limit(1)
      .single();

    if (!ahsVersion) return { success: false, error: 'No AHS version found for project' };

    // publishBaselineV2 already builds the per-(BoQ,material) master from the
    // normalized breakdown for v2 sessions. If a master already exists for the
    // current AHS version, do NOT build a second one here — this function uses
    // usage_rate (0 for v2 publishes), which would write a zeroed duplicate
    // master that the work-group envelope then reads ("no baseline").
    const { data: existingMaster } = await supabase
      .from('project_material_master')
      .select('id')
      .eq('project_id', projectId)
      .eq('ahs_version_id', ahsVersion.id)
      .limit(1)
      .maybeSingle();
    if (existingMaster) {
      return { success: true, lineCount: 0 };
    }

    // Get AHS lines with BoQ planned quantities
    const { data: ahsLines } = await supabase
      .from('ahs_lines')
      .select('*, boq_items!inner(planned)')
      .eq('ahs_version_id', ahsVersion.id);

    if (!ahsLines || ahsLines.length === 0) {
      return { success: false, error: 'No AHS lines found' };
    }

    // Create material master header
    const { data: master, error: masterErr } = await supabase
      .from('project_material_master')
      .insert({
        project_id: projectId,
        ahs_version_id: ahsVersion.id,
      })
      .select()
      .single();

    if (masterErr || !master) {
      return { success: false, error: `Master creation failed: ${masterErr?.message}` };
    }

    // Aggregate: for each AHS line, calculate planned_quantity = boq_planned * usage_rate * (1 + waste_factor)
    const masterLines = ahsLines.map((line) => ({
      master_id: master.id,
      material_id: line.material_id,
      boq_item_id: line.boq_item_id,
      planned_quantity: (line as unknown as { boq_items: { planned: number } }).boq_items.planned * (Number((line as { coefficient?: number }).coefficient) || Number(line.usage_rate) || 0) * (1 + (line.waste_factor || 0)),
      unit: line.unit,
    }));

    const { error: linesErr } = await supabase
      .from('project_material_master_lines')
      .insert(masterLines);

    if (linesErr) return { success: false, error: `Master lines insert failed: ${linesErr.message}` };

    return { success: true, lineCount: masterLines.length };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Baseline Query Helpers ───────────────────────────────────────────

export async function getProjectBaseline(projectId: string) {
  const [boqResult, ahsResult, masterResult] = await Promise.all([
    supabase.from('boq_items').select('*').eq('project_id', projectId).order('code'),
    supabase
      .from('ahs_versions')
      .select('*, ahs_lines(*)')
      .eq('project_id', projectId)
      .eq('is_current', true)
      .order('published_at', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('project_material_master')
      .select('*, project_material_master_lines(*)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
  ]);

  return {
    boqItems: boqResult.data ?? [],
    ahsVersion: ahsResult.data ?? null,
    materialMaster: masterResult.data ?? null,
  };
}
