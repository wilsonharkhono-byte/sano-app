// workflows/pendingDeeplink.ts
// SANO — a deeplink that names another project waits for the project switch.
//
// Switching projects unmounts the navigator: RoleRouter (workflows/App.tsx)
// shows its spinner until the new project's data loads, which also clears
// every screen's in-memory state, such as Permintaan's allocation caches, so
// nothing built for one project is submitted under another. A notification
// tap for another project therefore switches first, and RoleRouter replays the
// navigation once the new navigator is ready. No React, no Supabase.

export interface PendingDeeplink {
  screen: string;
  params: Record<string, unknown>;
}

let pending: PendingDeeplink | null = null;

export function queueDeeplink(screen: string, params: Record<string, unknown>): void {
  pending = { screen, params };
}

/** The queued deeplink, removed from the queue. */
export function takeDeeplink(): PendingDeeplink | null {
  const next = pending;
  pending = null;
  return next;
}

export interface DeeplinkContext {
  currentProjectId: string | null | undefined;
  visibleProjectIds: ReadonlyArray<string>;
  setActiveProject: (projectId: string) => void;
  navigate: (screen: string, params: Record<string, unknown>) => void;
}

/**
 * Opens an already-resolved route. Params are copied, so a screen that applies
 * params once per navigation still reacts to a second tap on the same link.
 * When the params name another project the user can see, the project switches
 * first and the navigation waits in the queue for RoleRouter to replay it.
 */
export function routeDeeplink(
  screen: string,
  params: Record<string, unknown> | null | undefined,
  ctx: DeeplinkContext,
): 'navigated' | 'queued' {
  const fresh = { ...(params ?? {}) };
  const projectId = typeof fresh.projectId === 'string' ? fresh.projectId : null;
  if (projectId && ctx.currentProjectId && projectId !== ctx.currentProjectId && ctx.visibleProjectIds.includes(projectId)) {
    queueDeeplink(screen, fresh);
    ctx.setActiveProject(projectId);
    return 'queued';
  }
  ctx.navigate(screen, fresh);
  return 'navigated';
}
