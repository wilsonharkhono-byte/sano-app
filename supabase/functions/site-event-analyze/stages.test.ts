import { assertEquals } from 'std/assert';
import {
  ANALYSIS_WRITABLE_COLUMNS,
  buildRunRow,
  claimUpdate,
  decideStages,
  effectiveTranscript,
  failureUpdate,
  quotaUpdate,
  releaseClaimUpdate,
  successUpdate,
  transcriptSource,
} from './stages.ts';
import { AI_QUOTA_MESSAGE, sanitizeJsonForPostgres } from './util.ts';
import type { SiteEventDraft } from './validate.ts';

const ev = (over: Partial<{ status: string; transcript: string | null; ai_draft: unknown; analysis_attempts: number }> = {}) => ({
  status: 'pending_analysis', transcript: null, ai_draft: null, analysis_attempts: 0, ...over,
});

const draft = { confidence: 'medium', mismatch: { flag: true, reason: 'x' } } as unknown as SiteEventDraft;

Deno.test('refuses to analyse an event a human already confirmed, closed or discarded', () => {
  for (const status of ['open', 'done', 'discarded']) {
    const d = decideStages(ev({ status }), true, true);
    assertEquals(d.run, false);
    if (!d.run) {
      assertEquals(d.httpStatus, 409);
      assertEquals(d.code, 'NOT_ANALYZABLE');
    }
  }
});

Deno.test('a fresh event with audio runs both stages', () => {
  assertEquals(decideStages(ev(), true, false), { run: true, transcribe: true, analyze: true });
});

Deno.test('an existing transcript is never re-transcribed, even when forced', () => {
  assertEquals(decideStages(ev({ transcript: 'ada' }), true, true), { run: true, transcribe: false, analyze: true });
});

Deno.test('no audio means no transcription stage', () => {
  assertEquals(decideStages(ev(), false, false), { run: true, transcribe: false, analyze: true });
});

Deno.test('an existing draft is kept unless the supervisor forces a re-analysis', () => {
  const kept = decideStages(ev({ status: 'draft', transcript: 'ada', ai_draft: {} }), true, false);
  assertEquals(kept.run, false);
  if (!kept.run) assertEquals([kept.httpStatus, kept.code], [200, 'NOTHING_TO_DO']);
  assertEquals(decideStages(ev({ status: 'draft', transcript: 'ada', ai_draft: {} }), true, true), { run: true, transcribe: false, analyze: true });
});

Deno.test('a success moves pending_analysis to draft and writes only analysis columns', () => {
  const u = successUpdate({ status: 'pending_analysis' }, draft, 'claude-sonnet-5', null);
  assertEquals(u.status, 'draft');
  assertEquals(u.ai_confidence, 'medium');
  assertEquals(u.ai_mismatch, true);
  assertEquals(u.last_error, null);
  for (const key of Object.keys(u)) assertEquals(ANALYSIS_WRITABLE_COLUMNS.includes(key), true);
});

Deno.test('a forced re-analysis of a draft never touches status', () => {
  assertEquals('status' in successUpdate({ status: 'draft' }, draft, 'claude-sonnet-5', 'Transkripsi gagal.'), false);
});

Deno.test('a failure keeps the transcription error visible and never touches analysis_attempts (claimed separately, up front)', () => {
  const u = failureUpdate('Hasil AI tidak valid: title kosong', 'Transkripsi gagal. timeout');
  assertEquals(u.last_error, 'Transkripsi gagal. timeout Hasil AI tidak valid: title kosong');
  assertEquals('analysis_attempts' in u, false);
  for (const key of Object.keys(u)) assertEquals(ANALYSIS_WRITABLE_COLUMNS.includes(key), true);
});

Deno.test('the quota update writes the exact message the app matches on, and nothing else', () => {
  assertEquals(quotaUpdate(), { last_error: AI_QUOTA_MESSAGE });
});

Deno.test('claimUpdate reserves exactly the next attempt and nothing else', () => {
  const u = claimUpdate({ analysis_attempts: 4 });
  assertEquals(u, { analysis_attempts: 5 });
  for (const key of Object.keys(u)) assertEquals(ANALYSIS_WRITABLE_COLUMNS.includes(key), true);
});

Deno.test('releaseClaimUpdate hands back exactly the attempt the claim took', () => {
  const ev = { analysis_attempts: 4 };
  assertEquals(claimUpdate(ev), { analysis_attempts: 5 });
  assertEquals(releaseClaimUpdate(ev), { analysis_attempts: 4 });
  for (const key of Object.keys(releaseClaimUpdate(ev))) {
    assertEquals(ANALYSIS_WRITABLE_COLUMNS.includes(key), true);
  }
});

Deno.test('sanitizeJsonForPostgres strips a lone surrogate the model left in vo.reason before it reaches ai_draft', () => {
  const dirty = {
    confidence: 'medium',
    mismatch: { flag: true, reason: 'x' },
    vo: { flag: 'suggested', reason: 'retak\uD800 struktur', evidence_quotes: ['a'] },
  } as unknown as SiteEventDraft;
  const u = sanitizeJsonForPostgres(successUpdate({ status: 'pending_analysis' }, dirty, 'claude-sonnet-5', null));
  const savedDraft = u.ai_draft as { vo: { reason: string } };
  assertEquals(savedDraft.vo.reason, 'retak� struktur');
  // Everything else in the update survives the round trip untouched.
  assertEquals(u.status, 'draft');
  assertEquals(u.ai_confidence, 'medium');
});

Deno.test('the supervisor-edited transcript wins, and the source is labelled', () => {
  assertEquals(effectiveTranscript('koreksi', 'asli'), 'koreksi');
  assertEquals(effectiveTranscript('   ', 'asli'), 'asli');
  assertEquals(effectiveTranscript(null, null), null);
  assertEquals(transcriptSource('koreksi', 'asli'), 'edited');
  assertEquals(transcriptSource(null, 'asli'), 'stt');
  assertEquals(transcriptSource(null, null), 'none');
});

Deno.test('buildRunRow maps to site_event_ai_runs columns, rounds tokens and truncates the error', () => {
  const row = buildRunRow({
    eventId: 'e1', stage: 'analyze', model: 'claude-sonnet-5', promptHash: 'h', inputSummary: { photo_count: 2 },
    output: { a: 1 }, tokensIn: 1200.4, tokensOut: null, costUsd: 0.01, latencyMs: 812.6, status: 'error', error: 'x'.repeat(900),
  });
  assertEquals(Object.keys(row).sort(), [
    'cost_usd', 'error', 'event_id', 'input_summary', 'latency_ms', 'model', 'output', 'prompt_hash', 'stage', 'status', 'tokens_in', 'tokens_out',
  ]);
  assertEquals([row.tokens_in, row.tokens_out, row.latency_ms], [1200, null, 813]);
  assertEquals(row.error?.length, 500);
});
