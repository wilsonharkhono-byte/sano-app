// Deno tests for the copied validator. The full suite lives in jest
// (tools/__tests__/siteEventDraftValidate.test.ts) against the source of
// truth; these prove the COPY behaves the same under Deno's type checker.
import { assert, assertEquals } from 'std/assert';
import { validateSiteEventDraft, type DraftValidationContext } from './validate.ts';

const TRANSCRIPT = 'Pipa AC menonjol di sisi jendela, owner minta dipindah ke atas plafon.';

const ctx = (over: Partial<DraftValidationContext> = {}): DraftValidationContext => ({
  gateCodes: ['A', 'B'],
  steps: [{ code: 'A2', gate_code: 'A' }],
  openEventIds: [],
  transcript: TRANSCRIPT,
  rawText: null,
  ...over,
});

const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  event_type: 'butuh_keputusan',
  gate_code: 'A',
  step_code: 'A2',
  title: 'Pipa AC menonjol',
  summary: 'Owner minta pipa dipindah.',
  discipline: 'AC',
  is_blocking: true,
  downstream_impact: null,
  due_suggestion: { kind: 'none', days: 0 },
  vo: { flag: 'suggested', reason: 'Permintaan owner', evidence_quotes: ['owner minta dipindah'] },
  mismatch: { flag: false, reason: null },
  related_open_event_id: null,
  confidence: 'high',
  evidence_quotes: ['pipa ac menonjol'],
  ...over,
});

Deno.test('accepts a well-formed draft with no drops', () => {
  const r = validateSiteEventDraft(raw(), ctx());
  assert(r.ok);
  if (r.ok) assertEquals(r.dropped, []);
});

Deno.test('drops a paraphrased quote', () => {
  const r = validateSiteEventDraft(raw({ evidence_quotes: ['pipanya bengkok'] }), ctx());
  assert(r.ok);
  if (r.ok) assertEquals(r.draft.evidence_quotes, []);
});

Deno.test('downgrades a VO whose quotes all drop', () => {
  const r = validateSiteEventDraft(raw({ vo: { flag: 'suggested', reason: 'x', evidence_quotes: ['desain berubah'] } }), ctx());
  assert(r.ok);
  if (r.ok) assertEquals(r.draft.vo.flag, 'none');
});

Deno.test('drops an invented gate code', () => {
  const r = validateSiteEventDraft(raw({ gate_code: 'Q', step_code: null }), ctx());
  assert(r.ok);
  if (r.ok) assertEquals(r.draft.gate_code, null);
});

Deno.test('drops a step that sits under another gate, or under no valid gate', () => {
  const other = validateSiteEventDraft(raw({ gate_code: 'B', step_code: 'A2' }), ctx());
  assert(other.ok);
  if (other.ok) {
    assertEquals(other.draft.gate_code, 'B');
    assertEquals(other.draft.step_code, null);
    assertEquals(other.dropped.some((d) => d.field === 'step_code' && d.reason === 'langkah bukan milik gerbang yang dipilih'), true);
  }
  const noGate = validateSiteEventDraft(raw({ gate_code: 'Q', step_code: 'A2' }), ctx());
  assert(noGate.ok);
  if (noGate.ok) assertEquals(noGate.draft.step_code, null);
});

Deno.test('drops a cost estimate key', () => {
  const r = validateSiteEventDraft(raw({ estimasi_biaya: 1500000 }), ctx());
  assert(r.ok);
  if (r.ok) {
    assertEquals(Object.keys(r.draft).includes('estimasi_biaya'), false);
    assertEquals(r.dropped.some((d) => d.field === 'estimasi_biaya'), true);
  }
});

Deno.test('caps confidence at medium when transcription failed', () => {
  const r = validateSiteEventDraft(raw(), ctx({ transcriptionFailed: true }));
  assert(r.ok);
  if (r.ok) assertEquals(r.draft.confidence, 'medium');
});
