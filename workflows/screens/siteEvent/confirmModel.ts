// SANO - Confirm form model (pure).
//
// Decides what SiteEventConfirmScreen pre-fills from the stored AI draft, under
// the spec §1.1 confidence table (tools/siteEventRules.ts confidenceUi), and
// turns the form back into the ConfirmInput the RPC wrapper validates.

import {
  CONFIRM_ERRORS,
  confidenceUi,
  dueDateFromSuggestion,
  isActionableType,
  type ConfidenceUi,
  type ConfirmInput,
} from '../../../tools/siteEventRules';
import { isLiteralQuote } from '../../../tools/siteEventDraftValidate';
import type { SiteEvent, SiteEventDraft, SiteEventType } from '../../../tools/types';

export type ConfirmSource = Pick<
  SiteEvent,
  'ai_draft' | 'ai_confidence' | 'ai_mismatch' | 'gate_code' | 'reporter_id' | 'transcript' | 'transcript_edited'
>;

export interface ConfirmForm {
  eventType: SiteEventType | null;
  gateCode: string | null;
  stepCode: string | null;
  title: string;
  summary: string;
  downstreamImpact: string;
  isBlocking: boolean;
  ownerId: string | null;
  /** YYYY-MM-DD or empty. */
  dueDate: string;
  voConfirm: boolean;
  relatedEventId: string | null;
  transcript: string;
  transcriptDirty: boolean;
  mismatchAcknowledged: boolean;
}

/**
 * `manual` = the supervisor chose "Isi manual": the draft is ignored even if
 * one exists. The capture-time gate (ev.gate_code) was chosen by the
 * supervisor, not guessed by the model, so it is kept whenever the AI's gate
 * is not pre-filled.
 */
export function initialConfirmForm(
  ev: ConfirmSource,
  today: string,
  manual: boolean,
): { form: ConfirmForm; ui: ConfidenceUi } {
  const draft = manual ? null : ev.ai_draft;
  const ui = confidenceUi(manual ? null : ev.ai_confidence, draft);
  const prefilled = ui.prefillTypeAndGate && draft ? draft : null;

  const eventType = prefilled ? prefilled.event_type : null;
  const gateCode = prefilled && prefilled.gate_code ? prefilled.gate_code : ev.gate_code;
  const stepCode = prefilled && prefilled.gate_code === gateCode ? prefilled.step_code : null;

  return {
    ui,
    form: {
      eventType,
      gateCode,
      stepCode,
      title: draft?.title ?? '',
      summary: draft?.summary ?? '',
      downstreamImpact: draft?.downstream_impact ?? '',
      isBlocking: draft?.is_blocking ?? false,
      ownerId: isActionableType(eventType) ? ev.reporter_id : null,
      dueDate: draft ? dueDateFromSuggestion(today, draft.due_suggestion) ?? '' : '',
      voConfirm: ui.voCheckbox === 'prechecked',
      relatedEventId: null,
      transcript: ev.transcript_edited ?? ev.transcript ?? '',
      transcriptDirty: false,
      mismatchAcknowledged: false,
    },
  };
}

/** Spec §5.4: the owner defaults to the reporter for actionable types, so it is never empty by accident. */
export function withEventType(form: ConfirmForm, type: SiteEventType, reporterId: string): ConfirmForm {
  const next: ConfirmForm = { ...form, eventType: type };
  if (isActionableType(type) && !form.ownerId) next.ownerId = reporterId;
  return next;
}

export function withGate(form: ConfirmForm, code: string | null): ConfirmForm {
  return code === form.gateCode ? form : { ...form, gateCode: code, stepCode: null };
}

export function withTranscript(form: ConfirmForm, text: string): ConfirmForm {
  return { ...form, transcript: text, transcriptDirty: true };
}

/** `activeSteps` is the step list the screen loaded, so validateConfirmInput can refuse a step under another gate. */
export function toConfirmInput(
  form: ConfirmForm,
  ev: ConfirmSource,
  today: string,
  manual: boolean,
  activeSteps: ConfirmInput['activeSteps'],
): ConfirmInput {
  const due = form.dueDate.trim();
  return {
    eventType: form.eventType,
    gateCode: form.gateCode,
    stepCode: form.stepCode,
    activeSteps,
    title: form.title,
    summary: form.summary,
    ownerId: form.ownerId,
    dueDate: due ? due : null,
    downstreamImpact: form.downstreamImpact,
    isBlocking: form.isBlocking,
    voConfirm: form.voConfirm,
    relatedEventId: form.relatedEventId,
    transcriptEdited: form.transcriptDirty ? form.transcript : null,
    draft: manual ? null : ev.ai_draft,
    aiMismatch: manual ? false : ev.ai_mismatch,
    mismatchAcknowledged: form.mismatchAcknowledged,
    today,
  };
}

/** "Mungkin terkait": the AI's suggestion, only while that event is still open in the room. */
export function relatedSuggestion(
  ev: Pick<ConfirmSource, 'ai_draft'>,
  openEvents: Array<{ id: string; title: string | null }>,
): { id: string; title: string } | null {
  const id = ev.ai_draft?.related_open_event_id;
  if (!id) return null;
  const match = openEvents.find((e) => e.id === id);
  return match ? { id: match.id, title: match.title ?? 'Tanpa judul' } : null;
}


// ─── VO evidence must still be in the text the supervisor can see ────────────

/**
 * Shown, and Konfirmasi blocked, when the supervisor edited the transcript out
 * from under the AI's VO quotes.
 *
 * This is the one rule on this screen the server does NOT repeat.
 * confirm_site_event (097:681-697) reads the quotes out of the STORED
 * `ai_draft` and only checks that `vo.flag = 'suggested'` and the array is
 * non-empty — it never re-runs the literal-substring test, because the draft
 * it reads was written by the edge function, which ran that test once at
 * draft-write time (tools/siteEventDraftValidate.ts `isLiteralQuote`). A
 * transcript edit after that point cannot invalidate the stored quotes as far
 * as the RPC is concerned, so the resulting Catatan Perubahan would carry a
 * "Dasar" the transcript no longer contains. Refusing here is what keeps VO
 * evidence real (spec §1.1 rule 4).
 */
export const VO_STALE_EVIDENCE_MESSAGE =
  'Kutipan dasar VO tidak lagi ada di transkrip yang Anda ubah. Jalankan "Analisis ulang", atau hapus centang VO.';

/**
 * The VO evidence quotes that are no longer literal substrings of `sources`
 * — normally `[form.transcript, event.raw_text]`, i.e. the CURRENT edited
 * text, not the transcript the model was given.
 *
 * Matching is `isLiteralQuote`'s, byte-for-byte the rule the edge function
 * applied: NFC, zero-width strip, typographic quotes and dashes folded,
 * lowercased, whitespace collapsed. Fixing a mis-heard word breaks the quote;
 * retyping the same words with a curly apostrophe does not.
 *
 * Returns `[]` when there is nothing to be stale about (no draft, or the model
 * did not suggest a VO), so a caller can treat "empty" as "nothing to block".
 */
export function staleVoQuotes(
  draft: SiteEventDraft | null | undefined,
  sources: ReadonlyArray<string | null | undefined>,
): string[] {
  if (!draft || draft.vo.flag !== 'suggested') return [];
  return draft.vo.evidence_quotes.filter((quote) => !isLiteralQuote(quote, sources));
}

// ─── Per-field error clearing ────────────────────────────────────────────────

/**
 * Which pre-flight messages (tools/siteEventRules.ts CONFIRM_ERRORS) each form
 * field can produce. Only these are cleared when that field is edited: an RPC
 * refusal, or any message not listed here, survives until the next Konfirmasi,
 * because this screen cannot know whether editing a field fixed it.
 */
const FIELD_ERRORS: Partial<Record<keyof ConfirmForm, ReadonlyArray<string>>> = {
  eventType: [CONFIRM_ERRORS.type, CONFIRM_ERRORS.ownerRequired, CONFIRM_ERRORS.dueRequired],
  gateCode: [CONFIRM_ERRORS.stepWithoutGate, CONFIRM_ERRORS.stepNotInGate],
  stepCode: [CONFIRM_ERRORS.stepWithoutGate, CONFIRM_ERRORS.stepNotInGate],
  title: [CONFIRM_ERRORS.titleRequired, CONFIRM_ERRORS.titleMax],
  summary: [CONFIRM_ERRORS.summaryMax],
  downstreamImpact: [CONFIRM_ERRORS.impactMax],
  ownerId: [CONFIRM_ERRORS.ownerRequired],
  dueDate: [CONFIRM_ERRORS.dueRequired, CONFIRM_ERRORS.dueFormat, CONFIRM_ERRORS.duePast],
  voConfirm: [CONFIRM_ERRORS.voNoEvidence],
  mismatchAcknowledged: [CONFIRM_ERRORS.mismatchAck],
};

/** Drops the errors `fields` own, so a corrected field stops shouting at the supervisor. */
export function clearFieldErrors(errors: ReadonlyArray<string>, fields: ReadonlyArray<keyof ConfirmForm>): string[] {
  if (errors.length === 0 || fields.length === 0) return errors as string[];
  const owned = new Set<string>();
  for (const field of fields) for (const message of FIELD_ERRORS[field] ?? []) owned.add(message);
  if (owned.size === 0) return errors as string[];
  const next = errors.filter((e) => !owned.has(e));
  return next.length === errors.length ? (errors as string[]) : next;
}
