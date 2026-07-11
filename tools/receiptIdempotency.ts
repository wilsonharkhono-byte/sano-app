/**
 * Idempotency-key generation for receipt submission (migration 062).
 *
 * A receive-form session mints ONE id up front and reuses it across retries
 * (e.g. a network timeout-then-resubmit), so `submit_receipt` can dedup the
 * delivery server-side instead of double-booking it. The id must be a real
 * RFC-4122 v4 UUID (the DB column is `receipts.client_receipt_id UUID`) drawn
 * from a CSPRNG — never `Math.random`, which is predictable and collision-prone
 * and therefore unacceptable as an idempotency key.
 *
 * Runtime reality (checked 2026-07): this repo has NO `expo-crypto` dependency
 * and no crypto polyfill. On Expo web (the primary deployment,
 * sano-app.vercel.app) the browser exposes a secure-context `crypto` global
 * with `randomUUID`. On native Hermes there is no `crypto` global by default,
 * so we cannot mint a key and return `null`; the caller then passes NULL and
 * `submit_receipt` runs its legacy, non-idempotent path. That degradation is
 * SAFE — the server's FOR UPDATE lock + authoritative status recompute still
 * prevent data corruption — it merely forgoes retry-dedup on native until
 * `expo-crypto` is added. See the report for that follow-up.
 */

/** The subset of the Web Crypto API we rely on (kept local to avoid a DOM-lib dependency). */
export interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
}

function resolveCrypto(): CryptoLike | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  return (globalThis as unknown as { crypto?: CryptoLike }).crypto;
}

const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push((i + 0x100).toString(16).slice(1));

/**
 * Return a fresh v4 UUID string, or `null` when the runtime provides no CSPRNG.
 *
 * @param cryptoObj injectable for tests; defaults to the runtime `crypto` global.
 */
export function generateClientReceiptId(
  cryptoObj: CryptoLike | undefined = resolveCrypto(),
): string | null {
  if (!cryptoObj) return null;

  // Preferred: native randomUUID (browsers in a secure context; any RN runtime
  // that ships Web Crypto).
  if (typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  // Fallback: build a v4 UUID from CSPRNG bytes if only getRandomValues exists
  // (same entropy source randomUUID uses — a legitimate substitute, unlike
  // Math.random).
  if (typeof cryptoObj.getRandomValues === 'function') {
    const b = cryptoObj.getRandomValues(new Uint8Array(16));
    if (!b) return null;
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
    return (
      HEX[b[0]] + HEX[b[1]] + HEX[b[2]] + HEX[b[3]] + '-' +
      HEX[b[4]] + HEX[b[5]] + '-' +
      HEX[b[6]] + HEX[b[7]] + '-' +
      HEX[b[8]] + HEX[b[9]] + '-' +
      HEX[b[10]] + HEX[b[11]] + HEX[b[12]] + HEX[b[13]] + HEX[b[14]] + HEX[b[15]]
    );
  }

  return null;
}
