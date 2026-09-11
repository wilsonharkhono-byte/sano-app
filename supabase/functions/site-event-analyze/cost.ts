// SANO - Spend arithmetic for site_event_ai_runs.cost_usd (pure).
//
// Prices (claude-api skill, model table cached 2026-06-24): claude-sonnet-5
// USD 2 input / USD 10 output per million tokens; claude-opus-5 USD 5 / USD 25.
// Cache writes bill at 1.25x the input price, cache reads at 0.1x.
// Transcription: spec §2 decision 6, roughly USD 0.003 per audio minute.
//
// A model with no known price returns null. SITE_EVENT_MODEL can point the
// function at another model, and an unpriced call is recorded as unknown rather
// than as a number someone made up.

export const CLAUDE_USD_PER_MTOK: Readonly<Record<string, { input: number; output: number }>> = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
};

export const OPENAI_TRANSCRIBE_USD_PER_MINUTE = 0.003;

export interface ClaudeUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function claudeCostUsd(model: string, usage: ClaudeUsage | null | undefined): number | null {
  const price = CLAUDE_USD_PER_MTOK[model];
  if (!price || !usage) return null;
  const input =
    count(usage.input_tokens) * price.input +
    count(usage.cache_creation_input_tokens) * price.input * 1.25 +
    count(usage.cache_read_input_tokens) * price.input * 0.1;
  const output = count(usage.output_tokens) * price.output;
  return round6((input + output) / 1_000_000);
}

export function transcribeCostUsd(durationSeconds: number | null | undefined): number | null {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < 0) return null;
  return round6((durationSeconds / 60) * OPENAI_TRANSCRIBE_USD_PER_MINUTE);
}
