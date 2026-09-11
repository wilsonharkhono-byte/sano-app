// SANO - Confirm form model (pure).
//
// Decides what SiteEventConfirmScreen pre-fills from the stored AI draft, under
// the spec §1.1 confidence table (tools/siteEventRules.ts confidenceUi), and
// turns the form back into the ConfirmInput the RPC wrapper validates.

import {
  confidenceUi,
  dueDateFromSuggestion,
  isActionableType,
  type ConfidenceUi,
  type ConfirmInput,
} from '../../../tools/siteEventRules';
import type { SiteEvent, SiteEventType } from '../../../tools/types';

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
