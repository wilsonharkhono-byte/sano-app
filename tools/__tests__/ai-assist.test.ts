// Mock supabase to prevent react-native-url-polyfill ESM import in Jest
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
  },
}));

import { extractJsonBlock } from '../ai-assist';

describe('extractJsonBlock', () => {
  it('extracts a plain object', () => {
    expect(extractJsonBlock('{"a":1,"b":2}')).toBe('{"a":1,"b":2}');
  });

  it('extracts a plain array', () => {
    expect(extractJsonBlock('[{"i":0},{"i":1}]')).toBe('[{"i":0},{"i":1}]');
  });

  it('extracts a large BoQ classification array (regression)', () => {
    // Reproduces the bug where only the first object inside the array
    // was returned, truncating hundreds of classifications to one.
    const raw = '[' + Array.from({ length: 100 }, (_, i) =>
      `{"i":${i},"g":"Pekerjaan Persiapan","f":null}`,
    ).join(',') + ']';

    const extracted = extractJsonBlock(raw);
    expect(extracted).toBe(raw);

    const parsed = JSON.parse(extracted!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(100);
  });

  it('extracts array from fenced code block', () => {
    const raw = 'Here is the JSON:\n```json\n[{"i":0,"g":"A","f":null}]\n```\nDone.';
    expect(extractJsonBlock(raw)).toBe('[{"i":0,"g":"A","f":null}]');
  });

  it('extracts array from unfenced response with surrounding prose', () => {
    const raw = 'Tentu, ini hasilnya: [{"i":0,"g":"A"},{"i":1,"g":"B"}] — selesai.';
    expect(extractJsonBlock(raw)).toBe('[{"i":0,"g":"A"},{"i":1,"g":"B"}]');
  });

  it('returns null when no JSON present', () => {
    expect(extractJsonBlock('no json here')).toBeNull();
  });

  it('prefers whichever bracket appears first when both are present', () => {
    // Array comes first → extract that array
    const arrFirst = 'prefix [1,2,3] middle {"a":1} end';
    expect(extractJsonBlock(arrFirst)).toBe('[1,2,3]');
    // Object comes first → extract that object
    const objFirst = 'prefix {"a":1} middle [1,2,3] end';
    expect(extractJsonBlock(objFirst)).toBe('{"a":1}');
  });
});
