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
  clearFieldErrors,
  initialConfirmForm,
  relatedSuggestion,
  staleVoQuotes,
  survivingVoQuotes,
  toConfirmInput,
  withEventType,
  withGate,
  withTranscript,
  type ConfirmSource,
} from '../screens/siteEvent/confirmModel';
import { CONFIRM_ERRORS } from '../../tools/siteEventRules';
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

/**
 * The blocker this screen exists to prevent: the supervisor edits the
 * transcript, the AI's VO quotes stop being in it, and confirm_site_event
 * still accepts them, because the RPC reads the STORED draft and never re-runs
 * the literal-substring test. The client is the only place this can be caught,
 * so it has to be caught exactly — matching folds case, whitespace and
 * typographic punctuation, and nothing else.
 */
describe('staleVoQuotes', () => {
  const withQuotes = (...quotes: string[]) =>
    draft({ vo: { flag: 'suggested', reason: 'Owner minta pindah', evidence_quotes: quotes } });

  it('is empty while every quote is still literally in the edited text', () => {
    const d = withQuotes('owner minta dipindah');
    expect(staleVoQuotes(d, ['Pak OWNER   minta dipindah ke atas plafon', null])).toEqual([]);
  });

  it('names the quotes an edit removed, and leaves the surviving ones alone', () => {
    const d = withQuotes('owner minta dipindah', 'plafon belum ditutup');
    // The supervisor corrected "dipindah" to "digeser".
    expect(staleVoQuotes(d, ['owner minta digeser ke atas plafon; plafon belum ditutup', null]))
      .toEqual(['owner minta dipindah']);
  });

  it('still matches after a typographic-apostrophe edit (normalizeForQuoteMatch folds it)', () => {
    const d = withQuotes("owner bilang 'pindah'");
    expect(staleVoQuotes(d, ['Pak owner bilang \u2018pindah\u2019 sekarang', null])).toEqual([]);
  });

  it('treats an emptied transcript as stale evidence, not as no evidence', () => {
    const d = withQuotes('owner minta dipindah');
    expect(staleVoQuotes(d, ['', null])).toEqual(['owner minta dipindah']);
    expect(staleVoQuotes(d, ['', 'owner minta dipindah'])).toEqual([]);
  });

  it('has nothing to say when there is no draft or the model suggested no VO', () => {
    expect(staleVoQuotes(null, [''])).toEqual([]);
    expect(staleVoQuotes(undefined, [''])).toEqual([]);
    expect(staleVoQuotes(draft({ vo: { flag: 'none', reason: '', evidence_quotes: ['owner minta dipindah'] } }), ['']))
      .toEqual([]);
  });
});

/**
 * The complement of staleVoQuotes, and the function that now decides whether
 * Konfirmasi is blocked (SiteEventConfirmScreen's voEvidenceBlocked): mirrors
 * confirm_site_event (migration 100), which keeps whichever quotes still
 * match and refuses the VO only when NONE do. Three scenarios matter to the
 * screen: zero survivors block Konfirmasi, some survivors allow it with a
 * "hanya yang cocok akan dicatat" note, and all surviving means nothing is
 * stale and no note is shown.
 */
describe('survivingVoQuotes', () => {
  const withQuotes = (...quotes: string[]) =>
    draft({ vo: { flag: 'suggested', reason: 'Owner minta pindah', evidence_quotes: quotes } });

  it('is the exact complement of staleVoQuotes for the same draft and sources', () => {
    const d = withQuotes('owner minta dipindah', 'plafon belum ditutup');
    const sources = ['owner minta digeser ke atas plafon; plafon belum ditutup', null];
    expect(survivingVoQuotes(d, sources)).toEqual(['plafon belum ditutup']);
    expect(staleVoQuotes(d, sources)).toEqual(['owner minta dipindah']);
  });

  it('zero survive: the screen blocks Konfirmasi, the same case confirm_site_event (100) refuses', () => {
    const d = withQuotes('owner minta dipindah');
    const sources = ['transkrip baru tanpa kutipan apa pun', null];
    expect(survivingVoQuotes(d, sources)).toEqual([]);
    expect(staleVoQuotes(d, sources)).toEqual(['owner minta dipindah']);
  });

  it('some survive: the screen allows Konfirmasi and shows the "hanya yang cocok akan dicatat" note', () => {
    const d = withQuotes('owner minta dipindah', 'plafon belum ditutup');
    const sources = ['plafon belum ditutup saja', null];
    expect(survivingVoQuotes(d, sources)).toEqual(['plafon belum ditutup']);
    expect(staleVoQuotes(d, sources)).toEqual(['owner minta dipindah']);
  });

  it('all survive: nothing is stale, so the screen shows no note', () => {
    const d = withQuotes('owner minta dipindah');
    const sources = ['Pak OWNER   minta dipindah ke atas plafon', null];
    expect(survivingVoQuotes(d, sources)).toEqual(['owner minta dipindah']);
    expect(staleVoQuotes(d, sources)).toEqual([]);
  });

  it('has nothing to say when there is no draft or the model suggested no VO', () => {
    expect(survivingVoQuotes(null, [''])).toEqual([]);
    expect(survivingVoQuotes(undefined, [''])).toEqual([]);
    expect(survivingVoQuotes(draft({ vo: { flag: 'none', reason: '', evidence_quotes: ['owner minta dipindah'] } }), ['']))
      .toEqual([]);
  });
});

describe('clearFieldErrors', () => {
  it('drops only the messages the edited field owns', () => {
    const errors = [CONFIRM_ERRORS.titleRequired, CONFIRM_ERRORS.dueRequired];
    expect(clearFieldErrors(errors, ['title'])).toEqual([CONFIRM_ERRORS.dueRequired]);
    expect(clearFieldErrors(errors, ['dueDate'])).toEqual([CONFIRM_ERRORS.titleRequired]);
  });

  it('keeps an RPC refusal, which no field edit can be known to fix', () => {
    const rpc = ['Kejadian ini sudah dikonfirmasi.'];
    expect(clearFieldErrors(rpc, ['title', 'dueDate', 'ownerId'])).toEqual(rpc);
  });

  it('returns the same array when nothing changed, so React does not re-render for free', () => {
    const errors = [CONFIRM_ERRORS.titleRequired];
    expect(clearFieldErrors(errors, ['summary'])).toBe(errors);
    expect(clearFieldErrors([], ['title'])).toEqual([]);
  });
});
