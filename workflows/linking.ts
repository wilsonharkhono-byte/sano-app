// SANO - React Navigation deep-link config, shared by all three containers.
//
// One URL shape (tools/roomLinks.ts) resolving to a different screen per role:
// a supervisor lands on the room itself, office and principal land on a
// read-only detail. Spec §8.
//
// Only the routes that need a path are declared. React Navigation 6 does NOT
// leave the others path-less: its getPathFromState falls back to the route
// name, so switching tabs on web would rewrite the address bar to /Permintaan,
// /Home and so on (verified 2026-09-10 against @react-navigation/core 6.4.17).
// This app had no linking config before, so its address bar never changed. The
// getPathFromState override below keeps it that way for every route that is not
// a declared, non-root link.
//
// Cold start before login: App.tsx renders LoginScreen and mounts no
// NavigationContainer, so the URL is not consumed. On web it stays in the
// address bar and resolves when the container mounts after sign-in; on native
// Linking.getInitialURL() still returns it at that point. No extra machinery.

import { getPathFromState as defaultGetPathFromState } from '@react-navigation/native';
import type { LinkingOptions } from '@react-navigation/native';
import { ROOM_LINK_HTTPS_PREFIX, ROOM_LINK_SCHEME_PREFIX } from '../tools/roomLinks';

export const LINKING_PREFIXES = [ROOM_LINK_HTTPS_PREFIX, ROOM_LINK_SCHEME_PREFIX];

/** The path pattern every container maps to its own room screen. */
export const ROOM_PATH = 'r/:projectCode/:roomCode';

type NavState = Parameters<typeof defaultGetPathFromState>[0];
type PathOptions = Parameters<typeof defaultGetPathFromState>[1];

/** Name of the deepest focused route, walking nested navigator state. */
export function focusedRouteName(state: NavState | undefined): string | undefined {
  let current: any = state;
  let name: string | undefined;
  while (current && Array.isArray(current.routes) && current.routes.length > 0) {
    const route = current.routes[current.index ?? current.routes.length - 1];
    name = route.name;
    current = route.state;
  }
  return name;
}

export function buildLinking<T extends object>(
  screens: Record<string, string>,
): LinkingOptions<T> {
  const linked = new Set(Object.keys(screens).filter((name) => screens[name] !== ''));
  return {
    prefixes: [...LINKING_PREFIXES],
    config: { screens },
    getPathFromState(state: NavState, options?: PathOptions) {
      const leaf = focusedRouteName(state);
      return leaf !== undefined && linked.has(leaf) ? defaultGetPathFromState(state, options) : '/';
    },
  } as LinkingOptions<T>;
}
