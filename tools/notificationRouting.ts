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
// Used by workflows/App.tsx (push-notification tap listener, all roles) and
// workflows/screens/NotificationsScreen.tsx (in-app list shared by
// supervisor AND principal — hence the role parameter, not a hardcoded map).

const BASE_ROUTE_MAP: Record<string, string> = {
  ApprovalsScreen: 'Approvals',
  POScreen: 'Procurement',
  ReceiptScreen: 'Terima',
};

export function resolveNotificationRoute(
  deeplinkScreen: string,
  role: string | null | undefined,
): string {
  const target = BASE_ROUTE_MAP[deeplinkScreen] ?? deeplinkScreen;
  // Supervisor nav has no Approvals route — their request-status view is the
  // Permintaan tab. Keyed on the resolved route (not notification type) so
  // any current or future type that deeplinks to Approvals is covered.
  if (role === 'supervisor' && target === 'Approvals') return 'Permintaan';
  return target;
}
