/**
 * What the confirm screen pre-fills is the truth contract at the point where a
 * human is most likely to just tap "Konfirmasi" (spec §1.1 rule 6):
 *  • high and medium confidence pre-fill type and gate; low leaves them to the
 *    supervisor and only hints, so a guess is never pre-selected for them;
 *  • the gate the supervisor chose at capture is theirs, not the AI's, so it
 *    survives low confidence and manual authoring;
 *  • an actionable type always starts with an owner (the reporter), never empty;
 *  • the transcript is only sent back when the supervisor actually edited it.
 */
import {
  initialConfirmForm,
  relatedSuggestion,
  toConfirmInput,
  withEventType,
  withGate,
  withTranscript,
  type ConfirmSource,
} from '../screens/siteEvent/confirmModel';
import type { SiteEventDraft } from '../../tools/types';

const TODAY = '2026-09-10';
const STEPS = [{ code: 'A2', gate_code: 'A' }];

const draft = (over: Partial<SiteEventDraft> = {}): SiteEventDraft => ({
  event_type: 'hambatan',
  gate_code: 'A',
  step_code: 'A2',
  title: 'Pipa AC menghalangi plafon',
  summary: 'Plafon belum bisa ditutup.',
  discipline: 'AC',
  is_blocking: true,
  downstream_impact: 'Gerbang C tertahan.',
  due_suggestion: { kind: 'relative', days: 2 },
  vo: { flag: 'suggested', reason: 'Owner minta pindah', evidence_quotes: ['owner minta dipindah'] },
  mismatch: { flag: false, reason: null },
  related_open_event_id: 'open-1',
  confidence: 'high',
  evidence_quotes: [],
  dropped: [],
  ...over,
});

const source = (over: Partial<ConfirmSource> = {}): ConfirmSource => ({
  ai_draft: draft(),
  ai_confidence: 'high',
  ai_mismatch: false,
  gate_code: 'C',
  reporter_id: 'reporter-1',
  transcript: 'owner minta dipindah ke atas plafon',
  transcript_edited: null,
  ...over,
});

describe('initialConfirmForm', () => {
  it('high confidence: pre-fills type, gate and step, defaults the owner and due date, pre-checks VO', () => {
    const { form, ui } = initialConfirmForm(source(), TODAY, false);
    expect(form).toMatchObject({
      eventType: 'hambatan', gateCode: 'A', stepCode: 'A2', title: 'Pipa AC menghalangi plafon',
      summary: 'Plafon belum bisa ditutup.', downstreamImpact: 'Gerbang C tertahan.', isBlocking: true,
      ownerId: 'reporter-1', dueDate: '2026-09-12', voConfirm: true, relatedEventId: null,
      transcript: 'owner minta dipindah ke atas plafon', transcriptDirty: false, mismatchAcknowledged: false,
    });
    expect(ui.markPeriksa).toBe(false);
  });

  it('medium confidence: pre-fills with Periksa and leaves VO unchecked', () => {
    const { form, ui } = initialConfirmForm(source({ ai_confidence: 'medium', ai_draft: draft({ confidence: 'medium' }) }), TODAY, false);
    expect(form.eventType).toBe('hambatan');
    expect(form.voConfirm).toBe(false);
    expect(ui).toMatchObject({ markPeriksa: true, voCheckbox: 'unchecked' });
  });

  it('low confidence: leaves type empty, keeps the capture gate, hints the AI guess, no owner yet', () => {
    const { form, ui } = initialConfirmForm(source({ ai_confidence: 'low', ai_draft: draft({ confidence: 'low' }) }), TODAY, false);
    expect(form).toMatchObject({ eventType: null, gateCode: 'C', stepCode: null, ownerId: null, voConfirm: false });
    expect(ui).toMatchObject({ hintType: 'hambatan', hintGate: 'A', voCheckbox: 'hidden' });
  });

  it('manual authoring: ignores the draft entirely but keeps the capture gate and the transcript', () => {
    const { form, ui } = initialConfirmForm(source({ transcript_edited: 'koreksi pengawas' }), TODAY, true);
    expect(form).toMatchObject({
      eventType: null, gateCode: 'C', title: '', summary: '', dueDate: '', voConfirm: false, transcript: 'koreksi pengawas',
    });
    expect(ui.banner).toBeNull();
  });
});

describe('form updates', () => {
  it('choosing an actionable type fills an empty owner with the reporter, never overwrites a chosen one', () => {
    const { form } = initialConfirmForm(source({ ai_confidence: 'low', ai_draft: draft({ confidence: 'low' }) }), TODAY, false);
    expect(withEventType(form, 'cacat', 'reporter-1').ownerId).toBe('reporter-1');
    expect(withEventType({ ...form, ownerId: 'someone-else' }, 'isu', 'reporter-1').ownerId).toBe('someone-else');
    expect(withEventType(form, 'progres', 'reporter-1').ownerId).toBeNull();
  });

  it('changing the gate clears the step; re-selecting the same gate changes nothing', () => {
    const { form } = initialConfirmForm(source(), TODAY, false);
    expect(withGate(form, 'B')).toMatchObject({ gateCode: 'B', stepCode: null });
    expect(withGate(form, 'A')).toBe(form);
  });
});

describe('toConfirmInput', () => {
  it('sends the transcript only when edited, a blank due date as null, and the stored draft', () => {
    const src = source();
    const { form } = initialConfirmForm(src, TODAY, false);
    const clean = toConfirmInput({ ...form, dueDate: '  ' }, src, TODAY, false, STEPS);
    expect(clean).toMatchObject({ transcriptEdited: null, dueDate: null, aiMismatch: false, today: TODAY });
    expect(clean.draft).toBe(src.ai_draft);
    expect(clean.activeSteps).toBe(STEPS);
    const edited = toConfirmInput(withTranscript(form, 'owner minta dipindahkan ke atas plafon'), src, TODAY, false, STEPS);
    expect(edited.transcriptEdited).toBe('owner minta dipindahkan ke atas plafon');
  });

  it('manual authoring sends no draft and no mismatch flag', () => {
    const src = source({ ai_mismatch: true });
    const { form } = initialConfirmForm(src, TODAY, true);
    expect(toConfirmInput(form, src, TODAY, true, STEPS)).toMatchObject({ draft: null, aiMismatch: false });
  });
});

describe('relatedSuggestion', () => {
  it('offers the AI suggestion only while that event is still open in the room', () => {
    expect(relatedSuggestion(source(), [{ id: 'open-1', title: 'Floor drain miring' }])).toEqual({ id: 'open-1', title: 'Floor drain miring' });
    expect(relatedSuggestion(source(), [{ id: 'other', title: 'x' }])).toBeNull();
    expect(relatedSuggestion(source({ ai_draft: null }), [{ id: 'open-1', title: 'x' }])).toBeNull();
  });
});
