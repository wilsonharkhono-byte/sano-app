// SANO - Stage decisions and row builders for site-event-analyze (pure).
//
// The edge function's choices, kept out of index.ts so they are testable:
// which stages run, what a success or failure writes, and the audit row shape.
// Spec §6 "Idempotency": transcription is skipped when a transcript exists;
// analysis is skipped when ai_draft exists unless forced; pending_analysis →
// draft is the only status transition the function performs.

import { AI_QUOTA_MESSAGE, truncate } from './util.ts';
import type { SiteEventDraft } from './validate.ts';

/** Spec §1.1 rule 1: the only site_events columns this function may write. */
export const ANALYSIS_WRITABLE_COLUMNS: ReadonlyArray<string> = [
  'transcript', 'ai_draft', 'ai_confidence', 'ai_mismatch', 'ai_model', 'status', 'last_error', 'analysis_attempts',
];

export interface StageEvent {
  status: string;
  transcript: string | null;
  ai_draft: unknown | null;
  analysis_attempts: number;
}

export type StageDecision =
  | { run: false; httpStatus: 200 | 409; code: 'NOTHING_TO_DO' | 'NOT_ANALYZABLE'; message: string }
  | { run: true; transcribe: boolean; analyze: boolean };

export function decideStages(ev: StageEvent, hasAudio: boolean, force: boolean): StageDecision {
  if (ev.status !== 'pending_analysis' && ev.status !== 'draft') {
    return {
      run: false,
      httpStatus: 409,
      code: 'NOT_ANALYZABLE',
      message: `Kejadian berstatus ${ev.status}; analisis hanya untuk kejadian yang belum dikonfirmasi.`,
    };
  }
  const transcribe = hasAudio && !ev.transcript;
  const analyze = force || ev.ai_draft === null;
  if (!transcribe && !analyze) {
    return {
      run: false,
      httpStatus: 200,
      code: 'NOTHING_TO_DO',
      message: 'Draf AI sudah ada. Gunakan Analisis ulang untuk membuat ulang.',
    };
  }
  return { run: true, transcribe, analyze };
}

export function effectiveTranscript(edited: string | null, transcript: string | null): string | null {
  if (edited && edited.trim()) return edited;
  if (transcript && transcript.trim()) return transcript;
  return null;
}

export function transcriptSource(edited: string | null, transcript: string | null): 'edited' | 'stt' | 'none' {
  if (edited && edited.trim()) return 'edited';
  if (transcript && transcript.trim()) return 'stt';
  return 'none';
}

export function successUpdate(
  ev: { status: string },
  draft: SiteEventDraft,
  model: string,
  sttError: string | null,
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    ai_draft: draft,
    ai_confidence: draft.confidence,
    ai_mismatch: draft.mismatch.flag,
    ai_model: model,
    last_error: sttError,
  };
  if (ev.status === 'pending_analysis') update.status = 'draft';
  return update;
}

export function failureUpdate(
  ev: { analysis_attempts: number },
  message: string,
  sttError: string | null,
): Record<string, unknown> {
  return {
    last_error: truncate([sttError, message].filter((part) => !!part).join(' '), 500),
    analysis_attempts: ev.analysis_attempts + 1,
  };
}

/** Not a failure of the model, so it does not count as an attempt. */
export function quotaUpdate(): Record<string, unknown> {
  return { last_error: AI_QUOTA_MESSAGE };
}

export interface RunRow {
  event_id: string;
  stage: 'transcribe' | 'analyze';
  model: string;
  prompt_hash: string;
  input_summary: Record<string, unknown>;
  output: unknown;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  latency_ms: number;
  status: 'ok' | 'rejected' | 'error';
  error: string | null;
}

const toInt = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

export function buildRunRow(input: {
  eventId: string;
  stage: 'transcribe' | 'analyze';
  model: string;
  promptHash: string;
  inputSummary: Record<string, unknown>;
  output: unknown;
  tokensIn: number | null | undefined;
  tokensOut: number | null | undefined;
  costUsd: number | null;
  latencyMs: number;
  status: 'ok' | 'rejected' | 'error';
  error: string | null;
}): RunRow {
  return {
    event_id: input.eventId,
    stage: input.stage,
    model: input.model,
    prompt_hash: input.promptHash,
    input_summary: input.inputSummary,
    output: input.output ?? null,
    tokens_in: toInt(input.tokensIn),
    tokens_out: toInt(input.tokensOut),
    cost_usd: input.costUsd,
    latency_ms: Math.round(input.latencyMs),
    status: input.status,
    error: input.error === null ? null : truncate(input.error, 500),
  };
}
