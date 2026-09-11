/**
 * normalizeRoomCode is a VERBATIM port of DATUM's normalizeAreaCode
 * (DATUM Studio Brain packages/core/src/areas/extract.ts:100-109). The first
 * describe block is DATUM's own suite, copied so a drift on either side fails
 * here: release 2 links a SANO room to a DATUM area on (project_code,
 * room_code), and a normalizer that gains one extra rule turns that upsert into
 * a manual reconciliation.
 *
 * The second block is the SANO half - the Indonesian names an estimator
 * actually types, and the 40-character slice, which is the one place where
 * normalize can hand back a string isValidRoomCode rejects.
 */
import { normalizeRoomCode, normalizeRoomCodeUnsliced, isValidRoomCode, ROOM_CODE_MAX } from '../roomCodes';

describe('normalizeRoomCode - DATUM parity fixtures', () => {
  it('uppercases, trims, slugifies', () => {
    expect(normalizeRoomCode('l1 kitchen')).toBe('L1-KITCHEN');
    expect(normalizeRoomCode('  KM-ANAK  ')).toBe('KM-ANAK');
    expect(normalizeRoomCode('L1--KITCHEN--')).toBe('L1-KITCHEN');
  });

  it('strips non-alphanumeric-hyphen characters', () => {
    expect(normalizeRoomCode('L1.Kitchen!')).toBe('L1KITCHEN');
  });

  it('returns empty string for blank input', () => {
    expect(normalizeRoomCode('   ')).toBe('');
  });
});

describe('normalizeRoomCode - SANO room names', () => {
  it('turns a typed Indonesian room name into a label code', () => {
    expect(normalizeRoomCode('Kamar Mandi Utama Lt.2')).toBe('KAMAR-MANDI-UTAMA-LT2');
    expect(normalizeRoomCode('Lt.2 Kamar Mandi Utama')).toBe('LT2-KAMAR-MANDI-UTAMA');
  });

  it('collapses runs of separators and trims leading/trailing dashes', () => {
    expect(normalizeRoomCode('-- Lt 2 // Dapur --')).toBe('LT-2-DAPUR');
    expect(normalizeRoomCode('Lt 2   Dapur')).toBe('LT-2-DAPUR');
  });

  it('is idempotent - a normalized code normalizes to itself', () => {
    const once = normalizeRoomCode('Kamar Mandi Utama Lt.2');
    expect(normalizeRoomCode(once)).toBe(once);
  });

  it('slices to 40 characters, exactly like DATUM', () => {
    const long = 'RUANG TAMU UTAMA LANTAI DUA SAYAP BARAT DEPAN'; // 45 chars
    const code = normalizeRoomCode(long);
    expect(code).toBe('RUANG-TAMU-UTAMA-LANTAI-DUA-SAYAP-BARAT-');
    expect(code).toHaveLength(ROOM_CODE_MAX);
  });

  it('is normalizeRoomCodeUnsliced sliced to 40, and the unsliced chain can run past 40', () => {
    const long = 'RUANG TAMU UTAMA LANTAI DUA SAYAP BARAT DEPAN'; // 45 chars
    expect(normalizeRoomCode(long)).toBe(normalizeRoomCodeUnsliced(long).slice(0, 40));
    expect(normalizeRoomCodeUnsliced(long).length).toBeGreaterThan(40);
  });
});

describe('isValidRoomCode', () => {
  it('accepts the shape the database CHECK accepts', () => {
    expect(isValidRoomCode('UMUM')).toBe(true);
    expect(isValidRoomCode('L2-KM-UTAMA')).toBe(true);
    expect(isValidRoomCode('PC5')).toBe(true);
  });

  it('rejects empty, lowercase, spaced, and doubled-dash codes', () => {
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('l2-km')).toBe(false);
    expect(isValidRoomCode('L2 KM')).toBe(false);
    expect(isValidRoomCode('L2--KM')).toBe(false);
  });

  it('rejects leading and trailing dashes', () => {
    expect(isValidRoomCode('-L2')).toBe(false);
    expect(isValidRoomCode('L2-')).toBe(false);
  });

  it('rejects anything longer than 40 characters', () => {
    expect(isValidRoomCode('A'.repeat(ROOM_CODE_MAX))).toBe(true);
    expect(isValidRoomCode('A'.repeat(ROOM_CODE_MAX + 1))).toBe(false);
  });

  // The one honest seam between the two functions: the slice happens LAST in
  // DATUM's chain, so a 45-character name whose 40th character is a separator
  // comes back with a trailing dash - a string normalize produced and
  // isValidRoomCode refuses. The office form must surface that rather than
  // save it; the database CHECK in 096 refuses it too.
  it('rejects a normalized code the 40-character slice left with a trailing dash', () => {
    const code = normalizeRoomCode('RUANG TAMU UTAMA LANTAI DUA SAYAP BARAT DEPAN');
    expect(code.endsWith('-')).toBe(true);
    expect(isValidRoomCode(code)).toBe(false);
  });
});
