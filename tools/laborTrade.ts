/**
 * SANO — Labor Trade Category Auto-Detection
 *
 * Assigns trade_category to AHS labor lines based on description keywords
 * and AHS block title context. Runs post-baseline-publish.
 *
 * Rules:
 *  1. Explicit keyword match on description → high confidence
 *  2. Context (AHS block title) breaks ties (e.g. "tukang kayu" in a
 *     concrete block → beton_bekisting, not kayu)
 *  3. Unmatched lines → 'lainnya'
 *
 * Returns a summary list for estimator review (confirmed = false until
 * the estimator taps "Confirm" in MandorSetupScreen).
 */

import { supabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export type TradeCategory =
  | 'beton_bekisting'
  | 'besi'
  | 'pasangan'
  | 'plesteran'
  | 'finishing'
  | 'kayu'
  | 'mep'
  | 'tanah'
  | 'lainnya';

export interface TradeDetectionResult {
  ahs_line_id: string;
  boq_item_id: string;
  boq_label: string;
  description: string;
  ahs_block_title: string | null;
  detected_category: TradeCategory;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface TradeSummaryGroup {
  category: TradeCategory;
  label: string;
  line_count: number;
  boq_items: string[];
  lines: TradeDetectionResult[];
}

// ─── Keyword maps ────────────────────────────────────────────────────────────

/**
 * Primary keywords — matched against the labor line description (lowercase).
 * Order matters: first match wins within a tier.
 */
const PRIMARY_KEYWORDS: Array<{ patterns: string[]; category: TradeCategory; confidence: 'high' | 'medium' | 'low' }> = [
  // ── Besi (rebar — always separate mandor) ───────────────────────────────
  {
    patterns: ['tukang besi', 'pembesian', 'besi beton', 'besi ulir', 'besi polos', 'wiremesh', 'wire mesh', 'anyam besi', 'pasang besi'],
    category: 'besi',
    confidence: 'high',
  },
  // ── MEP ─────────────────────────────────────────────────────────────────
  {
    patterns: ['instalasi listrik', 'tukang listrik', 'elektrikal', 'instalasi air', 'tukang pipa', 'plumbing', 'sanitasi', 'instalasi ac', 'exhaust fan', 'fire alarm', 'panel listrik'],
    category: 'mep',
    confidence: 'high',
  },
  // ── Tanah ────────────────────────────────────────────────────────────────
  {
    patterns: ['tukang gali', 'galian tanah', 'urugan tanah', 'pemadatan', 'timbunan', 'operator excavator', 'operator alat berat', 'alat berat', 'bulldozer'],
    category: 'tanah',
    confidence: 'high',
  },
  // ── Finishing ────────────────────────────────────────────────────────────
  {
    patterns: ['tukang cat', 'pengecatan', 'cat dinding', 'cat plafon', 'tukang keramik', 'pasang keramik', 'granit', 'marmer', 'gypsum', 'tukang gypsum', 'plafon', 'tukang finishing'],
    category: 'finishing',
    confidence: 'high',
  },
  // ── Kayu (carpentry — NOT bekisting) ────────────────────────────────────
  {
    patterns: ['kusen', 'daun pintu', 'daun jendela', 'rangka atap', 'kuda-kuda', 'lisplank', 'tukang atap', 'genteng', 'rabung', 'pemasangan atap'],
    category: 'kayu',
    confidence: 'high',
  },
  // ── Plesteran ───────────────────────────────────────────────────────────
  {
    patterns: ['tukang plester', 'plesteran', 'tukang aci', 'acian', 'aci dinding', 'waterproofing dinding'],
    category: 'plesteran',
    confidence: 'high',
  },
  // ── Pasangan ────────────────────────────────────────────────────────────
  {
    patterns: ['tukang bata', 'pasangan bata', 'pasangan batu', 'batu kali', 'tukang pasang bata', 'tukang tembok', 'hebel', 'bata ringan'],
    category: 'pasangan',
    confidence: 'high',
  },
  // ── Beton/Bekisting (broad — medium confidence, need context check) ──────
  {
    patterns: ['tukang beton', 'tukang cor', 'cor beton', 'bekisting', 'cetakan beton', 'papan bekisting', 'multiplek bekisting'],
    category: 'beton_bekisting',
    confidence: 'high',
  },
  // ── Generic labor — low confidence, resolved by context ─────────────────
  {
    patterns: ['tukang kayu'],      // could be bekisting OR kusen
    category: 'beton_bekisting',   // default; overridden by context below
    confidence: 'medium',
  },
  {
    patterns: ['pekerja', 'tenaga', 'buruh', 'mandor', 'kepala tukang'],
    category: 'beton_bekisting',   // default; overridden by context
    confidence: 'low',
  },
];

/**
 * Block title context patterns — applied when description match is low/medium confidence.
 * If the AHS block title matches one of these, override the detected category.
 */
const CONTEXT_OVERRIDES: Array<{ patterns: string[]; category: TradeCategory }> = [
  { patterns: ['beton', 'kolom', 'balok', 'plat', 'sloof', 'poer', 'pile cap', 'pondasi', 'tangga', 'cor', 'basement'], category: 'beton_bekisting' },
  { patterns: ['pasangan bata', 'dinding bata', 'bata merah', 'bata ringan', 'hebel', 'pasangan batu'], category: 'pasangan' },
  { patterns: ['plesteran', 'acian', 'aci'], category: 'plesteran' },
  { patterns: ['pembesian', 'besi', 'rebar'], category: 'besi' },
  { patterns: ['pengecatan', 'cat ', 'keramik', 'granit', 'gypsum', 'plafon', 'finishing'], category: 'finishing' },
  { patterns: ['kusen', 'pintu', 'jendela', 'kuda-kuda', 'rangka atap', 'atap', 'genteng'], category: 'kayu' },
  { patterns: ['instalasi', 'listrik', 'pipa', 'sanitasi', 'plumbing', 'mep'], category: 'mep' },
  { patterns: ['galian', 'urugan', 'tanah', 'pemadatan', 'timbunan'], category: 'tanah' },
];

// ─── Category display labels ──────────────────────────────────────────────

export const TRADE_LABELS: Record<TradeCategory, string> = {
  beton_bekisting: 'Beton & Bekisting',
  besi:            'Pembesian (Besi)',
  pasangan:        'Pasangan Bata/Batu',
  plesteran:       'Plesteran & Acian',
  finishing:       'Finishing',
  kayu:            'Pekerjaan Kayu',
  mep:             'MEP (Listrik/Air/AC)',
  tanah:           'Pekerjaan Tanah',
  lainnya:         'Lainnya',
};

// ─── Core detection logic ─────────────────────────────────────────────────

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[()@\-\/\\'"]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectTradeCategory(
  description: string,
  blockTitle: string | null,
): { category: TradeCategory; confidence: 'high' | 'medium' | 'low'; reason: string } {
  const normDesc = normalizeText(description);
  const normBlock = blockTitle ? normalizeText(blockTitle) : '';

  // Step 1: Try primary keyword match on description
  for (const rule of PRIMARY_KEYWORDS) {
    const matched = rule.patterns.find(p => normDesc.includes(p));
    if (matched) {
      // Step 2: If confidence is medium/low, check block title context for override
      if (rule.confidence !== 'high' && normBlock) {
        for (const ctx of CONTEXT_OVERRIDES) {
          const ctxMatch = ctx.patterns.find(p => normBlock.includes(p));
          if (ctxMatch) {
            return {
              category: ctx.category,
              confidence: 'medium',
              reason: `Keyword "${matched}" → context block "${ctxMatch}" → ${ctx.category}`,
            };
          }
        }
      }
      return {
        category: rule.category,
        confidence: rule.confidence,
        reason: `Keyword match: "${matched}"`,
      };
    }
  }

  // Step 3: No description match — try block title alone
  if (normBlock) {
    for (const ctx of CONTEXT_OVERRIDES) {
      const ctxMatch = ctx.patterns.find(p => normBlock.includes(p));
      if (ctxMatch) {
        return {
          category: ctx.category,
          confidence: 'low',
          reason: `Block title context: "${ctxMatch}"`,
        };
      }
    }
  }

  return { category: 'lainnya', confidence: 'low', reason: 'Tidak ada keyword yang cocok' };
}

// ─── Database operations ─────────────────────────────────────────────────

/**
 * Run auto-detection on all unconfirmed labor lines for a project.
 * Writes trade_category to ahs_lines. Returns summary for estimator review.
 */
export async function detectAndTagLaborTrades(
  projectId: string,
): Promise<{ results: TradeDetectionResult[]; summary: TradeSummaryGroup[]; error?: string }> {
  // Fetch all labor lines for this project (via boq_items → project_id)
  const { data: lines, error } = await supabase
    .from('ahs_lines')
    .select(`
      id,
      boq_item_id,
      description,
      ahs_block_title,
      trade_category,
      trade_confirmed,
      boq_items!inner(id, label, project_id)
    `)
    .eq('line_type', 'labor')
    .eq('boq_items.project_id', projectId)
    .eq('trade_confirmed', false);

  if (error) return { results: [], summary: [], error: error.message };
  if (!lines?.length) return { results: [], summary: [] };

  const results: TradeDetectionResult[] = [];
  const updates: Array<{ id: string; trade_category: TradeCategory }> = [];

  for (const line of lines) {
    const boqItem = Array.isArray(line.boq_items) ? line.boq_items[0] : line.boq_items;
    const { category, confidence, reason } = detectTradeCategory(
      line.description ?? '',
      line.ahs_block_title ?? null,
    );

    results.push({
      ahs_line_id: line.id,
      boq_item_id: line.boq_item_id,
      boq_label: boqItem?.label ?? '',
      description: line.description ?? '',
      ahs_block_title: line.ahs_block_title ?? null,
      detected_category: category,
      confidence,
      reason,
    });

    updates.push({ id: line.id, trade_category: category });
  }

  // Batch-update ahs_lines with one RPC round-trip instead of N sequential updates.
  const { error: tagError } = await supabase.rpc('apply_detected_trade_categories', {
    p_updates: updates,
  });

  if (tagError) return { results: [], summary: [], error: tagError.message };

  // Build summary grouped by category
  const grouped = new Map<TradeCategory, TradeDetectionResult[]>();
  for (const r of results) {
    if (!grouped.has(r.detected_category)) grouped.set(r.detected_category, []);
    grouped.get(r.detected_category)!.push(r);
  }

  const summary: TradeSummaryGroup[] = Array.from(grouped.entries()).map(([cat, catLines]) => ({
    category: cat,
    label: TRADE_LABELS[cat],
    line_count: catLines.length,
    boq_items: Array.from(new Set(catLines.map(l => l.boq_label))),
    lines: catLines,
  }));

  // Sort: beton_bekisting first, lainnya last
  const ORDER: TradeCategory[] = ['beton_bekisting', 'besi', 'pasangan', 'plesteran', 'finishing', 'kayu', 'mep', 'tanah', 'lainnya'];
  summary.sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));

  return { results, summary };
}

/**
 * Confirm a trade category assignment (estimator has reviewed and agreed).
 */
export async function confirmTradeCategory(
  ahsLineId: string,
  category: TradeCategory,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('ahs_lines')
    .update({ trade_category: category, trade_confirmed: true })
    .eq('id', ahsLineId);
  return { error: error?.message };
}

/**
 * Bulk-confirm all lines of a given category for a project.
 * Estimator reviews summary and taps "Confirm All" per trade group.
 */
export async function confirmTradeCategoryBulk(
  projectId: string,
  category: TradeCategory,
): Promise<{ updated: number; error?: string }> {
  const { data, error } = await supabase
    .from('ahs_lines')
    .update({ trade_confirmed: true })
    .eq('trade_category', category)
    .eq('trade_confirmed', false)
    .select('id');

  return { updated: data?.length ?? 0, error: error?.message };
}

/**
 * Compute boq_labor_rate for a BoQ item + trade category combination.
 * Used when setting up mandor_contract_rates.
 * Returns Rp per unit of the BoQ item.
 */
export async function getBoqLaborRate(
  boqItemId: string,
  tradeCategory: TradeCategory,
): Promise<{ rate: number; hok: number; error?: string }> {
  const { data, error } = await supabase
    .from('ahs_lines')
    .select('coefficient, unit_price')
    .eq('boq_item_id', boqItemId)
    .eq('line_type', 'labor')
    .eq('trade_category', tradeCategory);

  if (error) return { rate: 0, hok: 0, error: error.message };

  const rate = (data ?? []).reduce((sum, l) => sum + (l.coefficient ?? 0) * (l.unit_price ?? 0), 0);
  const hok  = (data ?? []).reduce((sum, l) => sum + (l.coefficient ?? 0), 0);
  return { rate, hok };
}
