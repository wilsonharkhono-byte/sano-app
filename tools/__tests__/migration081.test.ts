/**
 * Static guard for migration 081 (attendance → payroll audit fixes).
 *
 * This suite does NOT touch a database. It asserts that the SQL file contains
 * the frozen public-contract surface other agents' smoke tests depend on:
 * function names, exact RAISE messages, the widened status domain, and the
 * re-paste-safety marker. If someone edits 068 and drops one of these, the
 * downstream TS wiring / smoke tests would silently diverge — this fails first.
 */
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/081_attendance_payroll_audit_fixes.sql'),
  'utf8',
);

describe('migration 081 — frozen contract surface', () => {
  it('is marked re-paste-safe for the Dashboard SQL Editor', () => {
    expect(SQL).toContain(
      'Apply by pasting into Supabase Dashboard SQL Editor; safe to re-paste.',
    );
  });

  describe('function definitions', () => {
    const fns = [
      'sano_wib_today',
      'record_worker_attendance',
      'record_worker_attendance_batch',
      'recompute_opname_header_totals',
      'verify_opname',
      'settle_kasbon_ledger_for_opname',
      'approve_opname',
      'recompute_harian_opname',
      'void_opname',
    ];
    for (const fn of fns) {
      it(`defines ${fn}`, () => {
        expect(SQL).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION ${fn}\\b`));
      });
    }
  });

  describe('exact RAISE messages (smoke tests assert on these)', () => {
    const messages = [
      // F1/F13 recording window (record_worker_attendance + batch)
      'Tanggal di luar jendela pencatatan (maks 14 hari ke belakang, 7 hari ke depan)',
      // F7 gross drift guard in approve_opname
      'Gross berubah sejak verifikasi — lakukan verifikasi ulang',
      // F7 recompute status gate
      'Opname sudah disetujui — tidak bisa dihitung ulang',
      // F8 void scope guard
      'Void untuk opname borongan belum didukung',
    ];
    for (const msg of messages) {
      it(`contains: ${msg}`, () => {
        expect(SQL).toContain(msg);
      });
    }
  });

  describe('frozen signatures (kept compatible with the app RPC calls)', () => {
    it('record_worker_attendance_batch(p_contract_id, p_attendance_date, p_entries)', () => {
      expect(SQL).toMatch(
        /FUNCTION record_worker_attendance_batch\(\s*p_contract_id UUID,\s*p_attendance_date DATE,\s*p_entries JSONB/,
      );
    });
    it('approve_opname keeps the p_kasbon parameter', () => {
      expect(SQL).toMatch(/FUNCTION approve_opname\(\s*p_header_id UUID,\s*p_kasbon NUMERIC/);
    });
    it('void_opname(p_header_id, p_note)', () => {
      expect(SQL).toMatch(/FUNCTION void_opname\(\s*p_header_id UUID,\s*p_note TEXT/);
    });
  });

  describe('schema changes', () => {
    it('widens the opname status domain to include VOID', () => {
      expect(SQL).toContain(
        "CHECK (status IN ('DRAFT', 'SUBMITTED', 'VERIFIED', 'APPROVED', 'PAID', 'VOID'))",
      );
    });
    it('adds the verified-gross freeze column', () => {
      expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS verified_gross_total NUMERIC/);
    });
    it('adds the void metadata columns', () => {
      expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS void_note TEXT/);
      expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS voided_by UUID/);
      expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ/);
    });
    it('adds the kasbon partial-settlement column and ledger table', () => {
      expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS settled_amount NUMERIC NOT NULL DEFAULT 0/);
      expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS kasbon_settlements/);
    });
  });

  describe('WIB date evaluation (F13)', () => {
    it("defines sano_wib_today as (now() AT TIME ZONE 'Asia/Jakarta')::date", () => {
      expect(SQL).toContain("(now() AT TIME ZONE 'Asia/Jakarta')::date");
    });
    it('repoints date column defaults at WIB today', () => {
      expect(SQL).toMatch(/worker_rates ALTER COLUMN effective_from SET DEFAULT sano_wib_today\(\)/);
      expect(SQL).toMatch(/mandor_kasbon ALTER COLUMN kasbon_date SET DEFAULT sano_wib_today\(\)/);
    });
  });

  describe('F9 campuran isolation', () => {
    it('filters borongan prior_paid by payment_type', () => {
      expect(SQL).toContain("COALESCE(payment_type, 'borongan') = 'borongan'");
    });
  });
});
