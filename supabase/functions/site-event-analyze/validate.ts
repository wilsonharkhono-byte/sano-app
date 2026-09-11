// SANO - Site event AI draft validator.
//
// Spec: docs/superpowers/specs/2026-09-10-room-site-events-design.md §1.1
// (rules 4 and 5) and §6 "Validation".
//
// SOURCE OF TRUTH. supabase/functions/site-event-analyze/validate.ts is a
// byte-identical copy: Deno cannot import from tools/, and jest ignores
// supabase/functions/. tools/__tests__/siteEventDraftValidateTwin.test.ts
// fails when the two drift. Edit THIS file, then run:
//   cp tools/siteEventDraftValidate.ts supabase/functions/site-event-analyze/validate.ts
//
// Rules for this file: no imports, no Deno or React Native APIs. The same
// bytes run in both runtimes.
//
// What it guarantees:
//   - every enumerated field holds an allowed value, or the draft is rejected
//     outright (event_type, confidence, an empty title) or reset to a safe
//     default with the reason recorded (vo.flag, due_suggestion, mismatch);
//   - event_type and confidence are matched case-insensitively; gate_code and
//     step_code resolve case-insensitively to the supplied list's own casing;
//   - gate_code, step_code and related_open_event_id come from the lists the
//     edge function supplied, never from the model's imagination;
//   - step_code survives only under the gate_code that survived with it, the
//     pair migration 097 keys to gate_step_refs (gate_code, code);
//   - every evidence quote is a literal substring of the transcript or the
//     typed note (case-insensitive, whitespace collapsed) and at least
//     DRAFT_QUOTE_MIN_CHARS long, or it is dropped with a reason;
//   - a VO suggestion whose quotes all dropped is downgraded to 'none';
//   - unknown keys, a cost estimate among them, never survive;
//   - a draft built without speech (stage 1 failed) cannot claim 'high'.
// Every change is recorded in `dropped`, which travels inside ai_draft so a
// human can see what the model said and why it did not reach the screen.

export const SITE_EVENT_TYPE_CODES = [
  'progres', 'isu', 'hambatan', 'cacat', 'butuh_keputusan', 'info',
] as const;
export type SiteEventTypeCode = (typeof SITE_EVENT_TYPE_CODES)[number];

export const AI_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type AiConfidence = (typeof AI_CONFIDENCE_LEVELS)[number];

export const DRAFT_TITLE_MAX = 80;
export const DRAFT_SUMMARY_MAX = 300;
export const DRAFT_IMPACT_MAX = 300;
export const DRAFT_DISCIPLINE_MAX = 60;
export const DRAFT_REASON_MAX = 300;
export const DRAFT_QUOTES_MAX = 5;
/** Shorter than this and a "quote" like "ac" is a substring of almost anything. */
export const DRAFT_QUOTE_MIN_CHARS = 4;
export const DRAFT_DUE_DAYS_MAX = 60;

export interface DraftDrop {
  field: string;
  reason: string;
  /** The offending value, truncated, when it helps a human see what was dropped. */
  value?: string;
}

export interface SiteEventDraft {
  event_type: SiteEventTypeCode;
  gate_code: string | null;
  step_code: string | null;
  title: string;
  summary: string;
  discipline: string | null;
  is_blocking: boolean;
  downstream_impact: string | null;
  due_suggestion: { kind: 'relative' | 'none'; days: number };
  vo: { flag: 'none' | 'suggested'; reason: string; evidence_quotes: string[] };
  mismatch: { flag: boolean; reason: string | null };
  related_open_event_id: string | null;
  confidence: AiConfidence;
  evidence_quotes: string[];
  dropped: DraftDrop[];
}

export interface DraftValidationContext {
  /** Active gate codes, loaded from gate_refs at call time. */
  gateCodes: string[];
  /** Active steps, loaded from gate_step_refs at call time. */
  steps: Array<{ code: string; gate_code: string }>;
  /** Ids of the open events in the room that were shown to the model. */
  openEventIds: string[];
  /** transcript_edited ?? transcript. */
  transcript: string | null;
  /** The supervisor's typed note, as sent. */
  rawText: string | null;
  /** Stage 1 failed, so the model heard nothing and may not claim 'high'. */
  transcriptionFailed?: boolean;
}

export type DraftValidationResult =
  | {
      ok: true;
      draft: SiteEventDraft;
      /** The same array as draft.dropped, not a copy — do not mutate it. */
      dropped: DraftDrop[];
    }
  | { ok: false; reason: string };

const KNOWN_KEYS: ReadonlyArray<string> = [
  'event_type', 'gate_code', 'step_code', 'title', 'summary', 'discipline',
  'is_blocking', 'downstream_impact', 'due_suggestion', 'vo', 'mismatch',
  'related_open_event_id', 'confidence', 'evidence_quotes',
];

export function normalizeForQuoteMatch(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u200B-\u200D\u00AD\u2060\u200E\u200F]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLiteralQuote(
  quote: string,
  sources: ReadonlyArray<string | null | undefined>,
): boolean {
  const needle = normalizeForQuoteMatch(quote);
  if (needle.length < DRAFT_QUOTE_MIN_CHARS) return false;
  return sources.some(
    (source) => typeof source === 'string' && normalizeForQuoteMatch(source).includes(needle),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function preview(value: unknown): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  const chars = Array.from(text);
  return chars.length > 120 ? `${chars.slice(0, 119).join('')}…` : text;
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

/**
 * Resolves `candidate` to the canonical spelling in `options` ignoring case,
 * but only when exactly one option matches ignoring case. A tie (two options
 * differing only by case) is treated as not found rather than guessed at.
 */
function resolveCodeCaseInsensitive(candidate: string, options: ReadonlyArray<string>): string | null {
  const needle = candidate.toLowerCase();
  const matches = options.filter((option) => option.toLowerCase() === needle);
  return matches.length === 1 ? matches[0] : null;
}

function clampText(
  field: string,
  value: unknown,
  max: number,
  dropped: DraftDrop[],
  collapse: boolean,
): string | null {
  if (typeof value !== 'string') {
    if (isPresent(value)) dropped.push({ field, reason: 'bukan teks, diabaikan', value: preview(value) });
    return null;
  }
  const text = collapse ? value.replace(/\s+/g, ' ').trim() : value.trim();
  if (!text) return null;
  const chars = Array.from(text);
  if (chars.length > max) {
    dropped.push({ field, reason: `dipotong ke ${max} karakter` });
    return chars.slice(0, max).join('').trim();
  }
  return text;
}

function filterQuotes(
  field: string,
  value: unknown,
  sources: ReadonlyArray<string | null | undefined>,
  dropped: DraftDrop[],
): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    dropped.push({ field, reason: 'bukan daftar kutipan, diabaikan', value: preview(value) });
    return [];
  }
  const kept: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !isLiteralQuote(item, sources)) {
      dropped.push({ field, reason: 'bukan kutipan persis dari transkrip atau catatan', value: preview(item) });
      continue;
    }
    const quote = item.replace(/\s+/g, ' ').trim();
    const key = normalizeForQuoteMatch(quote);
    if (kept.some((k) => normalizeForQuoteMatch(k) === key)) continue;
    if (kept.length >= DRAFT_QUOTES_MAX) {
      dropped.push({ field, reason: `lebih dari ${DRAFT_QUOTES_MAX} kutipan, sisanya dibuang`, value: preview(item) });
      continue;
    }
    kept.push(quote);
  }
  return kept;
}

function optionalString(field: string, value: unknown, dropped: DraftDrop[]): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (isPresent(value)) dropped.push({ field, reason: 'bukan teks, diabaikan', value: preview(value) });
  return null;
}

export function validateSiteEventDraft(
  raw: unknown,
  ctx: DraftValidationContext,
): DraftValidationResult {
  if (!isRecord(raw)) return { ok: false, reason: 'draf bukan objek JSON' };

  const dropped: DraftDrop[] = [];

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.includes(key)) {
      dropped.push({ field: key, reason: 'kunci tidak dikenal, dibuang', value: preview(raw[key]) });
    }
  }

  const eventTypeRaw = raw.event_type;
  const eventType = typeof eventTypeRaw === 'string' ? eventTypeRaw.trim().toLowerCase() : eventTypeRaw;
  if (typeof eventType !== 'string' || !(SITE_EVENT_TYPE_CODES as ReadonlyArray<string>).includes(eventType)) {
    return { ok: false, reason: `event_type tidak valid: ${preview(eventTypeRaw)}` };
  }

  const confidenceRaw = raw.confidence;
  const confidenceCandidate = typeof confidenceRaw === 'string' ? confidenceRaw.trim().toLowerCase() : confidenceRaw;
  if (typeof confidenceCandidate !== 'string' || !(AI_CONFIDENCE_LEVELS as ReadonlyArray<string>).includes(confidenceCandidate)) {
    return { ok: false, reason: `confidence tidak valid: ${preview(confidenceRaw)}` };
  }

  const title = clampText('title', raw.title, DRAFT_TITLE_MAX, dropped, true);
  if (!title) return { ok: false, reason: 'title kosong' };

  const sources = [ctx.transcript, ctx.rawText];

  // Gate: from the supplied active list, or nothing. Matched case-insensitively,
  // resolved to the list's own spelling.
  let gateCode: string | null = null;
  const gateCandidate = optionalString('gate_code', raw.gate_code, dropped);
  if (gateCandidate) {
    const resolved = resolveCodeCaseInsensitive(gateCandidate, ctx.gateCodes);
    if (resolved) gateCode = resolved;
    else dropped.push({ field: 'gate_code', reason: 'kode gerbang tidak ada di daftar aktif', value: preview(gateCandidate) });
  }

  // Step: in the active list AND under the gate that survived. Migration 097
  // keys (gate_code, step_code) to gate_step_refs (gate_code, code) and refuses
  // a step without a gate, so a pair that passes here is one the database takes.
  let stepCode: string | null = null;
  const stepCandidate = optionalString('step_code', raw.step_code, dropped);
  if (stepCandidate) {
    const resolvedStepCode = resolveCodeCaseInsensitive(stepCandidate, ctx.steps.map((s) => s.code));
    const step = resolvedStepCode ? ctx.steps.find((s) => s.code === resolvedStepCode) : undefined;
    if (!step) {
      dropped.push({ field: 'step_code', reason: 'kode langkah tidak ada di daftar aktif', value: preview(stepCandidate) });
    } else if (gateCode === null) {
      dropped.push({ field: 'step_code', reason: 'langkah dibuang: tidak ada gerbang yang valid', value: preview(stepCandidate) });
    } else if (step.gate_code !== gateCode) {
      dropped.push({ field: 'step_code', reason: 'langkah bukan milik gerbang yang dipilih', value: preview(stepCandidate) });
    } else {
      stepCode = step.code;
    }
  }

  const summary = clampText('summary', raw.summary, DRAFT_SUMMARY_MAX, dropped, true) ?? '';
  const discipline = clampText('discipline', raw.discipline, DRAFT_DISCIPLINE_MAX, dropped, true);
  const downstreamImpact = clampText('downstream_impact', raw.downstream_impact, DRAFT_IMPACT_MAX, dropped, false);

  let isBlocking = false;
  if (typeof raw.is_blocking === 'boolean') isBlocking = raw.is_blocking;
  else if (isPresent(raw.is_blocking)) {
    dropped.push({ field: 'is_blocking', reason: 'bukan boolean, dianggap false', value: preview(raw.is_blocking) });
  }

  let dueSuggestion: SiteEventDraft['due_suggestion'] = { kind: 'none', days: 0 };
  const due = raw.due_suggestion;
  if (isRecord(due) && due.kind === 'relative' && typeof due.days === 'number' && Number.isFinite(due.days)) {
    const days = Math.round(due.days);
    if (days > DRAFT_DUE_DAYS_MAX) {
      dropped.push({ field: 'due_suggestion', reason: `dibatasi ke ${DRAFT_DUE_DAYS_MAX} hari`, value: preview(due.days) });
      dueSuggestion = { kind: 'relative', days: DRAFT_DUE_DAYS_MAX };
    } else if (days >= 1) {
      dueSuggestion = { kind: 'relative', days };
    } else {
      dueSuggestion = { kind: 'none', days: 0 };
      dropped.push({ field: 'due_suggestion', reason: 'tenggat kurang dari 1 hari, dianggap tidak ada', value: preview(due.days) });
    }
  } else if (!(isRecord(due) && due.kind === 'none') && isPresent(due)) {
    dropped.push({ field: 'due_suggestion', reason: 'format tenggat tidak valid, diabaikan', value: preview(due) });
  }

  // VO: a commercial claim must point at the supervisor's own words.
  const voRaw = isRecord(raw.vo) ? raw.vo : null;
  if (!voRaw && isPresent(raw.vo)) {
    dropped.push({ field: 'vo', reason: 'format VO tidak valid, dianggap tidak ada', value: preview(raw.vo) });
  }
  let voFlag: 'none' | 'suggested' = 'none';
  if (voRaw && voRaw.flag === 'suggested') voFlag = 'suggested';
  else if (voRaw && isPresent(voRaw.flag) && voRaw.flag !== 'none') {
    dropped.push({ field: 'vo.flag', reason: 'nilai flag VO tidak dikenal, dianggap none', value: preview(voRaw.flag) });
  }
  let voReason = clampText('vo.reason', voRaw ? voRaw.reason : null, DRAFT_REASON_MAX, dropped, true) ?? '';
  const voQuotes = filterQuotes('vo.evidence_quotes', voRaw ? voRaw.evidence_quotes : null, sources, dropped);
  if (voFlag === 'suggested' && voQuotes.length === 0) {
    voFlag = 'none';
    dropped.push({
      field: 'vo.flag',
      reason: 'usulan VO diturunkan ke none: tidak ada kutipan dasar yang lolos',
      value: preview(voReason),
    });
    voReason = '';
  }

  let mismatch: SiteEventDraft['mismatch'] = { flag: false, reason: null };
  if (isRecord(raw.mismatch)) {
    if (typeof raw.mismatch.flag === 'boolean') {
      mismatch = raw.mismatch.flag
        ? { flag: true, reason: clampText('mismatch.reason', raw.mismatch.reason, DRAFT_REASON_MAX, dropped, true) }
        : { flag: false, reason: null };
    } else {
      dropped.push({ field: 'mismatch', reason: 'format ketidakcocokan tidak valid, dianggap tidak ada', value: preview(raw.mismatch) });
    }
  } else if (isPresent(raw.mismatch)) {
    dropped.push({ field: 'mismatch', reason: 'format ketidakcocokan tidak valid, dianggap tidak ada', value: preview(raw.mismatch) });
  }

  let relatedOpenEventId: string | null = null;
  const relatedCandidate = optionalString('related_open_event_id', raw.related_open_event_id, dropped);
  if (relatedCandidate) {
    if (ctx.openEventIds.includes(relatedCandidate)) relatedOpenEventId = relatedCandidate;
    else {
      dropped.push({
        field: 'related_open_event_id',
        reason: 'id kejadian terkait tidak ada di daftar yang diberikan',
        value: preview(relatedCandidate),
      });
    }
  }

  const evidenceQuotes = filterQuotes('evidence_quotes', raw.evidence_quotes, sources, dropped);

  let confidence = confidenceCandidate as AiConfidence;
  if (ctx.transcriptionFailed && confidence === 'high') {
    confidence = 'medium';
    dropped.push({ field: 'confidence', reason: 'transkripsi gagal, keyakinan diturunkan ke medium' });
  }

  const draft: SiteEventDraft = {
    event_type: eventType as SiteEventTypeCode,
    gate_code: gateCode,
    step_code: stepCode,
    title,
    summary,
    discipline,
    is_blocking: isBlocking,
    downstream_impact: downstreamImpact,
    due_suggestion: dueSuggestion,
    vo: { flag: voFlag, reason: voReason, evidence_quotes: voQuotes },
    mismatch,
    related_open_event_id: relatedOpenEventId,
    confidence,
    evidence_quotes: evidenceQuotes,
    dropped,
  };

  return { ok: true, draft, dropped };
}
