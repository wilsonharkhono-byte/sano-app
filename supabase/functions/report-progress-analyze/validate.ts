// tools/reportLineDraftValidate.ts
// SANO — Report-line link validator (pure). SOURCE OF TRUTH.
//
// supabase/functions/report-progress-analyze/validate.ts is a byte-identical
// copy of this file: Deno cannot import from tools/ and jest never runs
// supabase/functions/. tools/__tests__/reportProgressTwins.test.ts fails on
// drift. Fix drift with:
//   cp tools/reportLineDraftValidate.ts supabase/functions/report-progress-analyze/validate.ts
//
// No imports: the app and the edge function load this file unchanged.
//
// What it guards (spec §4, §8): the model's answer to "which work-area row and
// which stage does each line of an issued client report describe". Every quote
// must be a literal substring of the line it explains; an unknown row code
// becomes null with low confidence; unknown keys are dropped; nothing here
// ever invents a link, a quantity or a percent.

export const REPORT_LINE_STAGES = [
  'GALIAN', 'LANTAI_KERJA', 'MARKING', 'STEK', 'BEKISTING', 'PEMBESIAN',
  'PENGECORAN', 'BONGKAR_BEKISTING', 'CURING', 'PERSIAPAN', 'LAINNYA',
] as const;
export type ReportLineStage = (typeof REPORT_LINE_STAGES)[number];

/** The stages that carry BoQ value (spec §4); every other stage is evidence-only. */
export const WEIGHT_BEARING_STAGES = ['BEKISTING', 'PEMBESIAN', 'PENGECORAN'] as const;
export type WeightBearingStage = (typeof WEIGHT_BEARING_STAGES)[number];

export const ACTIVITY_STATES = ['MULAI', 'LANJUT', 'SELESAI'] as const;
export type ActivityState = (typeof ACTIVITY_STATES)[number];

export const LINK_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type LinkConfidence = (typeof LINK_CONFIDENCE_LEVELS)[number];

export const LINK_TOOL_NAME = 'submit_report_line_links';
/** Shorter than this and a "quote" like "cor" is a substring of almost anything. */
export const LINK_QUOTE_MIN_CHARS = 4;
export const LINK_QUOTE_MAX_CHARS = 200;

export function isWeightBearingStage(stage: string | null | undefined): stage is WeightBearingStage {
  return (WEIGHT_BEARING_STAGES as readonly string[]).includes(stage ?? '');
}

export interface ReportLineLink {
  line_index: number;
  boq_item_code: string | null;
  stage: ReportLineStage | null;
  activity_state: ActivityState;
  confidence: LinkConfidence;
  quote: string | null;
}

export interface LinkDrop {
  line_index: number | null;
  field: string;
  reason: string;
  /** The offending value, truncated, when it helps a human see what was dropped. */
  value?: string;
}

export interface LinkValidationContext {
  /** One entry per snapshot.updates[] line: `${area} :: ${note}`. */
  lines: Array<{ index: number; text: string }>;
  /** Live boq_items.code values shown to the model. */
  boqCodes: string[];
}

export type LinkValidationResult =
  | { ok: true; links: ReportLineLink[]; dropped: LinkDrop[] }
  | { ok: false; reason: string };

export function normalizeForQuoteMatch(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u200B-\u200D\u00AD\u2060\u200E\u200F]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isLiteralQuote(quote: string, source: string): boolean {
  const q = normalizeForQuoteMatch(quote);
  if (Array.from(q).length < LINK_QUOTE_MIN_CHARS) return false;
  return normalizeForQuoteMatch(source).includes(q);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function preview(value: unknown): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  return Array.from(text).slice(0, 60).join('');
}

/** Exactly one case-insensitive match resolves; a case-only tie is refused, never guessed. */
function resolveCode(candidate: string, codes: string[]): string | null {
  const wanted = candidate.trim().toLowerCase();
  const matches = codes.filter((code) => code.toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : null;
}

function inList(list: readonly string[], value: unknown): value is string {
  return typeof value === 'string' && list.includes(value);
}

export function validateReportLineLinks(raw: unknown, ctx: LinkValidationContext): LinkValidationResult {
  if (!isRecord(raw) || !Array.isArray(raw.links)) {
    return { ok: false, reason: 'jawaban model tidak berisi daftar links' };
  }
  const dropped: LinkDrop[] = [];
  const byIndex = new Map<number, ReportLineLink>();

  for (const item of raw.links) {
    if (!isRecord(item)) {
      dropped.push({ line_index: null, field: 'links[]', reason: 'bukan objek', value: preview(item) });
      continue;
    }
    const idx = typeof item.line_index === 'number' && Number.isInteger(item.line_index) ? item.line_index : null;
    const line = idx === null ? undefined : ctx.lines.find((l) => l.index === idx);
    if (idx === null || !line) {
      dropped.push({ line_index: idx, field: 'line_index', reason: 'tidak ada baris dengan indeks ini', value: preview(item.line_index) });
      continue;
    }
    if (byIndex.has(idx)) {
      dropped.push({ line_index: idx, field: 'line_index', reason: 'indeks ganda, yang pertama dipakai' });
      continue;
    }

    let confidence: LinkConfidence;
    if (inList(LINK_CONFIDENCE_LEVELS, item.confidence)) {
      confidence = item.confidence as LinkConfidence;
    } else {
      confidence = 'low';
      dropped.push({ line_index: idx, field: 'confidence', reason: 'nilai tidak dikenal, dianggap low', value: preview(item.confidence) });
    }

    let code: string | null = null;
    if (typeof item.boq_item_code === 'string' && item.boq_item_code.trim()) {
      code = resolveCode(item.boq_item_code, ctx.boqCodes);
      if (!code) {
        dropped.push({ line_index: idx, field: 'boq_item_code', reason: 'kode tidak ada di daftar baris BoQ', value: preview(item.boq_item_code) });
      }
    } else if (item.boq_item_code !== null && item.boq_item_code !== undefined) {
      dropped.push({ line_index: idx, field: 'boq_item_code', reason: 'bukan string', value: preview(item.boq_item_code) });
    }
    // Rule: no row, no confidence. A confident "unlinked" line would hide from
    // the supervisor exactly the lines that most need a human decision.
    if (code === null && confidence !== 'low') {
      dropped.push({ line_index: idx, field: 'confidence', reason: 'tanpa baris BoQ, keyakinan diturunkan ke low' });
      confidence = 'low';
    }

    let stage: ReportLineStage | null = null;
    if (inList(REPORT_LINE_STAGES, item.stage)) {
      stage = item.stage as ReportLineStage;
    } else if (item.stage !== null && item.stage !== undefined) {
      dropped.push({ line_index: idx, field: 'stage', reason: 'tahap tidak dikenal, dianggap null', value: preview(item.stage) });
    }

    let state: ActivityState = 'LANJUT';
    if (inList(ACTIVITY_STATES, item.activity_state)) {
      state = item.activity_state as ActivityState;
    } else {
      dropped.push({ line_index: idx, field: 'activity_state', reason: 'status tidak dikenal, dianggap LANJUT', value: preview(item.activity_state) });
    }

    let quote: string | null = null;
    if (typeof item.quote === 'string' && item.quote.trim()) {
      const trimmed = Array.from(item.quote.replace(/\s+/g, ' ').trim()).slice(0, LINK_QUOTE_MAX_CHARS).join('');
      if (isLiteralQuote(trimmed, line.text)) quote = trimmed;
      else dropped.push({ line_index: idx, field: 'quote', reason: 'kutipan tidak persis ada di baris', value: preview(item.quote) });
    }
    if (code !== null && quote === null && confidence === 'high') {
      confidence = 'medium';
      dropped.push({ line_index: idx, field: 'confidence', reason: 'tautan tanpa kutipan, keyakinan diturunkan ke medium' });
    }

    byIndex.set(idx, { line_index: idx, boq_item_code: code, stage, activity_state: state, confidence, quote });
  }

  const links: ReportLineLink[] = ctx.lines.map((l) => {
    const found = byIndex.get(l.index);
    if (found) return found;
    dropped.push({ line_index: l.index, field: 'links[]', reason: 'baris tidak dijawab model, dianggap tidak terkait' });
    return { line_index: l.index, boq_item_code: null, stage: null, activity_state: 'LANJUT', confidence: 'low', quote: null };
  });

  return { ok: true, links, dropped };
}
