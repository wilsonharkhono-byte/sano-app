import { KNOWN_DEEPLINK_SCREENS, resolveNotificationRoute } from '../notificationRouting';

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

  // ── RETURNED notification routing (spec §5.4 item 3) ────────────────────
  // Migration 088's notify_header_status_change enqueues the new RETURNED
  // notification with deeplink_screen = 'ApprovalsScreen', targeting the
  // estimator — same shape as its APPROVED/REJECTED/AUTO_HOLD/REQUEST_PENDING
  // siblings above. No new BASE_ROUTE_MAP entry is required (the map keys on
  // deeplink_screen, not notification type), but these assertions pin that
  // down explicitly rather than leaving it to be true "by construction".
  it('routes a RETURNED notification (ApprovalsScreen deeplink) to Approvals for the estimator', () => {
    expect(resolveNotificationRoute('ApprovalsScreen', 'estimator')).toBe('Approvals');
  });

  it('would fall back a RETURNED notification to Permintaan for a supervisor, same as its siblings', () => {
    // RETURNED targets the estimator role only (spec §5.4 item 2), so a
    // supervisor should never actually receive one — this pins the same
    // defensive fallback already relied on for REQUEST_PENDING above, should
    // that targeting ever change.
    expect(resolveNotificationRoute('ApprovalsScreen', 'supervisor')).toBe('Permintaan');
  });
});

// ── SITE_EVENT_ASSIGNED (2026-09-10 room site events, migration 097) ────────
// confirm_site_event enqueues it with deeplink_screen = 'SiteEventDetail'. The
// detail screen is registered under that exact name in the supervisor, office
// and principal navigators, so every role must resolve it unchanged.
describe('resolveNotificationRoute - SiteEventDetail', () => {
  it('is a declared deeplink, not an accident of the pass-through', () => {
    expect(KNOWN_DEEPLINK_SCREENS).toContain('SiteEventDetail');
  });

  it('resolves to the same-named route for every role', () => {
    for (const role of ['supervisor', 'estimator', 'admin', 'principal', undefined, null]) {
      expect(resolveNotificationRoute('SiteEventDetail', role)).toBe('SiteEventDetail');
    }
  });
});

// ── Progress claims (2026-09-14 report-driven progress, migration 104) ─────
describe('resolveNotificationRoute - progress claims', () => {
  it('declares both claim deeplinks', () => {
    expect(KNOWN_DEEPLINK_SCREENS).toEqual(expect.arrayContaining(['ProgressClaimVerify', 'ProgressClaim']));
  });

  it('sends a submitted claim to Reports for office roles and to Laporan for a supervisor', () => {
    for (const role of ['estimator', 'admin', 'principal', undefined, null]) {
      expect(resolveNotificationRoute('ProgressClaimVerify', role)).toBe('Reports');
    }
    expect(resolveNotificationRoute('ProgressClaimVerify', 'supervisor')).toBe('Laporan');
  });

  it('sends a returned or verified claim to Progres for a supervisor and to Reports elsewhere', () => {
    expect(resolveNotificationRoute('ProgressClaim', 'supervisor')).toBe('Progres');
    for (const role of ['estimator', 'admin', 'principal', undefined, null]) {
      expect(resolveNotificationRoute('ProgressClaim', role)).toBe('Reports');
    }
  });
});
