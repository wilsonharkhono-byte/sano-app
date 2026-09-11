// SANO - Site event rules (pure).
//
// Spec: docs/superpowers/specs/2026-09-10-room-site-events-design.md §1.1
// (confidence to UI table), §4.2 (confirm_site_event), §5.4 and §12.
//
// Three consumers must agree on these RULES:
//   - the confirm screen, which pre-fills and blocks Konfirmasi with them;
//   - confirm_site_event in migration 097, which re-checks them in SQL because
//     a client can always skip its own validation;
//   - tools/__tests__/migration097.test.ts, which builds the SQL keyword regex
//     from the lists exported here, so a keyword added on one side only fails.
// Agreement is on the RULES, not necessarily on every message's exact
// wording: this module (the pre-flight) reports one error per FIELD, so the
// supervisor sees which field to fix before tapping Konfirmasi; the RPC
// reports one error per RULE CODE (SITE_EVENT_*), mapped to copy in
// tools/siteEvents.ts. Where the same rule reads identically on both sides
// — e.g. CONFIRM_ERRORS.voNoEvidence and the SITE_EVENT_VO_NO_EVIDENCE copy
// — keep the two strings byte-identical, so a supervisor never sees two
// different wordings for the same refusal depending on whether the client
// or the server caught it.

import { ACTIONABLE_EVENT_TYPES, SITE_EVENT_MANUAL_AFTER_ATTEMPTS } from './constants';
import {
  DRAFT_DUE_DAYS_MAX,
  DRAFT_IMPACT_MAX,
  DRAFT_SUMMARY_MAX,
  DRAFT_TITLE_MAX,
  normalizeForQuoteMatch,
} from './siteEventDraftValidate';
import { addCalendarDays, isRealCalendarDate } from './timeWindow';
import type { AiConfidence, SiteEventDraft, SiteEventStatus, SiteEventType } from './types';

/**
 * Written to site_events.last_error by the edge function when the per-project
 * daily cap is spent. Duplicated verbatim in
 * supabase/functions/site-event-analyze/util.ts (Deno cannot import this
 * module); siteEventDraftValidateTwin.test.ts fails if the two differ.
 */
export const AI_QUOTA_MESSAGE =
  'Kuota analisis AI hari ini habis. Draf akan dibuat besok, atau isi manual.';

export const CONFIDENCE_BANNER_MEDIUM = 'Periksa hasil AI sebelum konfirmasi.';
export const CONFIDENCE_BANNER_LOW = 'AI kurang yakin. Pilih jenis dan gerbang sendiri.';

export function isActionableType(type: SiteEventType | null | undefined): boolean {
  return !!type && ACTIONABLE_EVENT_TYPES.includes(type);
}

// ─── Dates ───────────────────────────────────────────────────────────────────

/**
 * A real calendar date written YYYY-MM-DD. Rejects 2026-02-30. Thin wrapper
 * over tools/timeWindow.ts's `isRealCalendarDate`, the single source of
 * truth for date-only arithmetic — kept here under its established name so
 * every existing call site (and the exported signature) stays unchanged.
 */
export function isIsoDate(value: string | null | undefined): value is string {
  return !!value && isRealCalendarDate(value);
}

/**
 * Date-only arithmetic in UTC, so a device timezone can never shift the day.
 * Thin wrapper over tools/timeWindow.ts's `addCalendarDays`.
 */
export function addDaysIso(isoDate: string, days: number): string {
  return addCalendarDays(isoDate, days);
}

/** Today on the phone's own calendar, YYYY-MM-DD (the DailyLogScreen convention). */
export function todayIsoLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The model's "besok" / "minggu ini" as a concrete date the supervisor can see and change. */
export function dueDateFromSuggestion(
  today: string,
  suggestion: SiteEventDraft['due_suggestion'] | null | undefined,
): string | null {
  if (!suggestion || suggestion.kind !== 'relative' || !isIsoDate(today)) return null;
  const days = Math.round(suggestion.days);
  if (!Number.isFinite(days) || days < 1) return null;
  return addDaysIso(today, Math.min(days, DRAFT_DUE_DAYS_MAX));
}

// ─── Confirm validation ──────────────────────────────────────────────────────

export interface ConfirmInput {
  eventType: SiteEventType | null;
  gateCode: string | null;
  stepCode: string | null;
  /**
   * The active steps the screen loaded (listGateStepRefs). Used only to refuse
   * a step that sits under another gate; whether a step exists and is still
   * active is confirm_site_event's call, because this list can be stale.
   */
  activeSteps: ReadonlyArray<{ code: string; gate_code: string }>;
  title: string;
  summary: string;
  ownerId: string | null;
  dueDate: string | null;
  downstreamImpact: string;
  isBlocking: boolean;
  voConfirm: boolean;
  relatedEventId: string | null;
  /** Non-null only when the supervisor changed the transcript on this screen. */
  transcriptEdited: string | null;
  /** The stored ai_draft; null when authoring by hand. */
  draft: SiteEventDraft | null;
  aiMismatch: boolean;
  mismatchAcknowledged: boolean;
  /** YYYY-MM-DD on the phone's calendar. */
  today: string;
}

export type ConfirmValidation = { ok: true } | { ok: false; errors: string[] };

export const CONFIRM_ERRORS = {
  type: 'Pilih jenis kejadian.',
  titleRequired: 'Judul wajib diisi.',
  titleMax: `Judul maksimal ${DRAFT_TITLE_MAX} karakter.`,
  summaryMax: `Ringkasan maksimal ${DRAFT_SUMMARY_MAX} karakter.`,
  impactMax: `Dampak lanjutan maksimal ${DRAFT_IMPACT_MAX} karakter.`,
  stepWithoutGate: 'Pilih gerbang sebelum memilih langkah.',
  stepNotInGate: 'Langkah yang dipilih bukan bagian dari gerbang ini. Pilih ulang langkahnya.',
  ownerRequired: 'Pemilik wajib dipilih untuk isu, hambatan, cacat dan butuh keputusan.',
  dueRequired: 'Tenggat wajib diisi untuk isu, hambatan, cacat dan butuh keputusan.',
  dueFormat: 'Format tenggat harus YYYY-MM-DD.',
  duePast: 'Tenggat tidak boleh sebelum hari ini.',
  // Byte-identical to the RPC's SITE_EVENT_VO_NO_EVIDENCE copy (Task 9's
  // RPC_ERROR_COPY) — see the module header.
  voNoEvidence: 'VO hanya bisa dikonfirmasi bila ada kutipan dasar.',
  mismatchAck: 'Tandai dulu bahwa Anda sudah memeriksa ketidakcocokan foto dan suara.',
} as const;

/** The title exactly as it will be sent: whitespace runs collapsed, trimmed. */
export function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

export function validateConfirmInput(input: ConfirmInput): ConfirmValidation {
  const errors: string[] = [];

  if (!input.eventType) errors.push(CONFIRM_ERRORS.type);

  const title = normalizeTitle(input.title);
  if (!title) errors.push(CONFIRM_ERRORS.titleRequired);
  else if (title.length > DRAFT_TITLE_MAX) errors.push(CONFIRM_ERRORS.titleMax);

  if (input.summary.trim().length > DRAFT_SUMMARY_MAX) errors.push(CONFIRM_ERRORS.summaryMax);
  if (input.downstreamImpact.trim().length > DRAFT_IMPACT_MAX) errors.push(CONFIRM_ERRORS.impactMax);

  if (input.stepCode && !input.gateCode) errors.push(CONFIRM_ERRORS.stepWithoutGate);
  else if (input.stepCode) {
    // Migration 097's composite key refuses this pair anyway; say it in words first.
    const step = input.activeSteps.find((s) => s.code === input.stepCode);
    if (step && step.gate_code !== input.gateCode) errors.push(CONFIRM_ERRORS.stepNotInGate);
  }

  if (isActionableType(input.eventType)) {
    if (!input.ownerId) errors.push(CONFIRM_ERRORS.ownerRequired);
    if (!input.dueDate) errors.push(CONFIRM_ERRORS.dueRequired);
  }

  if (input.dueDate) {
    if (!isIsoDate(input.dueDate)) errors.push(CONFIRM_ERRORS.dueFormat);
    // `input.today` is the phone's LOCAL calendar day (todayIsoLocal), but
    // confirm_site_event re-checks this same rule against Asia/Jakarta (WIB,
    // UTC+7). A supervisor on WITA (UTC+8) or WIT (UTC+9) rolls over to a
    // new local calendar day before Jakarta does, so for up to two hours
    // after local midnight the client can consider a due date "past" that
    // the RPC would still accept as "today" — the client is only ever
    // stricter than the server here, never looser, so this fails closed.
    else if (isIsoDate(input.today) && input.dueDate < input.today) errors.push(CONFIRM_ERRORS.duePast);
  }

  if (input.voConfirm) {
    const quotes = input.draft && input.draft.vo.flag === 'suggested' ? input.draft.vo.evidence_quotes : [];
    if (quotes.length === 0) errors.push(CONFIRM_ERRORS.voNoEvidence);
  }

  if (input.aiMismatch && !input.mismatchAcknowledged) errors.push(CONFIRM_ERRORS.mismatchAck);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ─── Confidence drives the UI, not the database (spec §1.1 rule 6) ───────────

export type VoCheckboxState = 'hidden' | 'unchecked' | 'prechecked';

export interface ConfidenceUi {
  /** Pre-select the AI's event type and gate chips. */
  prefillTypeAndGate: boolean;
  /** Mark the pre-selected chips "Periksa". */
  markPeriksa: boolean;
  /** Low confidence only: the AI's guess, shown as a grey chip the supervisor may tap. */
  hintType: SiteEventType | null;
  hintGate: string | null;
  voCheckbox: VoCheckboxState;
  banner: string | null;
}

/** Not exported: exists only so `confidenceUi`'s switch fails to compile if `AiConfidence` grows a member this function hasn't handled. */
function assertNever(x: never): never {
  throw new Error(`confidenceUi: unhandled AiConfidence "${String(x)}"`);
}

/**
 * The §1.1 table. One addition: when the model did not suggest a VO (or the
 * validator downgraded it), the checkbox is hidden at every confidence level,
 * because confirm_site_event refuses a VO with no surviving quote and a
 * checkbox that can never be confirmed would be a trap.
 */
export function confidenceUi(confidence: AiConfidence | null, draft: SiteEventDraft | null): ConfidenceUi {
  if (!draft || !confidence) {
    return { prefillTypeAndGate: false, markPeriksa: false, hintType: null, hintGate: null, voCheckbox: 'hidden', banner: null };
  }
  const suggested = draft.vo.flag === 'suggested' && draft.vo.evidence_quotes.length > 0;
  switch (confidence) {
    case 'high':
      return {
        prefillTypeAndGate: true, markPeriksa: false, hintType: null, hintGate: null,
        voCheckbox: suggested ? 'prechecked' : 'hidden', banner: null,
      };
    case 'medium':
      return {
        prefillTypeAndGate: true, markPeriksa: true, hintType: null, hintGate: null,
        voCheckbox: suggested ? 'unchecked' : 'hidden', banner: CONFIDENCE_BANNER_MEDIUM,
      };
    case 'low':
      return {
        prefillTypeAndGate: false, markPeriksa: false, hintType: draft.event_type, hintGate: draft.gate_code,
        voCheckbox: 'hidden', banner: CONFIDENCE_BANNER_LOW,
      };
    default:
      return assertNever(confidence);
  }
}

// ─── VO → Catatan Perubahan change_type (spec §4.2 step 2) ───────────────────

/** Substring keywords, matched on the normalized VO evidence quotes. Mirrored in 097. */
export const VO_OWNER_REQUEST_KEYWORDS = ['owner', 'klien', 'pemilik rumah', 'minta', 'permintaan'] as const;
export const VO_DESIGN_KEYWORDS = ['desain', 'desainer', 'gambar', 'revisi'] as const;

export type VoChangeType = 'permintaan_owner' | 'revisi_desain' | 'kondisi_lapangan';

/** The VO evidence exactly as the RPC sees it: joined, lowercased, whitespace collapsed. */
export function voEvidenceText(draft: Pick<SiteEventDraft, 'vo'> | null): string {
  if (!draft) return '';
  return normalizeForQuoteMatch(draft.vo.evidence_quotes.join(' '));
}

/**
 * Uses the HUMAN-confirmed event type, not the draft's, because the RPC maps
 * with p_event_type. Owner-request evidence only counts for butuh_keputusan;
 * design evidence counts for any type; everything else is kondisi_lapangan.
 * Nothing about cost is decided here: the estimator prices it in Catatan
 * Perubahan.
 */
export function mapVoChangeType(eventType: SiteEventType, draft: Pick<SiteEventDraft, 'vo'> | null): VoChangeType {
  const text = voEvidenceText(draft);
  if (eventType === 'butuh_keputusan' && VO_OWNER_REQUEST_KEYWORDS.some((k) => text.includes(k))) {
    return 'permintaan_owner';
  }
  if (VO_DESIGN_KEYWORDS.some((k) => text.includes(k))) return 'revisi_desain';
  return 'kondisi_lapangan';
}

// ─── Manual authoring (spec §6, §12) ─────────────────────────────────────────

export function canOfferManualAuthoring(ev: {
  status: SiteEventStatus;
  analysis_attempts: number;
  last_error: string | null;
}): boolean {
  if (ev.status !== 'pending_analysis') return false;
  return ev.analysis_attempts >= SITE_EVENT_MANUAL_AFTER_ATTEMPTS || ev.last_error === AI_QUOTA_MESSAGE;
}
