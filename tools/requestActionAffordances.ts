// SANO — which material-request actions a single Approvals card may offer.
//
// This is the role × status projection of the separation-of-duties matrix
// (docs/superpowers/specs/2026-08-15-approval-po-separation-of-duties-design.md
// §3, §5.2, §6). It exists so office/screens/ApprovalsScreen.tsx can stay a
// thin renderer: the screen asks "what may this user do with this card" and
// renders the answer, instead of growing a nest of role/status conditionals
// that would inevitably drift from tools/rolePermissions.ts.
//
// It deliberately re-derives NOTHING: every allowed/denied decision below is
// delegated to rolePermissions, which is the single implementation of the
// matrix and the mirror of migration 088's transition guard. The only thing
// added here is the status→action mapping and the choice of WHICH denial
// sentence to surface, since the same role can be denied for two different
// reasons (an admin may not approve, and may not clear a hold — different copy).

import { MRStatus, type UserRoleType } from './constants';
import {
  canApproveOrRejectRequest,
  canClearAutoHold,
  canManuallyHoldRequest,
  canReturnApprovedRequest,
} from './rolePermissions';

export interface RequestActionAffordances {
  /** The "Tolak" / "Approve" pair — the reviewer's verdict. */
  showDecide: boolean;
  /** Principal-only "Tahan" (manual hold) — unchanged behaviour, spec §3. */
  showHold: boolean;
  /** "Buka Kembali" — RETURNED → PENDING, available but never required (spec §5.2). */
  showReopen: boolean;
  /** "Kembalikan ke estimator" — APPROVED → RETURNED, with a mandatory reason. */
  showReturn: boolean;
  /**
   * One Indonesian line to render where the buttons would have been, so a
   * withheld action never reads as a bug (spec §6). Empty string means render
   * nothing — either this role can act, or nobody can act on this status.
   */
  withheldNotice: string;
}

const NONE: RequestActionAffordances = {
  showDecide: false,
  showHold: false,
  showReopen: false,
  showReturn: false,
  withheldNotice: '',
};

/**
 * @param role   the signed-in user's role, or null/undefined while the profile
 *               is still loading. Unknown role ⇒ no actions AND no explanation:
 *               "we do not know yet" must not be rendered as "you are not
 *               allowed".
 * @param status `material_request_headers.overall_status`, typed as the raw
 *               string the row carries. A status this module does not
 *               recognise yields no affordances rather than a guess.
 */
export function getRequestActionAffordances(
  role: UserRoleType | null | undefined,
  status: string,
): RequestActionAffordances {
  if (!role) return NONE;

  // Manual hold is offered only from the two states it has ever been offered
  // from, and only to the principal — spec §3 marks this row *(unchanged)*.
  // It is intentionally NOT explained away when withheld: the card already
  // shows the verdict buttons in those states, so no empty space appears.
  const showHold =
    (status === MRStatus.PENDING || status === MRStatus.UNDER_REVIEW) &&
    canManuallyHoldRequest(role).allowed;

  // Clearing a hold is its own capability (spec §2 decision 7) with its own
  // copy, so AUTO_HOLD is checked before the ordinary open states.
  if (status === MRStatus.AUTO_HOLD) {
    const perm = canClearAutoHold(role);
    return { ...NONE, showDecide: perm.allowed, withheldNotice: perm.reason };
  }

  if (
    status === MRStatus.PENDING ||
    status === MRStatus.UNDER_REVIEW ||
    status === MRStatus.RETURNED
  ) {
    const perm = canApproveOrRejectRequest(role);
    return {
      ...NONE,
      showDecide: perm.allowed,
      showHold,
      // Re-opening a returned request is the same reviewer capability as
      // deciding it; it is offered alongside the verdict, never instead of it,
      // so the round trip never costs an extra click (spec §5.2).
      showReopen: status === MRStatus.RETURNED && perm.allowed,
      withheldNotice: perm.reason,
    };
  }

  if (status === MRStatus.APPROVED) {
    const perm = canReturnApprovedRequest(role);
    return { ...NONE, showReturn: perm.allowed, withheldNotice: perm.reason };
  }

  // REJECTED is terminal, and an unrecognised status is not ours to interpret.
  // Neither withholds anything from anyone, so neither carries an explanation.
  return NONE;
}
