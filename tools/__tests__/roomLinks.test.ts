/**
 * The QR label is a physical object with a URL printed on it. Everything that
 * reads that URL - the phone camera, the in-app scanner, a human typing the
 * text under the code - funnels through parseRoomUrl, so its refusals are the
 * app's refusals. Spec §8: anything that is not a SANO room URL gives
 * "QR bukan label ruangan SANO.", never a silent no-op.
 *
 * parseRoomUrl deliberately normalizes the room code it returns (a typed-in
 * lowercase URL still finds the room) but leaves the project code alone beyond
 * trimming - project codes are the estimator's own strings and are matched
 * case-insensitively by the screen, not rewritten here.
 */
import { buildRoomUrl, parseRoomUrl, ROOM_LINK_HOST } from '../roomLinks';

describe('buildRoomUrl', () => {
  it('builds the https URL the QR encodes', () => {
    expect(buildRoomUrl('GA17', 'L2-KM-UTAMA')).toBe(
      'https://sano-app.vercel.app/r/GA17/L2-KM-UTAMA',
    );
  });

  it('uses the shared host constant', () => {
    expect(buildRoomUrl('GA17', 'UMUM')).toContain(ROOM_LINK_HOST);
  });

  it('percent-encodes codes that would otherwise break the path', () => {
    expect(buildRoomUrl('SPH 4', 'UMUM')).toBe(
      'https://sano-app.vercel.app/r/SPH%204/UMUM',
    );
  });
});

describe('parseRoomUrl - accepted forms', () => {
  it('round-trips what buildRoomUrl produced', () => {
    expect(parseRoomUrl(buildRoomUrl('GA17', 'L2-KM-UTAMA'))).toEqual({
      projectCode: 'GA17',
      roomCode: 'L2-KM-UTAMA',
    });
  });

  it('accepts the custom scheme', () => {
    expect(parseRoomUrl('sano://r/GA17/L2-KM-UTAMA')).toEqual({
      projectCode: 'GA17',
      roomCode: 'L2-KM-UTAMA',
    });
  });

  it('accepts a trailing slash', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/UMUM/')).toEqual({
      projectCode: 'GA17',
      roomCode: 'UMUM',
    });
  });

  it('ignores a query string and a fragment', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/UMUM?utm=qr#top')).toEqual({
      projectCode: 'GA17',
      roomCode: 'UMUM',
    });
  });

  it('decodes percent-encoded segments', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/SPH%204/UMUM')).toEqual({
      projectCode: 'SPH 4',
      roomCode: 'UMUM',
    });
  });

  it('normalizes a hand-typed lowercase room code', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/l2-km-utama')).toEqual({
      projectCode: 'GA17',
      roomCode: 'L2-KM-UTAMA',
    });
  });

  it('is case-insensitive about the host and the scheme', () => {
    expect(parseRoomUrl('HTTPS://SANO-APP.VERCEL.APP/r/GA17/UMUM')).toEqual({
      projectCode: 'GA17',
      roomCode: 'UMUM',
    });
  });

  it('tolerates surrounding whitespace from a scanner payload', () => {
    expect(parseRoomUrl('  sano://r/GA17/UMUM  ')).toEqual({
      projectCode: 'GA17',
      roomCode: 'UMUM',
    });
  });
});

describe('parseRoomUrl - refusals', () => {
  it('rejects another host', () => {
    expect(parseRoomUrl('https://example.com/r/GA17/UMUM')).toBeNull();
    expect(parseRoomUrl('https://sano-app.vercel.app.evil.com/r/GA17/UMUM')).toBeNull();
  });

  it('rejects another scheme', () => {
    expect(parseRoomUrl('http://sano-app.vercel.app/r/GA17/UMUM')).toBeNull();
    expect(parseRoomUrl('datum://r/GA17/UMUM')).toBeNull();
  });

  it('rejects another path prefix', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/x/GA17/UMUM')).toBeNull();
    expect(parseRoomUrl('https://sano-app.vercel.app/GA17/UMUM')).toBeNull();
  });

  it('rejects a wrong number of segments', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17')).toBeNull();
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/UMUM/EXTRA')).toBeNull();
  });

  it('rejects a room code that normalizes to nothing', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/%20%20')).toBeNull();
  });

  it('rejects a malformed percent escape instead of throwing', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/%E0%A4%A')).toBeNull();
  });

  it('rejects plain text and empty input', () => {
    expect(parseRoomUrl('Kamar Mandi Utama')).toBeNull();
    expect(parseRoomUrl('')).toBeNull();
    expect(parseRoomUrl('   ')).toBeNull();
  });
});
