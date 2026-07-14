import { generateClientReceiptId, type CryptoLike } from '../receiptIdempotency';

const V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateClientReceiptId', () => {
  it('uses randomUUID when the runtime provides it', () => {
    const randomUUID = jest.fn(() => '11111111-1111-4111-8111-111111111111');
    const id = generateClientReceiptId({ randomUUID });
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('falls back to getRandomValues and builds a valid v4 UUID', () => {
    // Fake CSPRNG: fill with fresh pseudo-random bytes each call. (Production
    // uses the injected real crypto; Math.random here only simulates entropy.)
    const crypto: CryptoLike = {
      getRandomValues: (arr) => {
        const u8 = arr as unknown as Uint8Array;
        for (let i = 0; i < u8.length; i++) u8[i] = Math.floor(Math.random() * 256);
        return arr;
      },
    };
    const id = generateClientReceiptId(crypto);
    expect(id).toMatch(V4_RE);
    // Version nibble is 4, variant nibble is one of 8/9/a/b regardless of input.
    expect(id![14]).toBe('4');
    expect(['8', '9', 'a', 'b']).toContain(id![19]);
  });

  it('returns distinct ids across calls (no accidental constant)', () => {
    const crypto: CryptoLike = {
      getRandomValues: (arr) => {
        const u8 = arr as unknown as Uint8Array;
        for (let i = 0; i < u8.length; i++) u8[i] = Math.floor(Math.random() * 256);
        return arr;
      },
    };
    const a = generateClientReceiptId(crypto);
    const b = generateClientReceiptId(crypto);
    expect(a).not.toBe(b);
  });

  it('returns null when crypto exposes no usable method (native Hermes → legacy NULL path)', () => {
    expect(generateClientReceiptId({})).toBeNull();
  });

  it('resolves the runtime crypto global by default (web/Node secure context)', () => {
    // The default arg reads globalThis.crypto; Node's jest env provides
    // randomUUID, so a no-arg call yields a real v4 UUID (mirrors Expo web).
    expect(generateClientReceiptId()).toMatch(V4_RE);
  });
});
