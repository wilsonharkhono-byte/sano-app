import { resolveNotificationRoute } from '../notificationRouting';

describe('resolveNotificationRoute', () => {
  // ── Base deeplink → route mapping (role-independent) ────────────────────
  it('maps ApprovalsScreen → Approvals for office roles', () => {
    expect(resolveNotificationRoute('ApprovalsScreen', 'estimator')).toBe('Approvals');
    expect(resolveNotificationRoute('ApprovalsScreen', 'admin')).toBe('Approvals');
  });

  it('maps POScreen → Procurement (office Gate2/PO creation tab)', () => {
    expect(resolveNotificationRoute('POScreen', 'admin')).toBe('Procurement');
    expect(resolveNotificationRoute('POScreen', 'estimator')).toBe('Procurement');
  });

  it('maps ReceiptScreen → Terima', () => {
    expect(resolveNotificationRoute('ReceiptScreen', 'supervisor')).toBe('Terima');
  });

  it('passes through unmapped screens unchanged', () => {
    expect(resolveNotificationRoute('Notifikasi', 'supervisor')).toBe('Notifikasi');
    expect(resolveNotificationRoute('Laporan', 'admin')).toBe('Laporan');
  });

  // ── Supervisor dead-end fix (audit §5) ──────────────────────────────────
  // Supervisor nav has no 'Approvals' route; APPROVED/REJECTED/AUTO_HOLD
  // notifications (and REQUEST_PENDING, should it ever reach a supervisor)
  // all deeplink to 'ApprovalsScreen'. Route the supervisor to their own
  // Permintaan screen instead of the Notifikasi fallback.
  it('routes supervisor ApprovalsScreen deeplinks to Permintaan', () => {
    expect(resolveNotificationRoute('ApprovalsScreen', 'supervisor')).toBe('Permintaan');
  });

  it('also fixes an already-resolved Approvals target for supervisors', () => {
    // Covers stored notifications whose deeplink_screen was written as the
    // route name directly rather than the *Screen alias.
    expect(resolveNotificationRoute('Approvals', 'supervisor')).toBe('Permintaan');
  });

  // ── Principal keeps Approvals (shares the supervisor NotificationsScreen
  //    component, but HAS an Approvals tab) ─────────────────────────────────
  it('keeps Approvals for principal', () => {
    expect(resolveNotificationRoute('ApprovalsScreen', 'principal')).toBe('Approvals');
  });

  // ── Unknown / missing role: keep base behavior (office-equivalent) ──────
  it('falls back to base mapping when role is undefined or null', () => {
    expect(resolveNotificationRoute('ApprovalsScreen', undefined)).toBe('Approvals');
    expect(resolveNotificationRoute('ApprovalsScreen', null)).toBe('Approvals');
  });
});
