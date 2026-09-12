/**
 * The validator is where the truth contract (spec §1.1 rules 4 and 5) becomes
 * code. Everything the model returns passes through it before a human sees
 * it, so each test pins one way a model could put words in a supervisor's
 * mouth:
 *
 *  • a "quote" that is really a paraphrase (dropped, with the reason kept);
 *  • a VO suggestion with nothing to point at (downgraded to none);
 *  • a gate, step or related-event id the model invented, or a real step
 *    under another gate (dropped);
 *  • a cost estimate smuggled in as an extra key (dropped);
 *  • a confident answer built on a failed transcription (capped at medium).
 *
 * The same file is copied byte-for-byte into the Deno function (task 6), so
 * these tests cover production behaviour, not a look-alike.
 */
import {
  validateSiteEventDraft,
  normalizeForQuoteMatch,
  isLiteralQuote,
  DRAFT_TITLE_MAX,
  DRAFT_SUMMARY_MAX,
  DRAFT_QUOTES_MAX,
  DRAFT_DUE_DAYS_MAX,
  type DraftValidationContext,
} from '../siteEventDraftValidate';

const TRANSCRIPT = 'Pipa AC  menonjol\n di sisi jendela, owner minta dipindah ke atas plafon. Tukang besok bobok dinding.';
const NOTE = 'Kusen jendela belum dipasang';
const OPEN_EVENT_ID = '11111111-1111-4111-8111-111111111111';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const ctx = (over: Partial<DraftValidationContext> = {}): DraftValidationContext => ({
  gateCodes: ['A', 'B', 'C', 'D'],
  steps: [{ code: 'A2', gate_code: 'A' }, { code: 'C1', gate_code: 'C' }],
  openEventIds: [OPEN_EVENT_ID],
  transcript: TRANSCRIPT,
  rawText: NOTE,
  ...over,
});

const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  event_type: 'butuh_keputusan',
  gate_code: 'A',
  step_code: 'A2',
  title: 'Pipa AC menonjol di sisi jendela',
  summary: 'Owner minta jalur pipa AC dipindah ke atas plafon.',
  discipline: 'AC',
  is_blocking: true,
  downstream_impact: 'Plafon belum bisa ditutup.',
  due_suggestion: { kind: 'relative', days: 1 },
  vo: { flag: 'suggested', reason: 'Permintaan owner mengubah jalur pipa.', evidence_quotes: ['owner minta dipindah ke atas plafon'] },
  mismatch: { flag: false, reason: null },
  related_open_event_id: null,
  confidence: 'high',
  evidence_quotes: ['pipa ac menonjol di sisi jendela'],
  ...over,
});

describe('validateSiteEventDraft - hard rejections', () => {
  it('rejects a payload that is not an object', () => {
    expect(validateSiteEventDraft(null, ctx())).toEqual({ ok: false, reason: 'draf bukan objek JSON' });
    expect(validateSiteEventDraft([1, 2], ctx()).ok).toBe(false);
    expect(validateSiteEventDraft('teks', ctx()).ok).toBe(false);
  });

  it('rejects an event_type outside the six', () => {
    const r = validateSiteEventDraft(raw({ event_type: 'defect' }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/event_type tidak valid/);
  });

  it('rejects a confidence outside high/medium/low', () => {
    const r = validateSiteEventDraft(raw({ confidence: 0.9 }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/confidence tidak valid/);
  });

  it('rejects an empty or whitespace-only title', () => {
    expect(validateSiteEventDraft(raw({ title: '   ' }), ctx()).ok).toBe(false);
    expect(validateSiteEventDraft(raw({ title: undefined }), ctx()).ok).toBe(false);
  });
});

describe('validateSiteEventDraft - a well-formed draft', () => {
  it('keeps every field and records no drops', () => {
    const r = validateSiteEventDraft(raw(), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropped).toEqual([]);
    expect(r.draft).toEqual({
      event_type: 'butuh_keputusan',
      gate_code: 'A',
      step_code: 'A2',
      title: 'Pipa AC menonjol di sisi jendela',
      summary: 'Owner minta jalur pipa AC dipindah ke atas plafon.',
      discipline: 'AC',
      is_blocking: true,
      downstream_impact: 'Plafon belum bisa ditutup.',
      due_suggestion: { kind: 'relative', days: 1 },
      vo: { flag: 'suggested', reason: 'Permintaan owner mengubah jalur pipa.', evidence_quotes: ['owner minta dipindah ke atas plafon'] },
      mismatch: { flag: false, reason: null },
      related_open_event_id: null,
      confidence: 'high',
      evidence_quotes: ['pipa ac menonjol di sisi jendela'],
      dropped: [],
    });
  });
});

describe('literal quote matching (rule 4)', () => {
  it('normalizes case and collapses every whitespace run', () => {
    expect(normalizeForQuoteMatch('  Pipa AC \n\t menonjol  ')).toBe('pipa ac menonjol');
  });

  it('matches across the double space and newline in the transcript', () => {
    expect(isLiteralQuote('PIPA AC MENONJOL DI SISI', [TRANSCRIPT, null])).toBe(true);
  });

  it('matches against the typed note too', () => {
    expect(isLiteralQuote('kusen jendela belum', [TRANSCRIPT, NOTE])).toBe(true);
  });

  it('refuses a paraphrase', () => {
    expect(isLiteralQuote('owner ingin pipa dipindahkan', [TRANSCRIPT, NOTE])).toBe(false);
  });

  it(`refuses a quote shorter than 4 characters, because "ac" is in everything`, () => {
    expect(isLiteralQuote('ac', [TRANSCRIPT])).toBe(false);
    expect(isLiteralQuote('   ', [TRANSCRIPT])).toBe(false);
  });

  it('drops a non-literal evidence quote and says why', () => {
    const r = validateSiteEventDraft(raw({ evidence_quotes: ['pipa ac menonjol', 'pipa AC terlihat bengkok'] }), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.evidence_quotes).toEqual(['pipa ac menonjol']);
    expect(r.dropped).toContainEqual({
      field: 'evidence_quotes',
      reason: 'bukan kutipan persis dari transkrip atau catatan',
      value: 'pipa AC terlihat bengkok',
    });
  });

  it('drops non-string quote entries and a non-array quote list', () => {
    const r = validateSiteEventDraft(raw({ evidence_quotes: 'pipa ac menonjol' }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.evidence_quotes).toEqual([]);
    expect(r.dropped.map((d) => d.field)).toContain('evidence_quotes');
  });

  it('removes duplicate quotes, treating case and whitespace as equivalent', () => {
    const r = validateSiteEventDraft(raw({ evidence_quotes: ['pipa ac', 'Pipa AC', 'menonjol'] }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.evidence_quotes).toEqual(['pipa ac', 'menonjol']);
  });

  it(`keeps at most ${DRAFT_QUOTES_MAX} quotes, dropping the rest with a reason`, () => {
    const many = ['pipa ac', 'menonjol', 'sisi jendela', 'owner minta', 'atas plafon', 'bobok dinding'];
    const r = validateSiteEventDraft(raw({ evidence_quotes: many }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.evidence_quotes).toEqual(['pipa ac', 'menonjol', 'sisi jendela', 'owner minta', 'atas plafon']);
    expect(r.dropped).toContainEqual(expect.objectContaining({ field: 'evidence_quotes', value: 'bobok dinding' }));
  });

  it('strips zero-width and directional characters before matching a quote', () => {
    const transcriptWithInvisibles = 'Pipa AC men\u200Bonjol di sisi jendela';
    expect(isLiteralQuote('pipa ac menonjol', [transcriptWithInvisibles, null])).toBe(true);
  });

  // A phone keyboard writes Jum’at; the model echoes Jum'at (or the other way
  // round) and the words are the same words. Folding runs on BOTH sides, so it
  // only ever widens the spelling a literal quote may carry - never what the
  // quote has to say.
  it('folds typographic apostrophes, quotation marks and dashes to ASCII on both sides', () => {
    expect(isLiteralQuote("rapat Jum'at pagi", ['Catatan: rapat Jum\u2019at pagi', null])).toBe(true);
    expect(isLiteralQuote('rapat Jum\u2019at pagi', ["Catatan: rapat Jum'at pagi", null])).toBe(true);
    expect(isLiteralQuote('cor lantai 2 - 3', ['jadwal cor lantai 2 \u2014 3 minggu ini', null])).toBe(true);
    expect(isLiteralQuote('"bobok" dinding', ['tukang \u201Cbobok\u201D dinding', null])).toBe(true);
  });

  it('keeps refusing a paraphrase once the folding is done', () => {
    expect(isLiteralQuote('owner ingin pipa \u2019dipindahkan\u2019', [TRANSCRIPT, NOTE])).toBe(false);
  });

  it('drops every quote when both transcript and note are empty, and downgrades VO', () => {
    const r = validateSiteEventDraft(raw(), ctx({ transcript: '', rawText: '' }));
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.evidence_quotes).toEqual([]);
    expect(r.draft.vo.flag).toBe('none');
  });
});

describe('VO suggestion (rule 4, second half)', () => {
  it('downgrades suggested to none when every quote drops, keeping the reason on record', () => {
    const r = validateSiteEventDraft(
      raw({ vo: { flag: 'suggested', reason: 'Owner mengubah desain.', evidence_quotes: ['owner mengubah desain kamar mandi'] } }),
      ctx(),
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.vo.flag).toBe('none');
    expect(r.draft.vo.evidence_quotes).toEqual([]);
    expect(r.draft.vo.reason).toBe('');
    expect(r.dropped).toContainEqual({
      field: 'vo.flag',
      reason: 'usulan VO diturunkan ke none: tidak ada kutipan dasar yang lolos',
      value: 'Owner mengubah desain.',
    });
  });

  it('keeps suggested when at least one quote survives', () => {
    const r = validateSiteEventDraft(
      raw({ vo: { flag: 'suggested', reason: 'x', evidence_quotes: ['bukan kutipan', 'owner minta dipindah'] } }),
      ctx(),
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.vo.flag).toBe('suggested');
    expect(r.draft.vo.evidence_quotes).toEqual(['owner minta dipindah']);
  });

  it('treats an unknown VO flag as none and records it', () => {
    const r = validateSiteEventDraft(raw({ vo: { flag: 'confirmed', reason: '', evidence_quotes: [] } }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.vo.flag).toBe('none');
    expect(r.dropped.map((d) => d.field)).toContain('vo.flag');
  });

  it('defaults a missing vo block to none without a drop', () => {
    const r = validateSiteEventDraft(raw({ vo: undefined }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.vo).toEqual({ flag: 'none', reason: '', evidence_quotes: [] });
    expect(r.dropped.map((d) => d.field)).not.toContain('vo');
  });
});

describe('codes come from the supplied lists only', () => {
  it('drops a gate code the model invented', () => {
    const r = validateSiteEventDraft(raw({ gate_code: 'Z', step_code: null }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.gate_code).toBeNull();
    expect(r.dropped).toContainEqual({ field: 'gate_code', reason: 'kode gerbang tidak ada di daftar aktif', value: 'Z' });
  });

  it('drops a step code that is not in the active list', () => {
    const r = validateSiteEventDraft(raw({ step_code: 'A9' }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.step_code).toBeNull();
    expect(r.dropped).toContainEqual({ field: 'step_code', reason: 'kode langkah tidak ada di daftar aktif', value: 'A9' });
  });

  // Migration 097 keys (gate_code, step_code) to gate_step_refs (gate_code, code),
  // so every pair the validator lets through must be a pair the database accepts.
  it('keeps a step that belongs to the chosen gate', () => {
    const r = validateSiteEventDraft(raw({ gate_code: 'C', step_code: 'C1' }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.gate_code).toBe('C');
    expect(r.draft.step_code).toBe('C1');
    expect(r.dropped.map((d) => d.field)).not.toContain('step_code');
  });

  it('drops a real step that belongs to a different gate, and keeps the gate', () => {
    const r = validateSiteEventDraft(raw({ gate_code: 'A', step_code: 'C1' }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.gate_code).toBe('A');
    expect(r.draft.step_code).toBeNull();
    expect(r.dropped).toContainEqual({ field: 'step_code', reason: 'langkah bukan milik gerbang yang dipilih', value: 'C1' });
  });

  it('drops a step when the gate itself was dropped, and says why', () => {
    const r = validateSiteEventDraft(raw({ gate_code: 'Z', step_code: 'A2' }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.gate_code).toBeNull();
    expect(r.draft.step_code).toBeNull();
    expect(r.dropped).toContainEqual({ field: 'step_code', reason: 'langkah dibuang: tidak ada gerbang yang valid', value: 'A2' });
  });

  it('keeps a related id only when it was in the supplied open-event list', () => {
    const ok = validateSiteEventDraft(raw({ related_open_event_id: OPEN_EVENT_ID }), ctx());
    if (!ok.ok) throw new Error('expected ok');
    expect(ok.draft.related_open_event_id).toBe(OPEN_EVENT_ID);

    const bad = validateSiteEventDraft(raw({ related_open_event_id: '22222222-2222-4222-8222-222222222222' }), ctx());
    if (!bad.ok) throw new Error('expected ok');
    expect(bad.draft.related_open_event_id).toBeNull();
    expect(bad.dropped.map((d) => d.field)).toContain('related_open_event_id');
  });

  it('resolves a related id case-insensitively and stores the list\'s own spelling', () => {
    const stored = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const r = validateSiteEventDraft(
      raw({ related_open_event_id: stored.toUpperCase() }),
      ctx({ openEventIds: [stored] }),
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.related_open_event_id).toBe(stored);
    expect(r.dropped.map((d) => d.field)).not.toContain('related_open_event_id');
  });
});

describe('case-insensitive enums and codes', () => {
  it('case-folds event_type and confidence before checking the enum', () => {
    const r = validateSiteEventDraft(raw({ event_type: 'Hambatan', confidence: 'HIGH' }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.event_type).toBe('hambatan');
    expect(r.draft.confidence).toBe('high');
  });

  it('resolves gate_code case-insensitively to the canonical spelling in the active list', () => {
    const r = validateSiteEventDraft(raw({ gate_code: 'a', step_code: null }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.gate_code).toBe('A');
  });

  it('resolves step_code case-insensitively once its gate has resolved', () => {
    const r = validateSiteEventDraft(raw({ gate_code: 'a', step_code: 'a2' }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.gate_code).toBe('A');
    expect(r.draft.step_code).toBe('A2');
  });

  it('treats an ambiguous case-insensitive gate match as not found', () => {
    const r = validateSiteEventDraft(raw({ gate_code: 'a', step_code: null }), ctx({ gateCodes: ['A', 'a', 'B'] }));
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.gate_code).toBeNull();
    expect(r.dropped).toContainEqual({ field: 'gate_code', reason: 'kode gerbang tidak ada di daftar aktif', value: 'a' });
  });
});

describe('clamps and defaults', () => {
  it(`clamps title to ${DRAFT_TITLE_MAX} and summary to ${DRAFT_SUMMARY_MAX}, recording both`, () => {
    const r = validateSiteEventDraft(raw({ title: 'T'.repeat(120), summary: 'S'.repeat(400) }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.title).toHaveLength(DRAFT_TITLE_MAX);
    expect(r.draft.summary).toHaveLength(DRAFT_SUMMARY_MAX);
    expect(r.dropped).toContainEqual({ field: 'title', reason: `dipotong ke ${DRAFT_TITLE_MAX} karakter` });
    expect(r.dropped).toContainEqual({ field: 'summary', reason: `dipotong ke ${DRAFT_SUMMARY_MAX} karakter` });
  });

  it('collapses whitespace in the title', () => {
    const r = validateSiteEventDraft(raw({ title: '  Pipa \n AC   menonjol ' }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.title).toBe('Pipa AC menonjol');
  });

  it('collapses whitespace in the title but keeps newlines in downstream_impact', () => {
    const r = validateSiteEventDraft(
      raw({ title: '  Pipa \n AC   menonjol ', downstream_impact: '  Plafon tertunda.\n\nCat ikut mundur.  ' }),
      ctx(),
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.title).toBe('Pipa AC menonjol');
    expect(r.draft.downstream_impact).toBe('Plafon tertunda.\n\nCat ikut mundur.');
  });

  it('clamps by code point, so an emoji is never split into a lone surrogate', () => {
    const r = validateSiteEventDraft(raw({ title: 'T'.repeat(79) + '\u{1F600}' + 'X'.repeat(9) }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(Array.from(r.draft.title)).toHaveLength(DRAFT_TITLE_MAX);
    expect(r.draft.title.endsWith('\u{1F600}')).toBe(true);
    expect(LONE_SURROGATE.test(r.draft.title)).toBe(false);
  });

  it('truncates a drop preview by code point too', () => {
    const r = validateSiteEventDraft(raw({ evidence_quotes: ['Q'.repeat(118) + '\u{1F600}' + 'Z'.repeat(9)] }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(LONE_SURROGATE.test(JSON.stringify(r.dropped))).toBe(false);
  });

  it(`caps a relative due suggestion at ${DRAFT_DUE_DAYS_MAX} days`, () => {
    const r = validateSiteEventDraft(raw({ due_suggestion: { kind: 'relative', days: 90 } }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.due_suggestion).toEqual({ kind: 'relative', days: DRAFT_DUE_DAYS_MAX });
    expect(r.dropped.map((d) => d.field)).toContain('due_suggestion');
  });

  it('turns a malformed due suggestion into none', () => {
    const r = validateSiteEventDraft(raw({ due_suggestion: 'besok' }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.due_suggestion).toEqual({ kind: 'none', days: 0 });
    expect(r.dropped.map((d) => d.field)).toContain('due_suggestion');
  });

  it('treats a relative suggestion of zero days as none', () => {
    const r = validateSiteEventDraft(raw({ due_suggestion: { kind: 'relative', days: 0 } }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.due_suggestion).toEqual({ kind: 'none', days: 0 });
  });

  it('records a drop when a relative due suggestion rounds to less than 1 day', () => {
    const negative = validateSiteEventDraft(raw({ due_suggestion: { kind: 'relative', days: -5 } }), ctx());
    if (!negative.ok) throw new Error('expected ok');
    expect(negative.draft.due_suggestion).toEqual({ kind: 'none', days: 0 });
    expect(negative.dropped).toContainEqual({
      field: 'due_suggestion',
      reason: 'tenggat kurang dari 1 hari, dianggap tidak ada',
      value: '-5',
    });

    const fractional = validateSiteEventDraft(raw({ due_suggestion: { kind: 'relative', days: 0.2 } }), ctx());
    if (!fractional.ok) throw new Error('expected ok');
    expect(fractional.draft.due_suggestion).toEqual({ kind: 'none', days: 0 });
    expect(fractional.dropped).toContainEqual({
      field: 'due_suggestion',
      reason: 'tenggat kurang dari 1 hari, dianggap tidak ada',
      value: '0.2',
    });
  });

  it('treats a non-boolean is_blocking as false and records it', () => {
    const r = validateSiteEventDraft(raw({ is_blocking: 'ya' }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.is_blocking).toBe(false);
    expect(r.dropped.map((d) => d.field)).toContain('is_blocking');
  });

  it('keeps a mismatch flag with its reason, and nulls the reason when there is no mismatch', () => {
    const yes = validateSiteEventDraft(raw({ mismatch: { flag: true, reason: 'Suara menyebut plafon, foto menunjukkan lantai.' } }), ctx());
    if (!yes.ok) throw new Error('expected ok');
    expect(yes.draft.mismatch).toEqual({ flag: true, reason: 'Suara menyebut plafon, foto menunjukkan lantai.' });

    const no = validateSiteEventDraft(raw({ mismatch: { flag: false, reason: 'abaikan' } }), ctx());
    if (!no.ok) throw new Error('expected ok');
    expect(no.draft.mismatch).toEqual({ flag: false, reason: null });
  });
});

describe('unknown keys never survive (rule 5)', () => {
  it('drops a cost estimate and any other extra key, and records each', () => {
    const r = validateSiteEventDraft(raw({ estimasi_biaya: 2500000, cost_usd: 150, catatan_ai: 'x' }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(Object.keys(r.draft)).not.toContain('estimasi_biaya');
    expect(Object.keys(r.draft)).not.toContain('cost_usd');
    const fields = r.dropped.filter((d) => d.reason === 'kunci tidak dikenal, dibuang').map((d) => d.field);
    expect(fields).toEqual(['estimasi_biaya', 'cost_usd', 'catatan_ai']);
  });

  it('rebuilds nested objects from known fields only', () => {
    const r = validateSiteEventDraft(
      raw({ vo: { flag: 'suggested', reason: 'x', evidence_quotes: ['owner minta dipindah'], harga: 900000 } }),
      ctx(),
    );
    if (!r.ok) throw new Error('expected ok');
    expect(Object.keys(r.draft.vo).sort()).toEqual(['evidence_quotes', 'flag', 'reason']);
  });

  it('drops a __proto__ key that arrived via JSON.parse, without touching Object.prototype', () => {
    const json = JSON.stringify(raw()).replace(/^\{/, '{"__proto__":{"polluted":true},');
    const parsed = JSON.parse(json);
    const r = validateSiteEventDraft(parsed, ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(Object.keys(r.draft)).not.toContain('__proto__');
    expect(r.dropped).toContainEqual({ field: '__proto__', reason: 'kunci tidak dikenal, dibuang', value: '{"polluted":true}' });
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('a failed transcription caps confidence', () => {
  it('downgrades high to medium and records why', () => {
    const r = validateSiteEventDraft(raw(), ctx({ transcriptionFailed: true, transcript: null }));
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.confidence).toBe('medium');
    expect(r.dropped).toContainEqual({ field: 'confidence', reason: 'transkripsi gagal, keyakinan diturunkan ke medium' });
  });

  it('leaves low and medium alone', () => {
    const r = validateSiteEventDraft(raw({ confidence: 'low' }), ctx({ transcriptionFailed: true }));
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.confidence).toBe('low');
  });

  it('leaves medium alone under a failed transcription and records no drop', () => {
    const r = validateSiteEventDraft(raw({ confidence: 'medium' }), ctx({ transcriptionFailed: true }));
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.confidence).toBe('medium');
    expect(r.dropped.map((d) => d.field)).not.toContain('confidence');
  });
});

describe('the stored draft carries its own drop list', () => {
  it('returns the same array on the result and inside the draft', () => {
    const r = validateSiteEventDraft(raw({ gate_code: 'Z', step_code: null }), ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft.dropped).toBe(r.dropped);
  });
});
