// tools/analytics/workType.ts
// SANO — the kind of work a daily-report line is about, for the analytics
// only. A confirmed link's stage is trusted; without one the text is matched
// by keyword and the result is labelled "perkiraan kata kunci" wherever it
// shows. Keyword results never feed the claim board. Pure.
export const WORK_TYPES = ['GALIAN', 'BEKISTING', 'PEMBESIAN', 'PENGECORAN', 'PASANGAN', 'MEP', 'LAINNYA'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  GALIAN: 'Galian', BEKISTING: 'Bekisting', PEMBESIAN: 'Pembesian', PENGECORAN: 'Pengecoran', PASANGAN: 'Pasangan', MEP: 'MEP / saluran', LAINNYA: 'Lainnya',
};

const LINKED: Record<string, WorkType> = {
  GALIAN: 'GALIAN', BEKISTING: 'BEKISTING', BONGKAR_BEKISTING: 'BEKISTING', PEMBESIAN: 'PEMBESIAN', STEK: 'PEMBESIAN',
  PENGECORAN: 'PENGECORAN', LANTAI_KERJA: 'PENGECORAN',
};

// First match wins; the order puts the more specific words first.
const KEYWORDS: ReadonlyArray<[WorkType, RegExp]> = [
  ['PASANGAN', /batako|bata\b|pasangan|plester|acian/i],
  ['MEP', /pipa|saluran|instalasi|anti rayap|listrik|plumbing/i],
  ['PENGECORAN', /\bcor\b|pengecoran|readymix|ready mix|lantai kerja/i],
  ['BEKISTING', /bekisting|begisting|perancah|scaffold/i],
  ['PEMBESIAN', /besi|penulangan|pembesian|tulangan|begel|sengkang/i],
  ['GALIAN', /galian|gali\b|urug|pemadatan|timbun/i],
];

export function workTypeOfLine(linkedStage: string | null | undefined, text: string): { type: WorkType; source: 'link' | 'keyword' } {
  if (linkedStage) return { type: LINKED[linkedStage] ?? 'LAINNYA', source: 'link' };
  for (const [type, re] of KEYWORDS) if (re.test(text)) return { type, source: 'keyword' };
  return { type: 'LAINNYA', source: 'keyword' };
}
