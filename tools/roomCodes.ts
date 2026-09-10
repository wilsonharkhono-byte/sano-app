// SANO - Room codes.
//
// normalizeRoomCode is a VERBATIM port of DATUM's normalizeAreaCode
// (DATUM Studio Brain, packages/core/src/areas/extract.ts:100-109). Spec §2
// decision 2: rooms are authored in SANO but shaped like DATUM areas, and the
// release-2 link matches on (project_code, room_code). Two normalizers that
// disagree by one rule turn that link from an upsert into a reconciliation
// meeting, so this function is not the place to be clever. Change it only when
// DATUM changes, and port the change verbatim.
//
// The chain, in order: trim, uppercase, whitespace runs to a single dash, drop
// everything outside [A-Z0-9-], collapse repeated dashes, trim leading and
// trailing dashes, slice to 40 characters.

/** Maximum stored length. Mirrors DATUM's slice and the CHECK in migration 096. */
export const ROOM_CODE_MAX = 40;

export function normalizeRoomCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, ROOM_CODE_MAX);
}

/**
 * The exact shape migration 096 enforces:
 *   CHECK (room_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(room_code) <= 40)
 *
 * Note that normalizeRoomCode can return a string this refuses: the slice runs
 * LAST, so a long name whose 40th character is a separator comes back with a
 * trailing dash. That is not a bug to paper over - the office form shows the
 * preview and refuses to save, and the database refuses too.
 */
const ROOM_CODE_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

export function isValidRoomCode(code: string): boolean {
  return code.length > 0 && code.length <= ROOM_CODE_MAX && ROOM_CODE_RE.test(code);
}
