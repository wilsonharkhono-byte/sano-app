// Mock supabase — parseAttendanceExcel is pure but the module imports supabase.
jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import * as XLSX from 'xlsx';
import { parseAttendanceExcel } from '../excelAttendanceImport';

function toBuffer(aoa: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kehadiran');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array;
  return new Uint8Array(buf).buffer as ArrayBuffer;
}

describe('Excel import — blank presence is skipped (U2, never default-present)', () => {
  it('wide format: blank cell produces no row; Y=present, N=absent', () => {
    const header = [
      'Nama Pekerja',
      'Sen 6/7\n2026-07-06\nHadir (Y/N)', 'Sen 6/7\n2026-07-06\nLembur (jam)',
      'Sel 7/7\n2026-07-07\nHadir (Y/N)', 'Sel 7/7\n2026-07-07\nLembur (jam)',
      'Keterangan',
    ];
    const rows = [
      header,
      ['Budi', 'Y', 2, '', '', ''],  // d1 present ot2; d2 blank → skipped
      ['Sri', 'N', '', 'Y', 1, ''],  // d1 absent; d2 present ot1
    ];
    const parsed = parseAttendanceExcel(toBuffer(rows));

    // Budi's blank Tuesday must NOT appear at all
    expect(parsed).toHaveLength(3);
    const budi = parsed.filter((p) => p.workerName === 'Budi');
    expect(budi).toHaveLength(1);
    expect(budi[0]).toMatchObject({ attendanceDate: '2026-07-06', isPresent: true, overtimeHours: 2 });

    const sri = parsed.filter((p) => p.workerName === 'Sri');
    expect(sri).toEqual(expect.arrayContaining([
      expect.objectContaining({ attendanceDate: '2026-07-06', isPresent: false, overtimeHours: 0 }),
      expect.objectContaining({ attendanceDate: '2026-07-07', isPresent: true, overtimeHours: 1 }),
    ]));
    // No cell was silently defaulted to present:
    expect(parsed.every((p) => !(p.workerName === 'Budi' && p.attendanceDate === '2026-07-07'))).toBe(true);
  });

  it('long format: blank presence row is skipped, explicit values kept', () => {
    const rows = [
      ['Nama Pekerja', 'Tanggal', 'Hadir (Y/N)', 'Lembur (jam)', 'Keterangan'],
      ['Budi', '2026-07-06', '', '', ''],   // blank → skipped
      ['Sri', '2026-07-06', 'Y', 2, ''],    // present ot2
      ['Sri', '2026-07-07', 'N', '', ''],   // absent
    ];
    const parsed = parseAttendanceExcel(toBuffer(rows));
    expect(parsed).toHaveLength(2);
    expect(parsed.some((p) => p.workerName === 'Budi')).toBe(false);
    expect(parsed).toEqual(expect.arrayContaining([
      expect.objectContaining({ workerName: 'Sri', attendanceDate: '2026-07-06', isPresent: true, overtimeHours: 2 }),
      expect.objectContaining({ workerName: 'Sri', attendanceDate: '2026-07-07', isPresent: false, overtimeHours: 0 }),
    ]));
  });
});
