/**
 * These rules decide what a supervisor is allowed to confirm and what the AI
 * is allowed to pre-fill. Migration 097 re-checks the confirm rules in SQL and
 * mirrors mapVoChangeType's keyword lists; migration097.test.ts reads the
 * lists from THIS module, so a keyword added here without the SQL fails there.
 */
import {
  isActionableType,
  isIsoDate,
  addDaysIso,
  dueDateFromSuggestion,
  validateConfirmInput,
  confidenceUi,
  mapVoChangeType,
  canOfferManualAuthoring,
  normalizeTitle,
  voEvidenceText,
  VO_OWNER_REQUEST_KEYWORDS,
  VO_DESIGN_KEYWORDS,
  AI_QUOTA_MESSAGE,
  CONFIDENCE_BANNER_MEDIUM,
  CONFIDENCE_BANNER_LOW,
  CONFIRM_ERRORS,
  type ConfirmInput,
} from '../siteEventRules';
import type { SiteEventDraft } from '../types';

const draft = (over: Partial<SiteEventDraft> = {}): SiteEventDraft => ({
  event_type: 'butuh_keputusan',
  gate_code: 'A',
  step_code: null,
  title: 'Pipa AC menonjol',
  summary: 'Owner minta pipa dipindah.',
  discipline: 'AC',
  is_blocking: true,
  downstream_impact: null,
  due_suggestion: { kind: 'relative', days: 2 },
  vo: { flag: 'suggested', reason: 'Permintaan owner', evidence_quotes: ['owner minta dipindah'] },
  mismatch: { flag: false, reason: null },
  related_open_event_id: null,
  confidence: 'high',
  evidence_quotes: [],
  dropped: [],
  ...over,
});

const input = (over: Partial<ConfirmInput> = {}): ConfirmInput => ({
  eventType: 'progres',
  gateCode: 'D',
  stepCode: null,
  activeSteps: [{ code: 'B4', gate_code: 'B' }, { code: 'D2', gate_code: 'D' }],
  title: 'Keramik lantai selesai 60%',
  summary: '',
  ownerId: null,
  dueDate: null,
  downstreamImpact: '',
  isBlocking: false,
  voConfirm: false,
  relatedEventId: null,
  transcriptEdited: null,
  draft: null,
  aiMismatch: false,
  mismatchAcknowledged: false,
  today: '2026-09-10',
  ...over,
});

const errorsOf = (i: ConfirmInput): string[] => {
  const r = validateConfirmInput(i);
  return r.ok ? [] : r.errors;
};

describe('isActionableType', () => {
  it('is true for the four types that need an owner and a due date', () => {
    for (const t of ['isu', 'hambatan', 'cacat', 'butuh_keputusan'] as const) {
      expect(isActionableType(t)).toBe(true);
    }
  });

  it('is false for progres, info and nothing', () => {
    expect(isActionableType('progres')).toBe(false);
    expect(isActionableType('info')).toBe(false);
    expect(isActionableType(null)).toBe(false);
    expect(isActionableType(undefined)).toBe(false);
  });
});

describe('dates', () => {
  it('accepts only real calendar dates in YYYY-MM-DD', () => {
    expect(isIsoDate('2026-09-10')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('10-09-2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDaysIso('2026-09-29', 3)).toBe('2026-10-02');
    expect(addDaysIso('2026-12-30', 5)).toBe('2027-01-04');
  });

  it('turns a relative suggestion into a date', () => {
    expect(dueDateFromSuggestion('2026-09-10', { kind: 'relative', days: 3 })).toBe('2026-09-13');
  });

  it('returns null for none, zero days, a bad today, or no suggestion', () => {
    expect(dueDateFromSuggestion('2026-09-10', { kind: 'none', days: 0 })).toBeNull();
    expect(dueDateFromSuggestion('2026-09-10', { kind: 'relative', days: 0 })).toBeNull();
    expect(dueDateFromSuggestion('kemarin', { kind: 'relative', days: 3 })).toBeNull();
    expect(dueDateFromSuggestion('2026-09-10', null)).toBeNull();
  });

  it('caps the suggestion at 60 days', () => {
    expect(dueDateFromSuggestion('2026-09-10', { kind: 'relative', days: 90 })).toBe('2026-11-09');
  });
});

describe('normalizeTitle', () => {
  it('collapses inner whitespace runs and trims the ends', () => {
    expect(normalizeTitle('Keramik  lantai   selesai')).toBe('Keramik lantai selesai');
    expect(normalizeTitle('  Pipa AC menonjol  ')).toBe('Pipa AC menonjol');
  });
});

describe('validateConfirmInput', () => {
  it('accepts a minimal progres event with no owner and no due date', () => {
    expect(validateConfirmInput(input())).toEqual({ ok: true });
  });

  it('requires a type and a title', () => {
    expect(errorsOf(input({ eventType: null }))).toContain('Pilih jenis kejadian.');
    expect(errorsOf(input({ title: '   ' }))).toContain('Judul wajib diisi.');
  });

  it('limits title to 80 and summary to 300 characters', () => {
    expect(errorsOf(input({ title: 'x'.repeat(81) }))).toContain('Judul maksimal 80 karakter.');
    expect(errorsOf(input({ title: 'x'.repeat(80) }))).toEqual([]);
    expect(errorsOf(input({ summary: 's'.repeat(301) }))).toContain('Ringkasan maksimal 300 karakter.');
    expect(errorsOf(input({ downstreamImpact: 'd'.repeat(301) }))).toContain('Dampak lanjutan maksimal 300 karakter.');
  });

  it('refuses a step without a gate', () => {
    expect(errorsOf(input({ gateCode: null, stepCode: 'B4' }))).toContain('Pilih gerbang sebelum memilih langkah.');
  });

  it('refuses a step that sits under another gate, and leaves a step it cannot see to the server', () => {
    const msg = 'Langkah yang dipilih bukan bagian dari gerbang ini. Pilih ulang langkahnya.';
    expect(errorsOf(input({ gateCode: 'D', stepCode: 'B4' }))).toContain(msg);
    expect(errorsOf(input({ gateCode: 'B', stepCode: 'B4' }))).toEqual([]);
    expect(errorsOf(input({ gateCode: 'D', stepCode: 'X9' }))).toEqual([]);
  });

  it('requires owner and due date for every actionable type', () => {
    for (const t of ['isu', 'hambatan', 'cacat', 'butuh_keputusan'] as const) {
      const errors = errorsOf(input({ eventType: t }));
      expect(errors).toContain('Pemilik wajib dipilih untuk isu, hambatan, cacat dan butuh keputusan.');
      expect(errors).toContain('Tenggat wajib diisi untuk isu, hambatan, cacat dan butuh keputusan.');
    }
    expect(errorsOf(input({ eventType: 'isu', ownerId: 'u1', dueDate: '2026-09-11' }))).toEqual([]);
  });

  it('validates the due date format and refuses a date before today', () => {
    expect(errorsOf(input({ dueDate: '11/09/2026' }))).toContain('Format tenggat harus YYYY-MM-DD.');
    expect(errorsOf(input({ dueDate: '2026-09-09' }))).toContain('Tenggat tidak boleh sebelum hari ini.');
    expect(errorsOf(input({ dueDate: '2026-09-10' }))).toEqual([]);
  });

  it('refuses a VO confirm with no surviving quote in the draft', () => {
    const msg = CONFIRM_ERRORS.voNoEvidence;
    expect(msg).toBe('VO hanya bisa dikonfirmasi bila ada kutipan dasar.');
    expect(errorsOf(input({ voConfirm: true, draft: null }))).toContain(msg);
    expect(errorsOf(input({ voConfirm: true, draft: draft({ vo: { flag: 'none', reason: '', evidence_quotes: [] } }) }))).toContain(msg);
    expect(errorsOf(input({ voConfirm: true, draft: draft() }))).toEqual([]);
  });

  it('blocks Konfirmasi until a mismatch is acknowledged', () => {
    const msg = 'Tandai dulu bahwa Anda sudah memeriksa ketidakcocokan foto dan suara.';
    expect(errorsOf(input({ aiMismatch: true }))).toContain(msg);
    expect(errorsOf(input({ aiMismatch: true, mismatchAcknowledged: true }))).toEqual([]);
  });

  it('reports every problem at once, not one per tap', () => {
    expect(errorsOf(input({ eventType: 'cacat', title: '', aiMismatch: true }))).toHaveLength(4);
  });

  it('reports exactly one error for exactly one violation', () => {
    // Actionable type, owner set, but no due date: dueRequired should fire alone.
    expect(errorsOf(input({ eventType: 'isu', ownerId: 'u1', dueDate: null }))).toEqual([
      CONFIRM_ERRORS.dueRequired,
    ]);
  });
});

describe('confidenceUi - spec §1.1 table', () => {
  it('high: pre-fills, no Periksa, VO pre-checked only when suggested, no banner', () => {
    expect(confidenceUi('high', draft())).toEqual({
      prefillTypeAndGate: true, markPeriksa: false, hintType: null, hintGate: null,
      voCheckbox: 'prechecked', banner: null,
    });
    expect(confidenceUi('high', draft({ vo: { flag: 'none', reason: '', evidence_quotes: [] } })).voCheckbox).toBe('hidden');
  });

  it('medium: pre-fills with Periksa, VO present but unchecked, medium banner', () => {
    expect(confidenceUi('medium', draft())).toEqual({
      prefillTypeAndGate: true, markPeriksa: true, hintType: null, hintGate: null,
      voCheckbox: 'unchecked', banner: CONFIDENCE_BANNER_MEDIUM,
    });
    expect(CONFIDENCE_BANNER_MEDIUM).toBe('Periksa hasil AI sebelum konfirmasi.');
  });

  it('low: leaves chips empty, shows the AI guess as hints, hides VO, low banner', () => {
    expect(confidenceUi('low', draft())).toEqual({
      prefillTypeAndGate: false, markPeriksa: false, hintType: 'butuh_keputusan', hintGate: 'A',
      voCheckbox: 'hidden', banner: CONFIDENCE_BANNER_LOW,
    });
    expect(CONFIDENCE_BANNER_LOW).toBe('AI kurang yakin. Pilih jenis dan gerbang sendiri.');
  });

  it('no draft (manual authoring): nothing pre-filled, nothing hinted, VO hidden', () => {
    expect(confidenceUi(null, null)).toEqual({
      prefillTypeAndGate: false, markPeriksa: false, hintType: null, hintGate: null,
      voCheckbox: 'hidden', banner: null,
    });
  });
});

describe('voEvidenceText', () => {
  it('joins the evidence quotes with a space and normalizes them (lowercased, whitespace collapsed)', () => {
    const d = draft({
      vo: {
        flag: 'suggested',
        reason: 'Permintaan owner',
        evidence_quotes: ['Owner  minta', 'pindah   pipa AC'],
      },
    });
    expect(voEvidenceText(d)).toBe('owner minta pindah pipa ac');
  });

  it('is empty for a null draft', () => {
    expect(voEvidenceText(null)).toBe('');
  });
});

describe('mapVoChangeType - the §4.2 change_type mapping the RPC mirrors', () => {
  it('keeps the keyword lists exactly as specified', () => {
    expect([...VO_OWNER_REQUEST_KEYWORDS]).toEqual(['owner', 'klien', 'pemilik rumah', 'minta', 'permintaan']);
    expect([...VO_DESIGN_KEYWORDS]).toEqual(['desain', 'desainer', 'gambar', 'revisi']);
  });

  it('maps butuh_keputusan with owner-request evidence to permintaan_owner', () => {
    expect(mapVoChangeType('butuh_keputusan', draft())).toBe('permintaan_owner');
  });

  it('matches case-insensitively across whitespace runs', () => {
    const d = draft({ vo: { flag: 'suggested', reason: '', evidence_quotes: ['Pemilik   Rumah ingin pindah'] } });
    expect(mapVoChangeType('butuh_keputusan', d)).toBe('permintaan_owner');
  });

  it('does not use owner evidence for other types', () => {
    expect(mapVoChangeType('isu', draft())).toBe('kondisi_lapangan');
  });

  it('maps design evidence to revisi_desain for any type', () => {
    const d = draft({ vo: { flag: 'suggested', reason: '', evidence_quotes: ['ikut gambar terbaru'] } });
    expect(mapVoChangeType('hambatan', d)).toBe('revisi_desain');
    expect(mapVoChangeType('butuh_keputusan', d)).toBe('revisi_desain');
  });

  it('prefers the owner branch when both kinds of evidence are present', () => {
    const d = draft({ vo: { flag: 'suggested', reason: '', evidence_quotes: ['owner minta revisi'] } });
    expect(mapVoChangeType('butuh_keputusan', d)).toBe('permintaan_owner');
  });

  it('falls back to kondisi_lapangan', () => {
    const d = draft({ vo: { flag: 'suggested', reason: '', evidence_quotes: ['dinding retak di sudut'] } });
    expect(mapVoChangeType('cacat', d)).toBe('kondisi_lapangan');
    expect(mapVoChangeType('butuh_keputusan', null)).toBe('kondisi_lapangan');
  });
});

describe('canOfferManualAuthoring', () => {
  it('opens after three failed analyses while still pending', () => {
    expect(canOfferManualAuthoring({ status: 'pending_analysis', analysis_attempts: 3, last_error: 'x' })).toBe(true);
    expect(canOfferManualAuthoring({ status: 'pending_analysis', analysis_attempts: 2, last_error: 'x' })).toBe(false);
  });

  it('opens immediately when the daily AI quota is spent', () => {
    expect(canOfferManualAuthoring({ status: 'pending_analysis', analysis_attempts: 0, last_error: AI_QUOTA_MESSAGE })).toBe(true);
  });

  it('never opens once a draft exists', () => {
    expect(canOfferManualAuthoring({ status: 'draft', analysis_attempts: 5, last_error: AI_QUOTA_MESSAGE })).toBe(false);
  });
});
