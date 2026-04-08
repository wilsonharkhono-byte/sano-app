// Mock supabase to prevent react-native-url-polyfill ESM import in Jest
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import {
  isPositiveNumber,
  isNonEmpty,
  sanitizeText,
  validateMaterialRequest,
  validateReceipt,
  validateProgress,
  validateDefect,
} from '../validation';
import { kasbonStatusLabel, kasbonStatusColor } from '../kasbon';
import {
  getAvailableTransitions,
  canTransition,
  isHandoverBlocker,
  computeHandoverSummary,
} from '../defectLifecycle';
import { DefectStatus, DefectSeverity, UserRole, KasbonStatus, WorkStatus } from '../constants';

// ───────────────────────────────────────────────────────────────────────────
// VALIDATION.TS TESTS
// ───────────────────────────────────────────────────────────────────────────

describe('validation.ts — isPositiveNumber', () => {
  it('returns true for positive integer', () => {
    expect(isPositiveNumber(42)).toBe(true);
  });

  it('returns true for positive float', () => {
    expect(isPositiveNumber(3.14)).toBe(true);
  });

  it('returns true for positive string number', () => {
    expect(isPositiveNumber('99.5')).toBe(true);
  });

  it('returns false for zero', () => {
    expect(isPositiveNumber(0)).toBe(false);
  });

  it('returns false for negative number', () => {
    expect(isPositiveNumber(-5)).toBe(false);
  });

  it('returns false for negative string number', () => {
    expect(isPositiveNumber('-10.5')).toBe(false);
  });

  it('returns false for NaN', () => {
    expect(isPositiveNumber(NaN)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPositiveNumber('')).toBe(false);
  });

  it('returns false for non-numeric string', () => {
    expect(isPositiveNumber('abc')).toBe(false);
  });

  it('returns false for string with spaces', () => {
    expect(isPositiveNumber('  ')).toBe(false);
  });
});

describe('validation.ts — isNonEmpty', () => {
  it('returns true for non-empty string', () => {
    expect(isNonEmpty('hello')).toBe(true);
  });

  it('returns true for string with content and spaces', () => {
    expect(isNonEmpty('  hello world  ')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isNonEmpty('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(isNonEmpty('   ')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNonEmpty(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isNonEmpty(undefined)).toBe(false);
  });

  it('returns true for single character', () => {
    expect(isNonEmpty('a')).toBe(true);
  });
});

describe('validation.ts — sanitizeText', () => {
  it('trims leading whitespace', () => {
    expect(sanitizeText('  hello')).toBe('hello');
  });

  it('trims trailing whitespace', () => {
    expect(sanitizeText('hello  ')).toBe('hello');
  });

  it('trims both ends', () => {
    expect(sanitizeText('  hello world  ')).toBe('hello world');
  });

  it('truncates to 500 characters', () => {
    const longText = 'a'.repeat(600);
    const result = sanitizeText(longText);
    expect(result.length).toBe(500);
    expect(result).toBe('a'.repeat(500));
  });

  it('keeps text shorter than 500 chars unchanged (after trim)', () => {
    const text = '  short text  ';
    expect(sanitizeText(text)).toBe('short text');
  });

  it('handles exactly 500 characters', () => {
    const text = 'a'.repeat(500);
    expect(sanitizeText(text)).toBe(text);
  });

  it('handles empty string', () => {
    expect(sanitizeText('')).toBe('');
  });

  it('handles newlines and tabs', () => {
    expect(sanitizeText('  hello\nworld\t  ')).toBe('hello\nworld');
  });
});

describe('validation.ts — validateMaterialRequest', () => {
  it('returns null when all fields valid', () => {
    const result = validateMaterialRequest({
      boqId: 'BOQ-001',
      quantity: '10',
      targetDate: '2026-04-10',
    });
    expect(result).toBeNull();
  });

  it('returns error when boqId is empty', () => {
    const result = validateMaterialRequest({
      boqId: '',
      quantity: '10',
      targetDate: '2026-04-10',
    });
    expect(result).toBe('Pilih item BoQ');
  });

  it('returns error when quantity is zero', () => {
    const result = validateMaterialRequest({
      boqId: 'BOQ-001',
      quantity: '0',
      targetDate: '2026-04-10',
    });
    expect(result).toBe('Masukkan jumlah lebih dari 0');
  });

  it('returns error when quantity is negative', () => {
    const result = validateMaterialRequest({
      boqId: 'BOQ-001',
      quantity: '-5',
      targetDate: '2026-04-10',
    });
    expect(result).toBe('Masukkan jumlah lebih dari 0');
  });

  it('returns error when quantity is not a number', () => {
    const result = validateMaterialRequest({
      boqId: 'BOQ-001',
      quantity: 'abc',
      targetDate: '2026-04-10',
    });
    expect(result).toBe('Masukkan jumlah lebih dari 0');
  });

  it('returns error when targetDate is empty', () => {
    const result = validateMaterialRequest({
      boqId: 'BOQ-001',
      quantity: '10',
      targetDate: '',
    });
    expect(result).toBe('Pilih target pengiriman');
  });

  it('accepts decimal quantities', () => {
    const result = validateMaterialRequest({
      boqId: 'BOQ-001',
      quantity: '10.5',
      targetDate: '2026-04-10',
    });
    expect(result).toBeNull();
  });
});

describe('validation.ts — validateReceipt', () => {
  it('returns null when all fields valid', () => {
    const result = validateReceipt({
      poId: 'PO-001',
      quantityActual: '10',
      photoCount: 3,
      requiredPhotos: 3,
      hasGps: true,
    });
    expect(result).toBeNull();
  });

  it('returns error when poId is empty', () => {
    const result = validateReceipt({
      poId: '',
      quantityActual: '10',
      photoCount: 3,
      requiredPhotos: 3,
      hasGps: true,
    });
    expect(result).toBe('Pilih PO terlebih dahulu');
  });

  it('returns error when quantityActual is zero', () => {
    const result = validateReceipt({
      poId: 'PO-001',
      quantityActual: '0',
      photoCount: 3,
      requiredPhotos: 3,
      hasGps: true,
    });
    expect(result).toBe('Masukkan jumlah yang diterima');
  });

  it('returns error when photoCount less than requiredPhotos', () => {
    const result = validateReceipt({
      poId: 'PO-001',
      quantityActual: '10',
      photoCount: 2,
      requiredPhotos: 3,
      hasGps: true,
    });
    expect(result).toBe('Ambil semua 3 foto yang diperlukan');
  });

  it('returns error when hasGps is false', () => {
    const result = validateReceipt({
      poId: 'PO-001',
      quantityActual: '10',
      photoCount: 3,
      requiredPhotos: 3,
      hasGps: false,
    });
    expect(result).toBe('Foto kendaraan harus memiliki data GPS');
  });

  it('allows photoCount equal to requiredPhotos', () => {
    const result = validateReceipt({
      poId: 'PO-001',
      quantityActual: '10',
      photoCount: 5,
      requiredPhotos: 5,
      hasGps: true,
    });
    expect(result).toBeNull();
  });

  it('allows photoCount greater than requiredPhotos', () => {
    const result = validateReceipt({
      poId: 'PO-001',
      quantityActual: '10',
      photoCount: 5,
      requiredPhotos: 3,
      hasGps: true,
    });
    expect(result).toBeNull();
  });
});

describe('validation.ts — validateProgress', () => {
  it('returns null when all fields valid', () => {
    const result = validateProgress({
      boqId: 'BOQ-001',
      quantity: '15',
      workStatus: WorkStatus.IN_PROGRESS,
      hasPhoto: true,
    });
    expect(result).toBeNull();
  });

  it('returns error when boqId is empty', () => {
    const result = validateProgress({
      boqId: '',
      quantity: '15',
      workStatus: WorkStatus.IN_PROGRESS,
      hasPhoto: true,
    });
    expect(result).toBe('Pilih item BoQ');
  });

  it('returns error when quantity is zero', () => {
    const result = validateProgress({
      boqId: 'BOQ-001',
      quantity: '0',
      workStatus: WorkStatus.IN_PROGRESS,
      hasPhoto: true,
    });
    expect(result).toBe('Masukkan jumlah terpasang');
  });

  it('returns error when workStatus is null', () => {
    const result = validateProgress({
      boqId: 'BOQ-001',
      quantity: '15',
      workStatus: null,
      hasPhoto: true,
    });
    expect(result).toBe('Pilih status pekerjaan');
  });

  it('returns error when hasPhoto is false', () => {
    const result = validateProgress({
      boqId: 'BOQ-001',
      quantity: '15',
      workStatus: WorkStatus.COMPLETE,
      hasPhoto: false,
    });
    expect(result).toBe('Foto progres wajib diambil');
  });

  it('accepts COMPLETE work status', () => {
    const result = validateProgress({
      boqId: 'BOQ-001',
      quantity: '15',
      workStatus: WorkStatus.COMPLETE,
      hasPhoto: true,
    });
    expect(result).toBeNull();
  });

  it('accepts COMPLETE_DEFECT work status', () => {
    const result = validateProgress({
      boqId: 'BOQ-001',
      quantity: '15',
      workStatus: WorkStatus.COMPLETE_DEFECT,
      hasPhoto: true,
    });
    expect(result).toBeNull();
  });
});

describe('validation.ts — validateDefect', () => {
  it('returns null when all fields valid', () => {
    const result = validateDefect({
      boqRef: 'BOQ-001',
      location: 'Kolom A1',
      description: 'Retak vertikal',
      severity: DefectSeverity.MAJOR,
      hasPhoto: true,
    });
    expect(result).toBeNull();
  });

  it('returns error when boqRef is empty', () => {
    const result = validateDefect({
      boqRef: '',
      location: 'Kolom A1',
      description: 'Retak vertikal',
      severity: DefectSeverity.MAJOR,
      hasPhoto: true,
    });
    expect(result).toBe('Pilih item BoQ');
  });

  it('returns error when location is empty', () => {
    const result = validateDefect({
      boqRef: 'BOQ-001',
      location: '',
      description: 'Retak vertikal',
      severity: DefectSeverity.MAJOR,
      hasPhoto: true,
    });
    expect(result).toBe('Masukkan lokasi spesifik');
  });

  it('returns error when location is whitespace only', () => {
    const result = validateDefect({
      boqRef: 'BOQ-001',
      location: '   ',
      description: 'Retak vertikal',
      severity: DefectSeverity.MAJOR,
      hasPhoto: true,
    });
    expect(result).toBe('Masukkan lokasi spesifik');
  });

  it('returns error when description is empty', () => {
    const result = validateDefect({
      boqRef: 'BOQ-001',
      location: 'Kolom A1',
      description: '',
      severity: DefectSeverity.MAJOR,
      hasPhoto: true,
    });
    expect(result).toBe('Masukkan deskripsi cacat');
  });

  it('returns error when description is whitespace only', () => {
    const result = validateDefect({
      boqRef: 'BOQ-001',
      location: 'Kolom A1',
      description: '  ',
      severity: DefectSeverity.MAJOR,
      hasPhoto: true,
    });
    expect(result).toBe('Masukkan deskripsi cacat');
  });

  it('returns error when severity is null', () => {
    const result = validateDefect({
      boqRef: 'BOQ-001',
      location: 'Kolom A1',
      description: 'Retak vertikal',
      severity: null,
      hasPhoto: true,
    });
    expect(result).toBe('Pilih tingkat keparahan');
  });

  it('returns error when hasPhoto is false', () => {
    const result = validateDefect({
      boqRef: 'BOQ-001',
      location: 'Kolom A1',
      description: 'Retak vertikal',
      severity: DefectSeverity.CRITICAL,
      hasPhoto: false,
    });
    expect(result).toBe('Foto bukti wajib diambil');
  });

  it('accepts MINOR severity', () => {
    const result = validateDefect({
      boqRef: 'BOQ-001',
      location: 'Kolom A1',
      description: 'Retak kecil',
      severity: DefectSeverity.MINOR,
      hasPhoto: true,
    });
    expect(result).toBeNull();
  });

  it('accepts CRITICAL severity', () => {
    const result = validateDefect({
      boqRef: 'BOQ-001',
      location: 'Kolom A1',
      description: 'Keruntuhan struktur',
      severity: DefectSeverity.CRITICAL,
      hasPhoto: true,
    });
    expect(result).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// KASBON.TS TESTS
// ───────────────────────────────────────────────────────────────────────────

describe('kasbon.ts — kasbonStatusLabel', () => {
  it('returns Diajukan for REQUESTED status', () => {
    expect(kasbonStatusLabel(KasbonStatus.REQUESTED)).toBe('Diajukan');
  });

  it('returns Disetujui for APPROVED status', () => {
    expect(kasbonStatusLabel(KasbonStatus.APPROVED)).toBe('Disetujui');
  });

  it('returns Terpotong for SETTLED status', () => {
    expect(kasbonStatusLabel(KasbonStatus.SETTLED)).toBe('Terpotong');
  });

  it('returns passthrough for unknown status', () => {
    expect(kasbonStatusLabel('UNKNOWN' as any)).toBe('UNKNOWN');
  });

  it('handles empty string status', () => {
    expect(kasbonStatusLabel('' as any)).toBe('');
  });
});

describe('kasbon.ts — kasbonStatusColor', () => {
  it('returns orange for REQUESTED status', () => {
    expect(kasbonStatusColor(KasbonStatus.REQUESTED)).toBe('#E65100');
  });

  it('returns blue for APPROVED status', () => {
    expect(kasbonStatusColor(KasbonStatus.APPROVED)).toBe('#1565C0');
  });

  it('returns green for SETTLED status', () => {
    expect(kasbonStatusColor(KasbonStatus.SETTLED)).toBe('#3D8B40');
  });

  it('returns gray for unknown status', () => {
    expect(kasbonStatusColor('UNKNOWN' as any)).toBe('#524E49');
  });

  it('returns gray for empty string status', () => {
    expect(kasbonStatusColor('' as any)).toBe('#524E49');
  });

  it('all color codes are valid hex format', () => {
    const hexRegex = /^#[0-9A-F]{6}$/i;
    expect(hexRegex.test(kasbonStatusColor(KasbonStatus.REQUESTED))).toBe(true);
    expect(hexRegex.test(kasbonStatusColor(KasbonStatus.APPROVED))).toBe(true);
    expect(hexRegex.test(kasbonStatusColor(KasbonStatus.SETTLED))).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DEFECTLIFECYCLE.TS TESTS
// ───────────────────────────────────────────────────────────────────────────

describe('defectLifecycle.ts — getAvailableTransitions', () => {
  it('returns transitions from OPEN for SUPERVISOR', () => {
    const transitions = getAvailableTransitions(DefectStatus.OPEN, UserRole.SUPERVISOR);
    expect(transitions.length).toBeGreaterThan(0);
    expect(transitions.some(t => t.to === DefectStatus.IN_REPAIR)).toBe(true);
  });

  it('returns transitions from OPEN for ESTIMATOR', () => {
    const transitions = getAvailableTransitions(DefectStatus.OPEN, UserRole.ESTIMATOR);
    expect(transitions.some(t => t.to === DefectStatus.VALIDATED)).toBe(true);
  });

  it('returns empty array for ACCEPTED_BY_PRINCIPAL (terminal state)', () => {
    const transitions = getAvailableTransitions(
      DefectStatus.ACCEPTED_BY_PRINCIPAL,
      UserRole.PRINCIPAL
    );
    expect(transitions.length).toBe(0);
  });

  it('returns correct transitions for RESOLVED → VERIFIED (PRINCIPAL)', () => {
    const transitions = getAvailableTransitions(DefectStatus.RESOLVED, UserRole.PRINCIPAL);
    expect(transitions.some(t => t.to === DefectStatus.VERIFIED)).toBe(true);
  });

  it('restricts VERIFIED → ACCEPTED_BY_PRINCIPAL to PRINCIPAL only', () => {
    const supervisorTransitions = getAvailableTransitions(
      DefectStatus.VERIFIED,
      UserRole.SUPERVISOR
    );
    const principalTransitions = getAvailableTransitions(
      DefectStatus.VERIFIED,
      UserRole.PRINCIPAL
    );
    expect(principalTransitions.some(t => t.to === DefectStatus.ACCEPTED_BY_PRINCIPAL)).toBe(true);
    expect(supervisorTransitions.some(t => t.to === DefectStatus.ACCEPTED_BY_PRINCIPAL)).toBe(
      false
    );
  });
});

describe('defectLifecycle.ts — canTransition', () => {
  it('returns true for valid OPEN → VALIDATED (ESTIMATOR)', () => {
    expect(
      canTransition(DefectStatus.OPEN, DefectStatus.VALIDATED, UserRole.ESTIMATOR)
    ).toBe(true);
  });

  it('returns true for valid OPEN → IN_REPAIR (SUPERVISOR)', () => {
    expect(canTransition(DefectStatus.OPEN, DefectStatus.IN_REPAIR, UserRole.SUPERVISOR)).toBe(
      true
    );
  });

  it('returns true for valid RESOLVED → VERIFIED (ESTIMATOR)', () => {
    expect(
      canTransition(DefectStatus.RESOLVED, DefectStatus.VERIFIED, UserRole.ESTIMATOR)
    ).toBe(true);
  });

  it('returns true for valid VERIFIED → ACCEPTED_BY_PRINCIPAL (PRINCIPAL)', () => {
    expect(
      canTransition(
        DefectStatus.VERIFIED,
        DefectStatus.ACCEPTED_BY_PRINCIPAL,
        UserRole.PRINCIPAL
      )
    ).toBe(true);
  });

  it('returns false for invalid role', () => {
    expect(
      canTransition(
        DefectStatus.VERIFIED,
        DefectStatus.ACCEPTED_BY_PRINCIPAL,
        UserRole.SUPERVISOR
      )
    ).toBe(false);
  });

  it('returns false for invalid status transition', () => {
    expect(
      canTransition(DefectStatus.VALIDATED, DefectStatus.ACCEPTED_BY_PRINCIPAL, UserRole.PRINCIPAL)
    ).toBe(false);
  });

  it('returns true for RESOLVED → IN_REPAIR rejection (ESTIMATOR)', () => {
    expect(
      canTransition(DefectStatus.RESOLVED, DefectStatus.IN_REPAIR, UserRole.ESTIMATOR)
    ).toBe(true);
  });

  it('returns true for RESOLVED → IN_REPAIR rejection (PRINCIPAL)', () => {
    expect(
      canTransition(DefectStatus.RESOLVED, DefectStatus.IN_REPAIR, UserRole.PRINCIPAL)
    ).toBe(true);
  });

  it('returns true for VERIFIED → IN_REPAIR rejection (PRINCIPAL)', () => {
    expect(
      canTransition(DefectStatus.VERIFIED, DefectStatus.IN_REPAIR, UserRole.PRINCIPAL)
    ).toBe(true);
  });
});

describe('defectLifecycle.ts — isHandoverBlocker', () => {
  it('returns true for OPEN + CRITICAL', () => {
    expect(isHandoverBlocker(DefectStatus.OPEN, DefectSeverity.CRITICAL)).toBe(true);
  });

  it('returns true for OPEN + MAJOR', () => {
    expect(isHandoverBlocker(DefectStatus.OPEN, DefectSeverity.MAJOR)).toBe(true);
  });

  it('returns false for OPEN + MINOR', () => {
    expect(isHandoverBlocker(DefectStatus.OPEN, DefectSeverity.MINOR)).toBe(false);
  });

  it('returns true for VALIDATED + CRITICAL', () => {
    expect(isHandoverBlocker(DefectStatus.VALIDATED, DefectSeverity.CRITICAL)).toBe(true);
  });

  it('returns true for VALIDATED + MAJOR', () => {
    expect(isHandoverBlocker(DefectStatus.VALIDATED, DefectSeverity.MAJOR)).toBe(true);
  });

  it('returns true for IN_REPAIR + CRITICAL', () => {
    expect(isHandoverBlocker(DefectStatus.IN_REPAIR, DefectSeverity.CRITICAL)).toBe(true);
  });

  it('returns true for IN_REPAIR + MAJOR', () => {
    expect(isHandoverBlocker(DefectStatus.IN_REPAIR, DefectSeverity.MAJOR)).toBe(true);
  });

  it('returns true for RESOLVED + CRITICAL', () => {
    expect(isHandoverBlocker(DefectStatus.RESOLVED, DefectSeverity.CRITICAL)).toBe(true);
  });

  it('returns true for RESOLVED + MAJOR', () => {
    expect(isHandoverBlocker(DefectStatus.RESOLVED, DefectSeverity.MAJOR)).toBe(true);
  });

  it('returns false for VERIFIED + CRITICAL (terminal enough)', () => {
    expect(isHandoverBlocker(DefectStatus.VERIFIED, DefectSeverity.CRITICAL)).toBe(false);
  });

  it('returns false for ACCEPTED_BY_PRINCIPAL + CRITICAL (terminal)', () => {
    expect(isHandoverBlocker(DefectStatus.ACCEPTED_BY_PRINCIPAL, DefectSeverity.CRITICAL)).toBe(
      false
    );
  });
});

describe('defectLifecycle.ts — computeHandoverSummary', () => {
  it('returns eligible=true when no blockers', () => {
    const defects = [
      {
        id: 'd1',
        status: DefectStatus.ACCEPTED_BY_PRINCIPAL,
        severity: DefectSeverity.CRITICAL,
        handover_impact: false,
      },
    ];
    const summary = computeHandoverSummary(defects);
    expect(summary.eligible).toBe(true);
    expect(summary.totalBlockers).toBe(0);
  });

  it('returns eligible=false when OPEN + CRITICAL', () => {
    const defects = [
      {
        id: 'd1',
        status: DefectStatus.OPEN,
        severity: DefectSeverity.CRITICAL,
        handover_impact: false,
      },
    ];
    const summary = computeHandoverSummary(defects);
    expect(summary.eligible).toBe(false);
    expect(summary.totalBlockers).toBe(1);
    expect(summary.criticalOpen).toBe(1);
  });

  it('counts criticalOpen correctly', () => {
    const defects = [
      {
        id: 'd1',
        status: DefectStatus.OPEN,
        severity: DefectSeverity.CRITICAL,
        handover_impact: false,
      },
      {
        id: 'd2',
        status: DefectStatus.VALIDATED,
        severity: DefectSeverity.CRITICAL,
        handover_impact: false,
      },
    ];
    const summary = computeHandoverSummary(defects);
    expect(summary.criticalOpen).toBe(2);
    expect(summary.majorOpen).toBe(0);
  });

  it('counts majorOpen correctly', () => {
    const defects = [
      {
        id: 'd1',
        status: DefectStatus.OPEN,
        severity: DefectSeverity.MAJOR,
        handover_impact: false,
      },
      {
        id: 'd2',
        status: DefectStatus.IN_REPAIR,
        severity: DefectSeverity.MAJOR,
        handover_impact: false,
      },
    ];
    const summary = computeHandoverSummary(defects);
    expect(summary.majorOpen).toBe(2);
    expect(summary.criticalOpen).toBe(0);
  });

  it('includes handover_impact blockers even if not CRITICAL/MAJOR', () => {
    const defects = [
      {
        id: 'd1',
        status: DefectStatus.OPEN,
        severity: DefectSeverity.MINOR,
        handover_impact: true,
      },
    ];
    const summary = computeHandoverSummary(defects);
    expect(summary.eligible).toBe(false);
    expect(summary.totalBlockers).toBe(1);
  });

  it('correctly combines MAJOR/CRITICAL + handover_impact', () => {
    const defects = [
      {
        id: 'd1',
        status: DefectStatus.OPEN,
        severity: DefectSeverity.CRITICAL,
        handover_impact: false,
      },
      {
        id: 'd2',
        status: DefectStatus.OPEN,
        severity: DefectSeverity.MINOR,
        handover_impact: true,
      },
    ];
    const summary = computeHandoverSummary(defects);
    expect(summary.totalBlockers).toBe(2);
    expect(summary.blockerIds).toContain('d1');
    expect(summary.blockerIds).toContain('d2');
  });

  it('returns empty blockerIds when eligible', () => {
    const defects = [
      {
        id: 'd1',
        status: DefectStatus.VERIFIED,
        severity: DefectSeverity.CRITICAL,
        handover_impact: false,
      },
    ];
    const summary = computeHandoverSummary(defects);
    expect(summary.blockerIds.length).toBe(0);
  });

  it('handles empty defects array', () => {
    const summary = computeHandoverSummary([]);
    expect(summary.eligible).toBe(true);
    expect(summary.totalBlockers).toBe(0);
    expect(summary.criticalOpen).toBe(0);
    expect(summary.majorOpen).toBe(0);
  });

  it('distinguishes between CRITICAL and MAJOR counts', () => {
    const defects = [
      {
        id: 'd1',
        status: DefectStatus.OPEN,
        severity: DefectSeverity.CRITICAL,
        handover_impact: false,
      },
      {
        id: 'd2',
        status: DefectStatus.VALIDATED,
        severity: DefectSeverity.CRITICAL,
        handover_impact: false,
      },
      {
        id: 'd3',
        status: DefectStatus.IN_REPAIR,
        severity: DefectSeverity.MAJOR,
        handover_impact: false,
      },
    ];
    const summary = computeHandoverSummary(defects);
    expect(summary.criticalOpen).toBe(2);
    expect(summary.majorOpen).toBe(1);
    expect(summary.totalBlockers).toBe(3);
  });
});
