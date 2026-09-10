// SANO - Room deep links.
//
// One URL shape, printed on a physical label and encoded in its QR:
//   https://sano-app.vercel.app/r/{projectCode}/{roomCode}
// with the custom scheme sano://r/{projectCode}/{roomCode} as the fallback the
// Android App Link falls back to and as the iOS path in release 1 (spec §18
// item 6: universal links need an Apple team SANO does not have yet).
//
// Parsing is done by hand rather than with `new URL`: for a non-special scheme
// like sano:, WHATWG URL puts the first path segment in `host`, so "sano://r/…"
// parses as host "r" - a shape difference that would have to be special-cased
// anyway. String parsing is shorter, has no polyfill dependency, and is exactly
// as testable.

import { normalizeRoomCode } from './roomCodes';

export const ROOM_LINK_HOST = 'sano-app.vercel.app';
export const ROOM_LINK_HTTPS_PREFIX = `https://${ROOM_LINK_HOST}`;
export const ROOM_LINK_SCHEME_PREFIX = 'sano://';
/** The one path segment every room link starts with. */
export const ROOM_LINK_PATH = 'r';

export interface RoomLinkTarget {
  projectCode: string;
  roomCode: string;
}

/** The URL encoded in the QR and printed as readable text beneath it. */
export function buildRoomUrl(projectCode: string, roomCode: string): string {
  return `${ROOM_LINK_HTTPS_PREFIX}/${ROOM_LINK_PATH}/${encodeURIComponent(projectCode)}/${encodeURIComponent(roomCode)}`;
}

/**
 * Returns the target of a SANO room link, or null for anything else.
 *
 * null is not an error state to swallow: every caller turns it into the exact
 * refusal from spec §8, "QR bukan label ruangan SANO." The room code comes back
 * normalized (so a hand-typed lowercase URL still resolves); the project code
 * comes back trimmed but otherwise untouched, and callers match it
 * case-insensitively against projects.code.
 */
export function parseRoomUrl(url: string): RoomLinkTarget | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  let path: string;

  if (lower.startsWith('https://')) {
    const afterScheme = trimmed.slice('https://'.length);
    const slash = afterScheme.indexOf('/');
    const host = (slash === -1 ? afterScheme : afterScheme.slice(0, slash)).toLowerCase();
    // Exact host match - a suffix check would accept sano-app.vercel.app.evil.com.
    if (host !== ROOM_LINK_HOST) return null;
    path = slash === -1 ? '' : afterScheme.slice(slash);
  } else if (lower.startsWith(ROOM_LINK_SCHEME_PREFIX)) {
    path = `/${trimmed.slice(ROOM_LINK_SCHEME_PREFIX.length).replace(/^\/+/, '')}`;
  } else {
    return null;
  }

  path = path.split('#')[0].split('?')[0];

  const parts = path.split('/').filter((p) => p.length > 0);
  if (parts.length !== 3) return null;
  if (parts[0].toLowerCase() !== ROOM_LINK_PATH) return null;

  let projectCode: string;
  let roomCode: string;
  try {
    projectCode = decodeURIComponent(parts[1]).trim();
    roomCode = normalizeRoomCode(decodeURIComponent(parts[2]));
  } catch {
    // decodeURIComponent throws URIError on a malformed escape; a broken QR is
    // a refusal, not a crash.
    return null;
  }

  if (!projectCode || !roomCode) return null;
  return { projectCode, roomCode };
}
