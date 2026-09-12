import { assertEquals } from 'std/assert';
import { claudeCostUsd, transcribeCostUsd } from './cost.ts';

Deno.test('prices claude-sonnet-5 at USD 2 / USD 10 per million tokens', () => {
  assertEquals(claudeCostUsd('claude-sonnet-5', { input_tokens: 10_000, output_tokens: 1_000 }), 0.03);
});

Deno.test('bills cache writes at 1.25x and cache reads at 0.1x the input price', () => {
  assertEquals(
    claudeCostUsd('claude-sonnet-5', {
      input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 10_000,
    }),
    0.0045,
  );
});

Deno.test('returns null for a model with no known price, never a guess', () => {
  assertEquals(claudeCostUsd('claude-unknown', { input_tokens: 5, output_tokens: 5 }), null);
  assertEquals(claudeCostUsd('claude-sonnet-5', null), null);
});

Deno.test('prices transcription by the minute', () => {
  assertEquals(transcribeCostUsd(90), 0.0045);
  assertEquals(transcribeCostUsd(0), 0);
});

Deno.test('returns null when the duration is unknown or invalid', () => {
  assertEquals(transcribeCostUsd(null), null);
  assertEquals(transcribeCostUsd(-3), null);
  assertEquals(transcribeCostUsd(Number.NaN), null);
});
