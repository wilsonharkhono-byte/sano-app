// Role-aware notification deeplink → nav-route resolution.
//
// Notification rows store a deeplink_screen (e.g. 'ApprovalsScreen') that is
// role-agnostic — the server-side triggers (034/067) don't know which role
// will tap the notification. Each role's navigator registers different
// routes, so the same deeplink must resolve differently per role:
//
//   deeplink          supervisor      principal    admin/estimator (office)
//   ApprovalsScreen → Permintaan      Approvals    Approvals
//   POScreen        → Procurement*    Procurement  Procurement (Gate2/PO)
//   ReceiptScreen   → Terima          Terima*      Terima
//   SiteEventDetail → SiteEventDetail SiteEventDetail SiteEventDetail
//   RoomBoard       → RoomBoard       Rooms        Rooms
//
//   (* route absent from that role's nav — caller's try/catch falls back to
//    the Notifikasi tab; out of scope here.)
//
// The supervisor rule fixes the audit §5 dead-end: APPROVED / REJECTED /
// AUTO_HOLD (and 067's REQUEST_PENDING) all deeplink to 'ApprovalsScreen',
// a route the supervisor nav does not register — supervisors tapping their
// own request outcome dead-ended in the Notifikasi fallback. Resolving at
// tap time (rather than fixing the server-side deeplink) also repairs every
// notification already stored with the old deeplink.
//
// RETURNED (approval/PO separation-of-duties spec §5.4 item 3) joins that
// same list: migration 088's notify_header_status_change enqueues it with
// deeplink_screen = 'ApprovalsScreen', same as its siblings, targeting the
// estimator who must act next. It needs no new entry in BASE_ROUTE_MAP —
// the map keys on deeplink_screen, not notification type, and
// 'ApprovalsScreen' already resolves correctly for every role — but it is
// called out here, and covered below, so that fact is not left implicit.
//
// Used by workflows/App.tsx (push-notification tap listener, all roles) and
// workflows/screens/NotificationsScreen.tsx (in-app list shared by
// supervisor AND principal — hence the role parameter, not a hardcoded map).

const BASE_ROUTE_MAP: Record<string, string> = {
  ApprovalsScreen: 'Approvals',
  POScreen: 'Procurement',
  ReceiptScreen: 'Terima',
  // SITE_EVENT_ASSIGNED (migration 097 confirm_site_event). The detail screen is
  // registered under this exact name in all three navigators, so it maps to
  // itself; listed so the deeplink is declared rather than implied.
  SiteEventDetail: 'SiteEventDetail',
  // PROGRESS_CLAIM_SUBMITTED (migration 104 submit_progress_claim) reaches the
  // estimators: the Verifikasi Klaim section of the office Reports tab, which
  // reads deeplink_params.initialSection = 'klaim'.
  ProgressClaimVerify: 'Reports',
  // PROGRESS_CLAIM_RETURNED / PROGRESS_CLAIM_VERIFIED (104) reach whoever
  // submitted: the supervisor's Progres tab, which reads module = 'progress'.
  ProgressClaim: 'Progres',
  // SITE_EVENT_DIGEST (migration 106) opens Papan Ruangan with the "Perlu
  // ditindak" list; params carry projectId, attention and mine.
  RoomBoard: 'RoomBoard',
};

/** Every deeplink_screen a server-side notification is known to use. */
export const KNOWN_DEEPLINK_SCREENS: ReadonlyArray<string> = Object.keys(BASE_ROUTE_MAP);

export function resolveNotificationRoute(
  deeplinkScreen: string,
  role: string | null | undefined,
): string {
  const target = BASE_ROUTE_MAP[deeplinkScreen] ?? deeplinkScreen;
  // Supervisor nav has no Approvals route — their request-status view is the
  // Permintaan tab. Keyed on the resolved route (not notification type) so
  // any current or future type that deeplinks to Approvals is covered.
  if (role === 'supervisor' && target === 'Approvals') return 'Permintaan';
  // The supervisor navigator registers Progres and Laporan; the office and
  // principal navigators register Reports instead. Both claim deeplinks carry
  // initialSection = 'klaim', which Laporan and Reports both read.
  if (role === 'supervisor' && target === 'Reports') return 'Laporan';
  if (role !== 'supervisor' && target === 'Progres') return 'Reports';
  // Only the supervisor navigator registers RoomBoard; the office and
  // principal navigators show the same board as their "Ruangan" tab.
  if (role !== 'supervisor' && target === 'RoomBoard') return 'Rooms';
  return target;
}
