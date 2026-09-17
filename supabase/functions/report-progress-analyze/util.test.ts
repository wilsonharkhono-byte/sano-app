// supabase/functions/report-progress-analyze/util.test.ts
import { assertEquals } from 'std/assert';
import {
  isAccountLevelProviderError, isoDaysBefore, isUuid, jakartaTodayLabel, parseDailyCap, photoPathFromSignedUrl,
  sanitizeJsonForPostgres, startOfJakartaDayUtcIso, truncate, DAILY_CAP_DEFAULT,
} from './util.ts';

// Built with fromCharCode so the fixtures are unambiguous in any editor: a lone
// high surrogate, a NUL, and the replacement character the sanitizer writes.
const LONE_HIGH_SURROGATE = String.fromCharCode(0xd83d);
const NUL = String.fromCharCode(0);
const REPLACEMENT = String.fromCharCode(0xfffd);
const SMILEY = String.fromCodePoint(0x1f600);

Deno.test('parseDailyCap accepts only positive integers and falls back loudly', () => {
  assertEquals(parseDailyCap(undefined), { cap: DAILY_CAP_DEFAULT, invalid: false });
  assertEquals(parseDailyCap('25'), { cap: 25, invalid: false });
  assertEquals(parseDailyCap('0'), { cap: DAILY_CAP_DEFAULT, invalid: true });
  assertEquals(parseDailyCap('abc'), { cap: DAILY_CAP_DEFAULT, invalid: true });
});

Deno.test('isUuid accepts a v4 uuid and rejects near misses', () => {
  assertEquals(isUuid('11e59d22-5aa8-436e-b82d-ccbd6c2bdd7d'), true);
  assertEquals(isUuid('11e59d22-5aa8-436e-b82d-ccbd6c2bdd7'), false);
  assertEquals(isUuid(42), false);
});

Deno.test('startOfJakartaDayUtcIso is 17:00 UTC of the previous UTC day for a Jakarta morning', () => {
  assertEquals(startOfJakartaDayUtcIso(new Date('2026-09-13T01:30:00.000Z')), '2026-09-12T17:00:00.000Z');
  assertEquals(startOfJakartaDayUtcIso(new Date('2026-09-12T18:00:00.000Z')), '2026-09-12T17:00:00.000Z');
});

Deno.test('jakartaTodayLabel names the Jakarta day, not the UTC day', () => {
  assertEquals(jakartaTodayLabel('2026-09-12T18:00:00.000Z'), 'Minggu, 13 September 2026 (WIB)');
});

Deno.test('isoDaysBefore does calendar arithmetic across a month boundary', () => {
  assertEquals(isoDaysBefore('2026-09-13', 14), '2026-08-30');
  assertEquals(isoDaysBefore('2026-03-01', 1), '2026-02-28');
});

Deno.test('photoPathFromSignedUrl recovers bare photos paths and prefixed private paths', () => {
  assertEquals(photoPathFromSignedUrl('https://x.supabase.co/storage/v1/object/sign/photos/a/b.jpg?token=t'), 'a/b.jpg');
  assertEquals(photoPathFromSignedUrl('https://x.supabase.co/storage/v1/object/sign/site-media/c/d.jpg?token=t'), 'site-media:c/d.jpg');
  assertEquals(photoPathFromSignedUrl('https://example.com/x.jpg'), null);
});

Deno.test('sanitizeJsonForPostgres replaces unpaired surrogates and NUL, leaves valid text alone', () => {
  assertEquals(
    sanitizeJsonForPostgres({ a: `ok ${SMILEY}`, b: `bad ${LONE_HIGH_SURROGATE} end`, c: `nul${NUL}` }),
    { a: `ok ${SMILEY}`, b: `bad ${REPLACEMENT} end`, c: `nul${REPLACEMENT}` },
  );
  assertEquals(sanitizeJsonForPostgres(['x', 1, null, { deep: `${LONE_HIGH_SURROGATE}` }]), ['x', 1, null, { deep: REPLACEMENT }]);
});

Deno.test('truncate appends an ellipsis only when it cuts', () => {
  assertEquals(truncate('abc', 5), 'abc');
  assertEquals(truncate('abcdef', 4), 'abc…');
});

Deno.test('isAccountLevelProviderError stops a batch on a bad key, a missing permission or no credit, not on one bad request', () => {
  assertEquals(isAccountLevelProviderError(401, { type: 'error', error: { type: 'authentication_error', message: 'API key is invalid.' } }), true);
  assertEquals(isAccountLevelProviderError(403, null), true);
  assertEquals(isAccountLevelProviderError(400, { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }), true);
  assertEquals(isAccountLevelProviderError(400, { error: { type: 'invalid_request_error', message: 'messages: text content blocks must be non-empty' } }), false);
  assertEquals(isAccountLevelProviderError(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }), false);
  assertEquals(isAccountLevelProviderError(500, 'not json'), false);
});
