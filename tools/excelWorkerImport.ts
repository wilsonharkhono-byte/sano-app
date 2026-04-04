/**
 * Excel Worker Import
 *
 * Parses an Excel file with worker roster data and upserts into
 * mandor_workers + worker_rates tables.
 *
 * Expected columns:
 *   | Nama Pekerja | Jabatan | Tarif Harian | Berlaku Mulai |
 *   | Budi Santoso | tukang  | 175000       | 2026-04-01    |
 *
 * Column matching is case-insensitive and supports common aliases.
 */

import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import type { SkillLevel, MandorWorker } from './workerRoster';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ParsedWorkerRow {
  rowNumber: number;
  workerName: string;
  skillLevel: SkillLevel;
  dailyRate: number;
  effectiveFrom: string;
  error?: string;
}

export interface WorkerImportResult {
  inserted: number;
  rateUpdated: number;
  unchanged: number;
  errors: Array<{ row: number; message: string }>;
  parsed: ParsedWorkerRow[];
}

// ─── Column Detection ──────────────────────────────────────────────────────

const NAME_ALIASES = ['nama pekerja', 'nama', 'worker name', 'name', 'pekerja'];
const SKILL_ALIASES = ['jabatan', 'skill', 'posisi', 'position', 'level', 'skill level'];
const RATE_ALIASES = ['tarif harian', 'tarif', 'daily rate', 'rate', 'upah', 'harga'];
const DATE_ALIASES = ['berlaku mulai', 'effective from', 'mulai', 'tanggal', 'date', 'effective'];

function matchColumn(header: string, aliases: string[]): boolean {
  const h = header.toLowerCase().trim();
  return aliases.some((a) => h === a || h.includes(a));
}

interface ColumnMap {
  name: number;
  skill: number;
  rate: number;
  date: number;
}

function detectColumns(headers: string[]): ColumnMap | null {
  let name = -1;
  let skill = -1;
  let rate = -1;
  let date = -1;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    if (name < 0 && matchColumn(h, NAME_ALIASES)) name = i;
    else if (skill < 0 && matchColumn(h, SKILL_ALIASES)) skill = i;
    else if (rate < 0 && matchColumn(h, RATE_ALIASES)) rate = i;
    else if (date < 0 && matchColumn(h, DATE_ALIASES)) date = i;
  }

  if (name < 0 || rate < 0) return null; // name and rate are required
  return { name, skill, rate, date };
}

// ─── Skill Level Parsing ───────────────────────────────────────────────────

const SKILL_MAP: Record<string, SkillLevel> = {
  'wakil mandor': 'wakil_mandor',
  'wakil_mandor': 'wakil_mandor',
  'mandor': 'wakil_mandor',
  'tukang': 'tukang',
  'kenek': 'kenek',
  'pekerja': 'kenek',
  'operator': 'operator',
  'lainnya': 'lainnya',
};

function parseSkillLevel(raw: string | undefined | null): SkillLevel {
  if (!raw) return 'lainnya';
  const normalized = raw.toLowerCase().trim();
  return SKILL_MAP[normalized] ?? 'lainnya';
}

// ─── Date Parsing ──────────────────────────────────────────────────────────

function parseDate(raw: unknown): string {
  const today = new Date().toISOString().split('T')[0];
  if (!raw) return today;

  // Excel serial number
  if (typeof raw === 'number') {
    const date = XLSX.SSF.parse_date_code(raw);
    if (date) {
      const y = date.y;
      const m = String(date.m).padStart(2, '0');
      const d = String(date.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return today;
  }

  const s = String(raw).trim();

  // ISO format: 2026-04-01
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }

  return today;
}

// ─── Parse Excel ───────────────────────────────────────────────────────────

/** Parse an Excel ArrayBuffer into worker rows */
export function parseWorkerExcel(buffer: ArrayBuffer): ParsedWorkerRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];

  const sheet = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) return [];

  // Find header row (first row with recognizable columns)
  let headerIdx = -1;
  let colMap: ColumnMap | null = null;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const headers = rows[i].map(String);
    colMap = detectColumns(headers);
    if (colMap) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0 || !colMap) return [];

  const parsed: ParsedWorkerRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[colMap.name] ?? '').trim();
    if (!name) continue; // skip empty rows

    const rateRaw = row[colMap.rate];
    const dailyRate = typeof rateRaw === 'number' ? rateRaw : parseFloat(String(rateRaw).replace(/[^\d.]/g, ''));

    const parsedRow: ParsedWorkerRow = {
      rowNumber: i + 1, // 1-based
      workerName: name,
      skillLevel: parseSkillLevel(colMap.skill >= 0 ? String(row[colMap.skill]) : null),
      dailyRate: isNaN(dailyRate) ? 0 : dailyRate,
      effectiveFrom: colMap.date >= 0 ? parseDate(row[colMap.date]) : new Date().toISOString().split('T')[0],
    };

    if (parsedRow.dailyRate <= 0) {
      parsedRow.error = 'Tarif harian tidak valid';
    }

    parsed.push(parsedRow);
  }

  return parsed;
}

// ─── Import to Database ────────────────────────────────────────────────────

/** Import parsed worker rows into mandor_workers and worker_rates */
export async function importWorkersToContract(
  contractId: string,
  projectId: string,
  rows: ParsedWorkerRow[],
): Promise<WorkerImportResult> {
  const result: WorkerImportResult = {
    inserted: 0,
    rateUpdated: 0,
    unchanged: 0,
    errors: [],
    parsed: rows,
  };

  const { data: user } = await supabase.auth.getUser();
  const userId = user?.user?.id ?? null;

  // Get existing workers for this contract (for name matching)
  const { data: existingWorkers } = await supabase
    .from('mandor_workers')
    .select('id, worker_name')
    .eq('contract_id', contractId);

  const workerMap = new Map<string, string>(); // lowercase name → id
  for (const w of existingWorkers ?? []) {
    workerMap.set(w.worker_name.toLowerCase(), w.id);
  }

  for (const row of rows) {
    if (row.error) {
      result.errors.push({ row: row.rowNumber, message: row.error });
      continue;
    }

    const nameLower = row.workerName.toLowerCase();
    let workerId = workerMap.get(nameLower);

    if (!workerId) {
      // Insert new worker
      const { data: newWorker, error: workerError } = await supabase
        .from('mandor_workers')
        .insert({
          contract_id: contractId,
          project_id: projectId,
          worker_name: row.workerName,
          skill_level: row.skillLevel,
          created_by: userId,
        })
        .select('id')
        .single();

      if (workerError || !newWorker?.id) {
        result.errors.push({ row: row.rowNumber, message: workerError?.message ?? 'Failed to create worker' });
        continue;
      }

      workerId = newWorker.id as string;
      workerMap.set(nameLower, workerId);
      result.inserted++;
    }

    // Check current active rate
    const { data: currentRate } = await supabase
      .from('worker_rates')
      .select('id, daily_rate, effective_from')
      .eq('worker_id', workerId)
      .is('effective_to', null)
      .order('effective_from', { ascending: false })
      .limit(1)
      .single();

    if (currentRate && currentRate.daily_rate === row.dailyRate) {
      // Same rate, skip
      if (!workerMap.has(nameLower + '_was_new')) {
        result.unchanged++;
      }
      continue;
    }

    // Close existing rate if exists
    if (currentRate && row.effectiveFrom >= currentRate.effective_from) {
      await supabase
        .from('worker_rates')
        .update({ effective_to: row.effectiveFrom })
        .eq('id', currentRate.id);
    }

    // Insert new rate
    const { error: rateError } = await supabase
      .from('worker_rates')
      .insert({
        worker_id: workerId,
        contract_id: contractId,
        daily_rate: row.dailyRate,
        effective_from: row.effectiveFrom,
        notes: 'Excel import',
        set_by: userId,
      });

    if (rateError) {
      result.errors.push({ row: row.rowNumber, message: rateError.message });
      continue;
    }

    result.rateUpdated++;
  }

  return result;
}

// ─── Combined parse + import ───────────────────────────────────────────────

/** Parse an Excel file and import workers to a contract in one step */
export async function parseAndImportWorkers(
  buffer: ArrayBuffer,
  contractId: string,
  projectId: string,
): Promise<WorkerImportResult> {
  const parsed = parseWorkerExcel(buffer);
  if (parsed.length === 0) {
    return {
      inserted: 0,
      rateUpdated: 0,
      unchanged: 0,
      errors: [{ row: 0, message: 'Tidak ada data pekerja ditemukan di file Excel' }],
      parsed: [],
    };
  }
  return importWorkersToContract(contractId, projectId, parsed);
}
