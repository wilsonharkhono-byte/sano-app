// SAN Contractor — Baseline Import & Management Service
// Phase 2: BoQ/AHS import pipeline, staging, review, and publish

import { supabase } from './supabase';
import { BaselineReviewStatus, AnomalyResolution } from './constants';

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
  parserVersion: 'v1' | 'v2' = 'v1',
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
  let query = supabase
    .from('import_staging_rows')
    .select('*')
    .eq('session_id', sessionId)
    .order('row_number');

  if (options?.needsReview !== undefined) {
    query = query.eq('needs_review', options.needsReview);
  }
  if (options?.rowType) {
    query = query.eq('row_type', options.rowType);
  }

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
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
  tier: 1 | 2 | 3;
  usage_rate: number;
  unit: string;
  waste_factor: number;
}

export interface ParsedMaterialRow {
  code: string;
  name: string;
  category: string;
  tier: 1 | 2 | 3;
  unit: string;
  supplier_unit?: string;
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

function normalizeMaterialKey(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

// ─── Excel Parse & Stage (Phase 2b) ──────────────────────────────────

import {
  parseBoqWorkbook,
  convertToStagingRows,
  reconcileMaterials,
  applyBoqGrouping,
  type ParsedWorkbook,
  type CatalogEntry,
} from './excelParser';
import { applyAIBoqGrouping } from './ai-assist';
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
      const { parseBoqV2 } = await import('./boqParserV2');
      // Task 22 bug fix: previously a string fileInput was coerced to an
      // empty ArrayBuffer, which made v2 silently parse nothing. Resolve
      // the path the same way v1 would (read local file into memory).
      const v2Buffer = await resolveFileInput(fileInput);
      const v2Result = await parseBoqV2(v2Buffer);
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

    // 1. Parse the workbook
    const parsed = parseBoqWorkbook(fileInput, fileName);

    // 1b. AI-driven BoQ grouping (consolidates granular items into broader categories)
    try {
      await applyAIBoqGrouping(parsed);
    } catch {
      // If AI grouping fails entirely, apply keyword fallback
      applyBoqGrouping(parsed);
    }

    // 2. Load material catalog for reconciliation
    const { data: catalogData, error: catalogError } = await supabase
      .from('material_catalog')
      .select('id, code, name, category, tier, unit');
    if (catalogError) {
      throw new Error(`Gagal membaca material catalog: ${catalogError.message}`);
    }

    const catalog: CatalogEntry[] = (catalogData ?? []).map(m => ({
      code: m.code ?? '',
      name: m.name,
      category: m.category ?? '',
      tier: m.tier as 1 | 2 | 3,
      unit: m.unit,
      aliases: [],
    }));

    // Load aliases
    const { data: aliasData, error: aliasError } = await supabase
      .from('material_aliases')
      .select('alias, material_id, material_catalog!inner(code)');
    if (aliasError) {
      throw new Error(`Gagal membaca material aliases: ${aliasError.message}`);
    }
    const aliasMap = new Map<string, string>();
    for (const a of aliasData ?? []) {
      const code = (a as unknown as { material_catalog?: { code: string } }).material_catalog?.code;
      if (code) aliasMap.set(a.alias.toLowerCase().trim(), code);
    }

    // 3. Reconcile materials
    const { resolved, unresolved } = reconcileMaterials(
      parsed.materials,
      catalog,
      aliasMap,
    );
    parsed.materials = [...resolved, ...unresolved];

    // Collapse all unresolved materials into a single summary anomaly.
    // Each unresolved row already got a deterministic AUTO-* code from
    // autoMaterialCode(), so publish will succeed without per-row action.
    // We still surface the list so the estimator can sanity-check new
    // catalog entries in one click instead of 50+.
    if (unresolved.length > 0) {
      const preview = unresolved.slice(0, 5).map(m => m.name).join(', ');
      const more = unresolved.length > 5 ? `, +${unresolved.length - 5} more` : '';
      parsed.anomalies.push({
        type: 'unresolved_material',
        severity: 'WARNING',
        sourceSheet: 'Material',
        sourceRow: unresolved[0].rowNumber,
        description: `${unresolved.length} materi baru akan ditambahkan ke katalog dengan kode otomatis saat publish: ${preview}${more}`,
        expectedValue: 'Known material codes',
        actualValue: `${unresolved.length} new materials`,
        context: {
          count: unresolved.length,
          materials: unresolved.map(m => ({
            name: m.name,
            code: m.resolvedCode,
            unit: m.unit,
            unitPrice: m.unitPrice,
            rowNumber: m.rowNumber,
          })),
        },
      });
    }

    // 4. Convert to staging rows
    const stagingRows = convertToStagingRows(parsed);

    // 5. Insert staging rows
    await updateImportStatus(sessionId, 'STAGING');
    const insertedCount = await insertStagingRows(sessionId, stagingRows);

    // 6. Insert anomalies
    if (parsed.anomalies.length > 0) {
      const anomalyRecords = parsed.anomalies.map(a => ({
        session_id: sessionId,
        anomaly_type: a.type,
        severity: a.severity,
        source_sheet: a.sourceSheet,
        source_row: a.sourceRow,
        description: a.description,
        expected_value: a.expectedValue,
        actual_value: a.actualValue,
        context: a.context,
        resolution: AnomalyResolution.PENDING,
      }));

      const { error: anomalyError } = await supabase.from('import_anomalies').insert(anomalyRecords);
      if (anomalyError) {
        throw new Error(`Gagal menyimpan anomali parser: ${anomalyError.message}`);
      }
    }

    // 7. Update session to REVIEW
    await updateImportStatus(sessionId, 'REVIEW');

    return {
      success: true,
      parsed,
      stagingRowCount: insertedCount,
      anomalyCount: parsed.anomalies.length,
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
): Promise<{ success: boolean; error?: string; boqCount?: number; ahsCount?: number; materialCount?: number }> {
  try {
    const { data: session } = await supabase
      .from('import_sessions')
      .select('parser_version')
      .eq('id', sessionId)
      .single();
    if (session?.parser_version === 'v2') {
      const { publishBaselineV2 } = await import('./publishBaselineV2');
      return publishBaselineV2(sessionId, projectId);
    }

    // 1. Get all approved staging rows
    const rows = await getStagingRows(sessionId);
    const approved = rows.filter(r =>
      r.review_status === BaselineReviewStatus.APPROVED
      || r.review_status === BaselineReviewStatus.MODIFIED
      || (!r.needs_review && r.review_status === BaselineReviewStatus.PENDING)
    );

    if (approved.length === 0) {
      return { success: false, error: 'No approved rows to publish' };
    }

    const boqRows = approved.filter(r => r.row_type === 'boq');
    const ahsRows = approved.filter(r => r.row_type === 'ahs');
    const materialRows = approved.filter(r => r.row_type === 'material');
    const parsedMaterialRows = materialRows.map(r => r.parsed_data as ParsedMaterialRow);
    const parsedAhsRows = ahsRows.map(r => r.parsed_data as ParsedAhsRow);

    // 2. Upsert BoQ items (with extended fields from parser)
    // This allows republishing into a seeded/existing project baseline
    // without violating the (project_id, code) unique constraint.
    let boqCount = 0;
    if (boqRows.length > 0) {
      const boqRecords = boqRows.map(r => {
        const p = r.parsed_data as ParsedBoqRow;
        const raw = r.raw_data as Record<string, unknown>;
        return {
          project_id: projectId,
          code: p.code,
          label: p.label,
          unit: p.unit,
          planned: p.planned,
          parent_code: (raw.parentCode as string) ?? null,
          chapter: (raw.chapter as string) ?? null,
          sort_order: (raw.sortOrder as number) ?? 0,
          element_code: (raw.elementCode as string) ?? null,
          composite_factors: raw.compositeFactors ?? null,
          cost_breakdown: raw.costBreakdown ?? null,
          client_unit_price: (raw.clientUnitPrice as number) ?? null,
          internal_unit_price: (raw.internalUnitPrice as number) ?? null,
        };
      });

      const { error: boqErr } = await supabase
        .from('boq_items')
        .upsert(boqRecords, { onConflict: 'project_id,code' });
      if (boqErr) return { success: false, error: `BoQ upsert failed: ${boqErr.message}` };
      boqCount = boqRecords.length;
    }

    // 3. Insert materials
    let materialCount = 0;
    if (parsedMaterialRows.length > 0) {
      const missingCodes = parsedMaterialRows.filter(p => !p.code?.trim());
      if (missingCodes.length > 0) {
        return { success: false, error: 'Material master import requires Kode Material on every material row' };
      }

      const matRecords = parsedMaterialRows.map(p => {
        const supplierUnit = p.supplier_unit?.trim() || p.unit;
        return {
          code: p.code.trim().toUpperCase(),
          name: p.name,
          category: p.category,
          tier: p.tier,
          unit: p.unit,
          supplier_unit: supplierUnit,
        };
      });

      const { error: matErr } = await supabase
        .from('material_catalog')
        .upsert(matRecords, { onConflict: 'code' });
      if (matErr) return { success: false, error: `Material insert failed: ${matErr.message}` };
      materialCount = matRecords.length;
    }

    const { data: materialCatalog, error: materialLookupErr } = await supabase
      .from('material_catalog')
      .select('id, code, name, category, tier, unit, supplier_unit');

    if (materialLookupErr) {
      return { success: false, error: `Material lookup failed: ${materialLookupErr.message}` };
    }

    const materialByCode = new Map(
      (materialCatalog ?? [])
        .filter(m => m.code)
        .map(m => [normalizeMaterialKey(m.code), m]),
    );
    const materialByName = new Map(
      (materialCatalog ?? []).map(m => [normalizeMaterialKey(m.name), m]),
    );

    // 4. Create AHS version and lines
    let ahsCount = 0;
    if (parsedAhsRows.length > 0) {
      const { data: latestAhsVersion, error: latestAhsVersionErr } = await supabase
        .from('ahs_versions')
        .select('version')
        .eq('project_id', projectId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestAhsVersionErr) {
        return { success: false, error: `AHS version lookup failed: ${latestAhsVersionErr.message}` };
      }

      const nextAhsVersion = (latestAhsVersion?.version ?? 0) + 1;

      // Create AHS version
      const { data: ahsVersion, error: ahsVerErr } = await supabase
        .from('ahs_versions')
        .insert({ project_id: projectId, version: nextAhsVersion })
        .select()
        .single();

      if (ahsVerErr || !ahsVersion) {
        return { success: false, error: `AHS version creation failed: ${ahsVerErr?.message}` };
      }

      // Resolve BoQ IDs by code
      const { data: projectBoqs } = await supabase
        .from('boq_items')
        .select('id, code')
        .eq('project_id', projectId);

      const boqCodeMap = new Map((projectBoqs ?? []).map(b => [b.code, b.id]));
      const unresolvedMaterials: string[] = [];

      // Also get raw_data for extended AHS fields
      const ahsRawDataMap = new Map(
        ahsRows.map(r => [r.row_number, r.raw_data as Record<string, unknown>]),
      );

      const ahsRecords = parsedAhsRows
        .map((p, idx) => {
          const boqItemId = boqCodeMap.get(p.boq_code);
          if (!boqItemId) return null;

          const raw = ahsRawDataMap.get(ahsRows[idx]?.row_number) ?? {};
          const lineType = (raw.lineType as string) ?? 'material';

          // For labor/equipment lines, material_id is null
          let materialId: string | null = null;
          if (lineType === 'material') {
            const resolvedMaterial =
              (p.material_code ? materialByCode.get(normalizeMaterialKey(p.material_code)) : null) ??
              materialByName.get(normalizeMaterialKey(p.material_name));
            if (!resolvedMaterial) {
              unresolvedMaterials.push(`${p.boq_code}: ${p.material_code ?? p.material_name}`);
              return null;
            }
            materialId = resolvedMaterial.id;
          }

          return {
            ahs_version_id: ahsVersion.id,
            boq_item_id: boqItemId,
            material_id: materialId,
            material_spec: p.material_spec,
            tier: p.tier,
            usage_rate: p.usage_rate,
            unit: p.unit,
            waste_factor: p.waste_factor,
            line_type: lineType,
            coefficient: (raw.coefficient as number) ?? p.usage_rate,
            unit_price: (raw.unitPrice as number) ?? 0,
            description: lineType !== 'material' ? p.material_name : null,
            ahs_block_title: (raw.ahsBlockTitle as string) ?? null,
            source_row: (raw.sourceRow as number) ?? null,
          };
        })
        .filter(Boolean);

      if (unresolvedMaterials.length > 0) {
        console.warn(`AHS: ${unresolvedMaterials.length} unresolved material references (non-blocking, flagged for review):`,
          unresolvedMaterials.slice(0, 5));
      }

      if (ahsRecords.length > 0) {
        const { error: ahsLineErr } = await supabase.from('ahs_lines').insert(ahsRecords);
        if (ahsLineErr) return { success: false, error: `AHS lines insert failed: ${ahsLineErr.message}` };
        ahsCount = ahsRecords.length;
      }
    }

    // 5. Mark session as published
    await updateImportStatus(sessionId, 'PUBLISHED');

    return { success: true, boqCount, ahsCount, materialCount };
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
    // Get latest AHS version for project
    const { data: ahsVersion } = await supabase
      .from('ahs_versions')
      .select('id')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (!ahsVersion) return { success: false, error: 'No AHS version found for project' };

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
      planned_quantity: (line as unknown as { boq_items: { planned: number } }).boq_items.planned * line.usage_rate * (1 + (line.waste_factor || 0)),
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
      .order('version', { ascending: false })
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
