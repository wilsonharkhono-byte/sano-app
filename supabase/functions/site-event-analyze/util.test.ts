import { assertEquals } from 'std/assert';
import {
  AI_QUOTA_MESSAGE,
  DAILY_CAP_DEFAULT,
  audioFilename,
  bytesToBase64,
  clampWorkGroupNames,
  isUuid,
  jakartaTodayLabel,
  parseDailyCap,
  sanitizeJsonForPostgres,
  selectAnalysisPhotos,
  sha256Hex,
  startOfJakartaDayUtcIso,
  truncate,
  type MediaRow,
} from './util.ts';

const media = (over: Partial<MediaRow>): MediaRow => ({
  id: crypto.randomUUID(), kind: 'photo', role: 'closeup', storage_path: 'site-events/p/e/x.jpg',
  mime_type: 'image/jpeg', sort_order: 0, duration_s: null, bytes: null, ...over,
});

Deno.test('isUuid accepts a v4 uuid and rejects anything else', () => {
  assertEquals(isUuid('11111111-1111-4111-8111-111111111111'), true);
  assertEquals(isUuid('not-a-uuid'), false);
  assertEquals(isUuid(42), false);
});

Deno.test('bytesToBase64 encodes small and large buffers', () => {
  assertEquals(bytesToBase64(new TextEncoder().encode('SANO')), 'U0FOTw==');
  const big = new Uint8Array(200_000).fill(65);
  assertEquals(atob(bytesToBase64(big)).length, 200_000);
});

Deno.test('startOfJakartaDayUtcIso uses the Jakarta calendar day', () => {
  assertEquals(startOfJakartaDayUtcIso(new Date('2026-09-10T18:30:00Z')), '2026-09-10T17:00:00.000Z');
  assertEquals(startOfJakartaDayUtcIso(new Date('2026-09-10T16:59:59Z')), '2026-09-09T17:00:00.000Z');
});

Deno.test('selectAnalysisPhotos puts the context photo first, caps at 4, and counts what it skipped', () => {
  const rows = [
    media({ role: 'closeup', sort_order: 1 }),
    media({ role: 'closeup', sort_order: 2 }),
    media({ role: 'context', sort_order: 0 }),
    media({ role: 'closeup', sort_order: 3 }),
    media({ role: 'closeup', sort_order: 4 }),
    media({ role: 'closeup', sort_order: 5, mime_type: 'image/heic' }),
    media({ kind: 'audio', role: 'audio', mime_type: 'audio/mp4' }),
    media({ role: 'closure' }),
  ];
  const { selected, skipped } = selectAnalysisPhotos(rows);
  assertEquals(selected.map((m) => `${m.role}:${m.sort_order}`), ['context:0', 'closeup:1', 'closeup:2', 'closeup:3']);
  assertEquals(skipped, 2);
});

Deno.test('audioFilename keeps the stored extension, else derives one from the MIME type', () => {
  assertEquals(audioFilename('site-events/p/e/a.m4a', 'audio/mp4'), 'audio.m4a');
  assertEquals(audioFilename('site-events/p/e/a.webm', 'audio/webm'), 'audio.webm');
  assertEquals(audioFilename('site-events/p/e/a', 'audio/webm'), 'audio.webm');
  assertEquals(audioFilename('site-events/p/e/a', null), 'audio.m4a');
});

Deno.test('audioFilename maps every MIME type the recorders actually report', () => {
  const cases: Array<[string | null, string]> = [
    ['audio/m4a', 'audio.m4a'],
    ['audio/x-m4a', 'audio.m4a'],
    ['audio/mp4', 'audio.m4a'],
    ['audio/aac', 'audio.aac'],
    ['audio/webm', 'audio.webm'],
    ['audio/webm;codecs=opus', 'audio.webm'],
    ['AUDIO/WEBM', 'audio.webm'],
    ['audio/mpeg', 'audio.mp3'],
    ['audio/wav', 'audio.wav'],
    ['audio/ogg', 'audio.m4a'],
    [null, 'audio.m4a'],
  ];
  for (const [mime, expected] of cases) {
    assertEquals(audioFilename('site-events/p/e/a', mime), expected, `${mime}`);
  }
});

Deno.test('jakartaTodayLabel names the Jakarta day, in Indonesian, across the UTC midnight', () => {
  // 17:30 UTC is already the next morning in Jakarta (UTC+7).
  assertEquals(jakartaTodayLabel('2026-09-10T17:30:00.000Z'), 'Jumat, 11 September 2026 (WIB)');
  assertEquals(jakartaTodayLabel('2026-09-10T16:59:59.000Z'), 'Kamis, 10 September 2026 (WIB)');
  // 23:00 UTC on new year's eve is already 1 January in Jakarta.
  assertEquals(jakartaTodayLabel('2026-12-31T23:00:00.000Z'), 'Jumat, 1 Januari 2027 (WIB)');
});

Deno.test('jakartaTodayLabel says it does not know rather than naming a wrong day', () => {
  assertEquals(jakartaTodayLabel('kemarin'), '(tanggal tidak diketahui)');
});

Deno.test('clampWorkGroupNames keeps unique trimmed strings, 80 characters, 30 at most', () => {
  assertEquals(clampWorkGroupNames('Kolom'), []);
  assertEquals(clampWorkGroupNames([' Kolom  Lantai 1 ', 'Kolom Lantai 1', 7, '']), ['Kolom Lantai 1']);
  assertEquals(clampWorkGroupNames(['x'.repeat(120)])[0].length, 80);
  assertEquals(clampWorkGroupNames(Array.from({ length: 50 }, (_, i) => `G${i}`)).length, 30);
});

Deno.test('sha256Hex matches the known digest of "abc"', async () => {
  assertEquals(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

Deno.test('truncate adds an ellipsis only when needed', () => {
  assertEquals(truncate('pendek', 10), 'pendek');
  assertEquals(truncate('panjang sekali', 8), 'panjang…');
});

Deno.test('the quota message is the one the app matches on', () => {
  assertEquals(AI_QUOTA_MESSAGE, 'Kuota analisis AI hari ini habis. Draf akan dibuat besok, atau isi manual.');
});

Deno.test('sanitizeJsonForPostgres replaces an unpaired high surrogate with U+FFFD', () => {
  assertEquals(sanitizeJsonForPostgres('a\uD800b'), 'a�b');
});

Deno.test('sanitizeJsonForPostgres replaces an unpaired low surrogate with U+FFFD', () => {
  assertEquals(sanitizeJsonForPostgres('a\uDC00b'), 'a�b');
});

Deno.test('sanitizeJsonForPostgres leaves a valid surrogate pair (emoji) untouched', () => {
  assertEquals(sanitizeJsonForPostgres('lantai 🏠 rumah'), 'lantai 🏠 rumah');
});

Deno.test('sanitizeJsonForPostgres leaves a string with no surrogates untouched', () => {
  const text = 'sudah dicor, tunggu besok';
  assertEquals(sanitizeJsonForPostgres(text), text);
});

Deno.test('sanitizeJsonForPostgres walks arrays and nested objects without dropping other fields', () => {
  const input = {
    event_type: 'isu',
    evidence_quotes: ['baik\uD800', 'normal'],
    mismatch: { flag: true, reason: 'catatan\uDC00lain' },
    confidence: 'low',
    count: 3,
    is_blocking: false,
    related_open_event_id: null,
  };
  assertEquals(sanitizeJsonForPostgres(input), {
    event_type: 'isu',
    evidence_quotes: ['baik�', 'normal'],
    mismatch: { flag: true, reason: 'catatan�lain' },
    confidence: 'low',
    count: 3,
    is_blocking: false,
    related_open_event_id: null,
  });
});

Deno.test('sanitizeJsonForPostgres leaves non-string primitives untouched', () => {
  assertEquals(sanitizeJsonForPostgres(42), 42);
  assertEquals(sanitizeJsonForPostgres(null), null);
  assertEquals(sanitizeJsonForPostgres(true), true);
});

Deno.test('sanitizeJsonForPostgres replaces U+0000 with U+FFFD — jsonb and text both refuse it', () => {
  assertEquals(sanitizeJsonForPostgres('a\u0000b'), 'a\uFFFDb');
  assertEquals(sanitizeJsonForPostgres({ error: 'gagal\u0000total', quotes: ['x\u0000'] }), {
    error: 'gagal\uFFFDtotal',
    quotes: ['x\uFFFD'],
  });
});

Deno.test('parseDailyCap uses the default when the secret is unset, and does not call that invalid', () => {
  assertEquals(parseDailyCap(undefined), { cap: DAILY_CAP_DEFAULT, invalid: false });
  assertEquals(parseDailyCap(null), { cap: DAILY_CAP_DEFAULT, invalid: false });
  assertEquals(DAILY_CAP_DEFAULT, 200);
});

Deno.test('parseDailyCap accepts a positive integer, trimmed', () => {
  assertEquals(parseDailyCap('50'), { cap: 50, invalid: false });
  assertEquals(parseDailyCap('  50  '), { cap: 50, invalid: false });
  assertEquals(parseDailyCap('1'), { cap: 1, invalid: false });
});

Deno.test('parseDailyCap fails closed on every value Number() would turn into NaN or 0', () => {
  // Number('20O') is NaN and every comparison against NaN is false, so the cap
  // would disappear; Number('') is 0, so every analysis would be refused.
  for (const raw of ['20O', '', '   ', '2e3', '1.5', '-5', '0', 'null', '200 kali', '+200', '0x10', '9'.repeat(20)]) {
    const parsed = parseDailyCap(raw);
    assertEquals(parsed, { cap: DAILY_CAP_DEFAULT, invalid: true }, raw);
    assertEquals(Number.isSafeInteger(parsed.cap) && parsed.cap >= 1, true, raw);
  }
});
