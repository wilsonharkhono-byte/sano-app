/**
 * Excel Attendance Import/Export
 *
 * Parses an Excel file with weekly attendance data and imports into
 * worker_attendance_entries table via batch RPC.
 *
 * Expected columns for import:
 *   | Nama Pekerja | Tanggal | Hadir | Lembur (jam) | Keterangan |
 *   | Jajang Tukang| 2026-03-23 | Ya | 0 | Plester area koridor |
 *
 * Export: Creates a weekly template with worker names pre-filled.
 * Column matching is case-insensitive and supports common aliases.
 */

import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { recordWorkerAttendanceBatch } from './workerAttendance';
import type { BatchEntryInput } from './workerAttendance';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ParsedAttendanceRow {
  rowNumber: number;
  workerName: string;
  attendanceDate: string;
  isPresent: boolean;
  overtimeHours: number;
  workDescription: string | null;
  error?: string;
}

export interface AttendanceImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  parsed: ParsedAttendanceRow[];
}

// ─── Column Detection ──────────────────────────────────────────────────────

const NAME_ALIASES = ['nama pekerja', 'nama', 'worker name', 'name', 'pekerja', 'nama tukang'];
const DATE_ALIASES = ['tanggal', 'date', 'attendance date', 'tanggal kehadiran', 'hari'];
const PRESENT_ALIASES = ['hadir', 'present', 'kehadiran', 'status', 'ada'];
const OT_ALIASES = ['lembur', 'overtime', 'jam lembur', 'jam tambah', 'overtime hours', 'ot'];
const DESC_ALIASES = ['keterangan', 'description', 'deskripsi', 'catatan', 'notes'];

function matchColumn(header: string, aliases: string[]): boolean {
  const h = header.toLowerCase().trim();
  return aliases.some((a) => h === a || h.includes(a));
}

interface ColumnMap {
  name: number;
  date: number;
  present: number;
  ot: number;
  desc: number;
}

function detectColumns(headers: string[]): ColumnMap | null {
  let name = -1;
  let date = -1;
  let present = -1;
  let ot = -1;
  let desc = -1;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    if (name < 0 && matchColumn(h, NAME_ALIASES)) name = i;
    else if (date < 0 && matchColumn(h, DATE_ALIASES)) date = i;
    else if (present < 0 && matchColumn(h, PRESENT_ALIASES)) present = i;
    else if (ot < 0 && matchColumn(h, OT_ALIASES)) ot = i;
    else if (desc < 0 && matchColumn(h, DESC_ALIASES)) desc = i;
  }

  if (name < 0 || date < 0 || present < 0) return null; // name, date, and present are required
  return { name, date, present, ot, desc };
}

// ─── Presence parsing ──────────────────────────────────────────────────────

function parsePresence(raw: unknown): boolean {
  if (!raw) return false;
  const str = String(raw).toLowerCase().trim();
  return ['y', 'ya', 'yes', '1', 'true', 'ada', 'hadir'].includes(str);
}

// ─── Overtime parsing ──────────────────────────────────────────────────────

function parseOvertimeHours(raw: unknown): number {
  if (!raw) return 0;
  if (typeof raw === 'number') return Math.max(0, raw);
  const parsed = parseFloat(String(raw).replace(/[^\d.]/g, ''));
  return isNaN(parsed) ? 0 : Math.max(0, parsed);
}

// ─── Date parsing ──────────────────────────────────────────────────────────

function parseDate(raw: unknown): string {
  if (!raw) return '';

  // Excel serial number
  if (typeof raw === 'number') {
    const date = XLSX.SSF.parse_date_code(raw);
    if (date) {
      const y = date.y;
      const m = String(date.m).padStart(2, '0');
      const d = String(date.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return '';
  }

  const s = String(raw).trim();

  // ISO format: 2026-04-01
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }

  return '';
}

// ─── Parse Excel ───────────────────────────────────────────────────────────

// ─── Wide format detection (workers as rows, days as column pairs) ────────────

/** Extracts ISO date from a header string like "Sen 23/3\n2026-03-23\nHadir (Y/N)" */
function extractISODateFromHeader(header: string): string {
  const match = header.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

/** Returns true if the header row looks like the wide template format */
function isWideFormat(headers: string[]): boolean {
  // Wide format: col 0 = name, col 1 contains an ISO date and "Hadir"
  if (headers.length < 3) return false;
  const h1 = headers[1] ?? '';
  return /\d{4}-\d{2}-\d{2}/.test(h1) && /hadir/i.test(h1);
}

/** Parse wide format: workers as rows, (Hadir|Lembur) column pairs per day */
function parseWideFormat(headers: string[], rows: unknown[][], dataStart: number): ParsedAttendanceRow[] {
  // Build date → col index map from headers
  interface DayColPair { date: string; presentCol: number; otCol: number }
  const dayCols: DayColPair[] = [];
  for (let c = 1; c < headers.length - 1; c += 2) {
    const date = extractISODateFromHeader(headers[c]);
    if (!date) continue;
    const nextHeader = headers[c + 1] ?? '';
    const isOtCol = /lembur|ot|overtime/i.test(nextHeader);
    if (isOtCol) {
      dayCols.push({ date, presentCol: c, otCol: c + 1 });
    }
  }
  if (dayCols.length === 0) return [];

  // Desc col = last column
  const descCol = headers.length - 1;

  const parsed: ParsedAttendanceRow[] = [];

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[0] ?? '').trim();
    if (!name) continue;

    const desc = String(row[descCol] ?? '').trim() || null;

    for (const { date, presentCol, otCol } of dayCols) {
      parsed.push({
        rowNumber: i + 1,
        workerName: name,
        attendanceDate: date,
        isPresent: parsePresence(row[presentCol]),
        overtimeHours: parseOvertimeHours(row[otCol]),
        workDescription: desc,
      });
    }
  }

  return parsed;
}

/** Parse an Excel ArrayBuffer into attendance rows — handles wide and long formats */
export function parseAttendanceExcel(buffer: ArrayBuffer): ParsedAttendanceRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];

  const sheet = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) return [];

  // Scan first 5 rows for a recognizable header
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const headers = rows[i].map(String);

    if (isWideFormat(headers)) {
      return parseWideFormat(headers, rows, i + 1);
    }

    const colMap = detectColumns(headers);
    if (colMap) {
      // Long format (one row per worker-day)
      const parsed: ParsedAttendanceRow[] = [];
      for (let r = i + 1; r < rows.length; r++) {
        const row = rows[r];
        const name = String(row[colMap.name] ?? '').trim();
        if (!name) continue;

        const dateStr = parseDate(row[colMap.date]);
        if (!dateStr) {
          parsed.push({ rowNumber: r + 1, workerName: name, attendanceDate: '', isPresent: false, overtimeHours: 0, workDescription: null, error: 'Tanggal tidak valid' });
          continue;
        }
        parsed.push({
          rowNumber: r + 1,
          workerName: name,
          attendanceDate: dateStr,
          isPresent: parsePresence(row[colMap.present]),
          overtimeHours: colMap.ot >= 0 ? parseOvertimeHours(row[colMap.ot]) : 0,
          workDescription: colMap.desc >= 0 ? (String(row[colMap.desc] ?? '').trim() || null) : null,
        });
      }
      return parsed;
    }
  }

  return [];
}

// ─── Import to Database ────────────────────────────────────────────────────

/** Import parsed attendance rows into worker_attendance_entries */
export async function importAttendanceToContract(
  contractId: string,
  projectId: string,
  rows: ParsedAttendanceRow[],
): Promise<AttendanceImportResult> {
  const result: AttendanceImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
    parsed: rows,
  };

  // Get workers for this contract
  const { data: workers } = await supabase
    .from('mandor_workers')
    .select('id, worker_name')
    .eq('contract_id', contractId);

  const workerMap = new Map<string, string>(); // lowercase name → id
  for (const w of workers ?? []) {
    workerMap.set(w.worker_name.toLowerCase(), w.id);
  }

  // Group by date for batch processing
  const byDate = new Map<string, ParsedAttendanceRow[]>();
  for (const row of rows) {
    if (row.error) {
      result.errors.push({ row: row.rowNumber, message: row.error });
      continue;
    }

    if (!byDate.has(row.attendanceDate)) {
      byDate.set(row.attendanceDate, []);
    }
    byDate.get(row.attendanceDate)!.push(row);
  }

  // Process each date
  for (const [dateStr, dateRows] of byDate.entries()) {
    const batchEntries: BatchEntryInput[] = [];

    for (const row of dateRows) {
      const workerId = workerMap.get(row.workerName.toLowerCase());
      if (!workerId) {
        result.errors.push({
          row: row.rowNumber,
          message: `Pekerja "${row.workerName}" tidak ditemukan dalam daftar kontrak`,
        });
        continue;
      }

      batchEntries.push({
        worker_id: workerId,
        is_present: row.isPresent,
        overtime_hours: row.overtimeHours,
        work_description: row.workDescription || undefined,
      });
    }

    if (batchEntries.length > 0) {
      const { count, error } = await recordWorkerAttendanceBatch({
        contractId,
        attendanceDate: dateStr,
        entries: batchEntries,
      });

      if (error) {
        result.errors.push({ row: 0, message: `${dateStr}: ${error}` });
      } else {
        result.imported += (count ?? batchEntries.length);
      }
    }
  }

  return result;
}

// ─── Combined parse + import ───────────────────────────────────────────────

/** Parse an Excel file and import attendance to a contract in one step */
export async function parseAndImportAttendance(
  buffer: ArrayBuffer,
  contractId: string,
  projectId: string,
): Promise<AttendanceImportResult> {
  const parsed = parseAttendanceExcel(buffer);
  if (parsed.length === 0) {
    return {
      imported: 0,
      skipped: 0,
      errors: [{ row: 0, message: 'Tidak ada data kehadiran ditemukan di file Excel' }],
      parsed: [],
    };
  }
  return importAttendanceToContract(contractId, projectId, parsed);
}

// ─── Export template ───────────────────────────────────────────────────────

/** Generate a blank Excel template for attendance input */
export async function generateAttendanceTemplate(
  contractId: string,
  weekStart: string,
  weekEnd: string,
): Promise<ArrayBuffer> {
  // Get workers
  const { data: workers } = await supabase
    .from('mandor_workers')
    .select('id, worker_name')
    .eq('contract_id', contractId)
    .eq('is_active', true);

  const ws_data: unknown[][] = [
    ['Nama Pekerja', 'Tanggal', 'Hadir (Y/N)', 'Lembur (jam)', 'Keterangan'],
  ];

  // Add 6 rows per worker (Mon-Sat)
  const startDate = new Date(weekStart);
  for (let dayOffset = 0; dayOffset < 6; dayOffset++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + dayOffset);
    const dateStr = date.toISOString().split('T')[0];

    for (const worker of workers ?? []) {
      ws_data.push([worker.worker_name, dateStr, '', '', '']);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  ws['!cols'] = [
    { wch: 20 }, // Nama Pekerja
    { wch: 12 }, // Tanggal
    { wch: 12 }, // Hadir
    { wch: 14 }, // Lembur
    { wch: 30 }, // Keterangan
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kehadiran');
  return new Promise((resolve, reject) => {
    try {
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      resolve(Buffer.from(buf).buffer);
    } catch (err) {
      reject(err);
    }
  });
}
