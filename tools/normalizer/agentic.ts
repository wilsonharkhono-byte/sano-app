// Agentic normalizer — gives Claude full Analisa context and a self-verifying
// submit_breakdown tool, so each row's breakdown is produced through iterative
// reasoning that must reconcile to the source at-cost total before being
// accepted. Replaces the structured-prompt-per-block approach (analyzeBlockWithOpus),
// which proved fragile when adjacent AHS blocks bled into the cell-context window.
//
// Truth-correctness contract: the agent NEVER returns a breakdown that doesn't
// reconcile within tolerance. Callers must handle the null case (skip the row,
// flag for manual review).
//
// Cost: per workbook ≈ $5 with prompt caching on the Analisa dump. Without
// caching ≈ $30. The Analisa dump is the same for every row, so caching is
// near-free after the first row.

import Anthropic from '@anthropic-ai/sdk';
import type { HarvestedCell } from '../boqParserV2/types';
import type { BoqRowV2 } from '../boqParserV2/extractTakeoffs';
import type { RowBreakdown, BreakdownRow, BreakdownGroup } from '../boqParserV2/breakdownSheetReader.types';

const MODEL = 'claude-opus-4-7';
const MAX_TURNS = 6;       // Hard cap on Claude turns per row.
const TOLERANCE_RP = 1;    // ±1 Rp on computed unit cost vs source.

// ---------------------------------------------------------------------------
// Context formatting

/**
 * Dump every cell of a sheet as compact tabular text, one row per line.
 * Columns A..max are space-padded for readability. Empty cells are shown as
 * "·" so Claude can see the grid structure.
 */
export function dumpSheetAsText(cells: HarvestedCell[], sheetName: string): string {
  const sheetCells = cells.filter((c) => c.sheet === sheetName);
  if (sheetCells.length === 0) return `(sheet ${sheetName} has no cells)`;

  const byRow = new Map<number, Map<string, HarvestedCell>>();
  let maxCol = 0;
  for (const c of sheetCells) {
    const colLetter = c.address.replace(/\d+/g, '');
    const colIdx = colLetterToIdx(colLetter);
    if (colIdx > maxCol) maxCol = colIdx;
    const r = byRow.get(c.row) ?? new Map<string, HarvestedCell>();
    r.set(colLetter, c);
    byRow.set(c.row, r);
  }

  const sortedRows = Array.from(byRow.keys()).sort((a, b) => a - b);
  if (sortedRows.length === 0) return `(sheet ${sheetName} has no rows)`;

  const colLetters: string[] = [];
  for (let i = 0; i <= Math.min(maxCol, 12); i++) colLetters.push(idxToColLetter(i));

  const header = `Row | ${colLetters.join(' | ')}`;
  const lines = [header];
  for (const rowNum of sortedRows) {
    const r = byRow.get(rowNum)!;
    const cells = colLetters.map((col) => {
      const c = r.get(col);
      if (!c || c.value == null || c.value === '') return '·';
      return String(c.value).slice(0, 40).replace(/\s+/g, ' ');
    });
    lines.push(`${String(rowNum).padStart(3)} | ${cells.join(' | ')}`);
  }
  return lines.join('\n');
}

function colLetterToIdx(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function idxToColLetter(idx: number): string {
  let out = '';
  let n = idx + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tool definition

const SUBMIT_BREAKDOWN_TOOL = {
  name: 'submit_breakdown',
  description:
    'Submit a proposed breakdown for the BoQ row. The breakdown lists every material/labor/equipment component with its per-native-unit qty, per-BoQ-unit qty, and unit price. The system will compute sum(qtyPerBoqUnit × unitPrice) and verify it equals the source at-cost unit price within ±1 Rp. If the breakdown does not reconcile, the tool returns the variance and you must revise.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reasoning: {
        type: 'string' as const,
        description:
          'Short explanation of how you derived the breakdown: which AHS blocks you used, what cycle factor / ratios you applied, and which REKAP rows you read for rebar.',
      },
      components: {
        type: 'array' as const,
        description: 'One entry per material/labor/equipment line in the breakdown.',
        items: {
          type: 'object' as const,
          properties: {
            group: {
              type: 'string' as const,
              enum: ['material', 'labor', 'equipment'] as const,
            },
            componentGroup: {
              type: 'string' as const,
              description:
                'Category label, e.g. "BETON READYMIX (Material)", "BEKISTING BALOK (Material) — ratio 10 m²/m³", "PEMBESIAN (Material) — ratio 167.18 kg/m³", "UPAH (Labor) — borongan", "PERALATAN (Equipment)".',
            },
            materialName: { type: 'string' as const },
            specNote: { type: ['string', 'null'] as const },
            qtyPerNativeUnit: { type: 'number' as const },
            nativeUnit: {
              type: 'string' as const,
              description: 'e.g. "lbr", "btg", "kg", "ltr", "m2", "m3"',
            },
            nativeBasis: {
              type: ['string', 'null'] as const,
              description: 'e.g. "per m3 beton (waste 5%)", "per balok (4 m² form)", "per kg besi"',
            },
            unitPrice: { type: 'number' as const, description: 'Rp per native unit.' },
            qtyPerBoqUnit: {
              type: 'number' as const,
              description:
                'qty per BoQ unit (e.g. per m³ beton when the BoQ unit is m3). This is the value that, multiplied by unitPrice, contributes to the at-cost unit price.',
            },
          },
          required: [
            'group',
            'componentGroup',
            'materialName',
            'qtyPerNativeUnit',
            'nativeUnit',
            'unitPrice',
            'qtyPerBoqUnit',
          ],
        },
      },
    },
    required: ['reasoning', 'components'],
  },
};

// ---------------------------------------------------------------------------
// Verification

interface VerifyResult {
  reconciles: boolean;
  computedUnitCost: number;
  unitCostVariance: number;
  perComponentRecompute: Array<{ name: string; declared: number; recomputed: number; delta: number }>;
}

function verifyBreakdown(
  components: SubmittedComponent[],
  sourceUnitCost: number,
): VerifyResult {
  const perComponentRecompute: VerifyResult['perComponentRecompute'] = [];
  let computedUnitCost = 0;
  for (const c of components) {
    const recomputed = c.qtyPerBoqUnit * c.unitPrice;
    perComponentRecompute.push({
      name: c.materialName,
      declared: c.qtyPerBoqUnit * c.unitPrice,
      recomputed,
      delta: 0,
    });
    computedUnitCost += recomputed;
  }
  const unitCostVariance = computedUnitCost - sourceUnitCost;
  return {
    reconciles: Math.abs(unitCostVariance) <= TOLERANCE_RP,
    computedUnitCost,
    unitCostVariance,
    perComponentRecompute,
  };
}

// ---------------------------------------------------------------------------
// Agentic loop

interface SubmittedComponent {
  group: BreakdownGroup;
  componentGroup: string;
  materialName: string;
  specNote?: string | null;
  qtyPerNativeUnit: number;
  nativeUnit: string;
  nativeBasis?: string | null;
  unitPrice: number;
  qtyPerBoqUnit: number;
}

export interface AgenticRunOptions {
  client: Anthropic;
  row: BoqRowV2;
  sourceUnitCost: number;
  sourceLineTotal: number;
  analisaDump: string;             // cacheable across rows
  rekapHint: string | null;        // small per-row snippet (e.g. REKAP Balok row for this element)
  /** Optional override for testing/diagnostics. */
  maxTurns?: number;
}

export interface AgenticRunResult {
  status: 'reconciled' | 'unable_to_reconcile' | 'no_tool_use' | 'error';
  breakdown?: RowBreakdown;
  reason?: string;
  turnsUsed: number;
  computedUnitCost?: number;
  unitCostVariance?: number;
}

const SYSTEM_PROMPT = `You are an Indonesian construction estimator translating an Analisa Harga Satuan (AHS) workbook into a per-material breakdown for one BoQ row.

Your goal: produce a breakdown that **reconciles to the source at-cost unit price within ±1 Rp**. You MUST use the submit_breakdown tool. If the tool reports a variance, revise and re-submit.

Rules for valid breakdowns:
- Every material, labor, and equipment line that contributes to the at-cost unit price must appear as a component. Common groups for structural concrete rows: BETON READYMIX (material), BEKISTING (material — sub-items: Multipleks, Usuk, Paku, Form oil; Perancah is EXCLUDED), PEMBESIAN (material — sub-items: per-diameter Besi beton at raw price, waste at the AHS coefficient, Beton decking, Bendrat), UPAH (labor, borongan), PERALATAN (equipment, e.g. Sewa peralatan/vibrator/pump).
- For bekisting: qty_per_m³ = qty_per_native × (ratio m²/m³ from the BoQ row's V column) / cycle_factor (Jumlah ÷ Harga per m² in the bekisting AHS block, typically 4).
- For pembesian: read per-diameter weights (kg/m³) from REKAP Balok / REKAP Plat / REKAP-PC / Hasil-Kolom. Each diameter is a separate component at the raw "Besi beton" unit price (typically Rp 9,000/kg). Plus three derived components: waste (5% of raw weight), Beton decking (1.0 × raw weight × decking price), Bendrat (2% of raw-with-waste weight × bendrat price).
- For concrete: include readymix (waste-inclusive coefficient ~1.05) AND the same Pengecoran block's Sewa peralatan (equipment, in col H or I) AND its Upah cor (labor, in col G). DO NOT mix sub-items between adjacent Pengecoran blocks — match the block by the BoQ row's chapter/element (e.g. "Balok LT ATAS" vs "Plat LT BAWAH" — read the block title carefully).
- The Analisa sheet may contain multiple similar blocks (multiple Pengecoran Beton blocks for different elements, multiple Bekisting blocks). You must pick the block that matches THIS BoQ row's element type and floor.

If you cannot produce a reconciling breakdown after exhausting your reasoning, respond without calling the tool and explain what's missing or ambiguous.`;

export async function runAgenticBreakdown(opts: AgenticRunOptions): Promise<AgenticRunResult> {
  const maxTurns = opts.maxTurns ?? MAX_TURNS;
  const userIntro = buildUserIntro(opts);

  // Conversation history. The Analisa dump goes inside the first user message
  // with cache_control so subsequent rows in the same workbook can re-use it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `=== Analisa sheet (cacheable) ===\n${opts.analisaDump}`,
          cache_control: { type: 'ephemeral' },
        },
        {
          type: 'text',
          text: userIntro,
        },
      ],
    },
  ];

  let turnsUsed = 0;
  let lastVerify: VerifyResult | null = null;

  while (turnsUsed < maxTurns) {
    turnsUsed++;
    const resp = await opts.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [SUBMIT_BREAKDOWN_TOOL],
      messages,
    });

    // Find the submit_breakdown tool_use, if any.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUse = (resp.content as any[]).find(
      (block) => block.type === 'tool_use' && block.name === 'submit_breakdown',
    );

    if (!toolUse) {
      // Claude responded without using the tool — probably gave up.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textBlock = (resp.content as any[]).find((b) => b.type === 'text');
      return {
        status: 'no_tool_use',
        reason: textBlock?.text ?? 'Claude returned no text and no tool call.',
        turnsUsed,
      };
    }

    const submitted = toolUse.input as { reasoning: string; components: SubmittedComponent[] };
    const verify = verifyBreakdown(submitted.components, opts.sourceUnitCost);
    lastVerify = verify;

    if (verify.reconciles) {
      const breakdown = assembleRowBreakdown(opts, submitted.components, verify);
      return {
        status: 'reconciled',
        breakdown,
        turnsUsed,
        computedUnitCost: verify.computedUnitCost,
        unitCostVariance: verify.unitCostVariance,
      };
    }

    // Reconciliation failed — append the assistant message + a tool_result with
    // the variance, asking Claude to revise.
    messages.push({ role: 'assistant', content: resp.content });
    const feedback = buildVerifyFeedback(verify, opts.sourceUnitCost);
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: feedback,
          is_error: true,
        },
      ],
    });
  }

  return {
    status: 'unable_to_reconcile',
    reason: lastVerify
      ? `After ${maxTurns} turns, last breakdown variance was ${lastVerify.unitCostVariance.toFixed(2)} Rp.`
      : `Exhausted ${maxTurns} turns without a submitted breakdown.`,
    turnsUsed,
    computedUnitCost: lastVerify?.computedUnitCost,
    unitCostVariance: lastVerify?.unitCostVariance,
  };
}

function buildUserIntro(opts: AgenticRunOptions): string {
  const lines: string[] = [];
  lines.push(`=== BoQ row to break down ===`);
  lines.push(`Code: ${opts.row.code}`);
  lines.push(`Label: ${opts.row.label}`);
  lines.push(`Unit: ${opts.row.unit}`);
  lines.push(`Volume: ${opts.row.planned}`);
  lines.push(`Chapter: ${opts.row.chapter ?? '(none)'}`);
  lines.push(`Sub-chapter: ${opts.row.sub_chapter ?? '(none)'}`);
  lines.push(``);
  lines.push(`=== Reconciliation targets ===`);
  lines.push(`Source at-cost unit price (Rp/${opts.row.unit}): ${opts.sourceUnitCost}`);
  lines.push(`Source at-cost line total (Rp): ${opts.sourceLineTotal}`);
  lines.push(`Tolerance: ±${TOLERANCE_RP} Rp on unit cost.`);
  lines.push(``);
  if (opts.rekapHint) {
    lines.push(`=== REKAP rebar weights for this element ===`);
    lines.push(opts.rekapHint);
    lines.push(``);
  }
  lines.push(
    `Use the submit_breakdown tool. Pick the Analisa AHS blocks that match this row's element and floor (e.g. "Balok LT ATAS" for IV.A.*, "Plat LT BAWAH" for V.A.*, etc.) — adjacent blocks differ in Upah / Sewa / coefficients.`,
  );
  return lines.join('\n');
}

function buildVerifyFeedback(verify: VerifyResult, sourceUnitCost: number): string {
  const lines: string[] = [];
  lines.push(`Your submitted breakdown does NOT reconcile.`);
  lines.push(`  Computed unit cost: Rp ${Math.round(verify.computedUnitCost)}`);
  lines.push(`  Source unit cost:   Rp ${Math.round(sourceUnitCost)}`);
  lines.push(`  Variance:           Rp ${verify.unitCostVariance > 0 ? '+' : ''}${verify.unitCostVariance.toFixed(2)}`);
  lines.push(``);
  if (Math.abs(verify.unitCostVariance) > 100000) {
    lines.push(
      `That's a large variance — likely a missing or duplicated component group. Common causes: missing UPAH, missing PERALATAN, missing BEKISTING, or you picked the wrong Pengecoran block for this element/floor.`,
    );
  } else if (Math.abs(verify.unitCostVariance) > 1000) {
    lines.push(
      `Medium variance — likely a wrong qty or unit price on one component. Check the bekisting cycle factor (Jumlah/Harga per m²) and per-diameter rebar weights.`,
    );
  } else {
    lines.push(`Small variance — likely a rounding or one wrong unit price. Re-check each cost-per-unit.`);
  }
  lines.push(``);
  lines.push(`Revise and call submit_breakdown again.`);
  return lines.join('\n');
}

function assembleRowBreakdown(
  opts: AgenticRunOptions,
  components: SubmittedComponent[],
  verify: VerifyResult,
): RowBreakdown {
  const volume = opts.row.planned;
  const breakdownRows: BreakdownRow[] = components.map((c) => {
    const costPerBoqUnit = Math.round(c.qtyPerBoqUnit * c.unitPrice);
    const totalQty = round6(c.qtyPerBoqUnit * volume);
    const totalCost = Math.round(totalQty * c.unitPrice);
    return {
      group: c.group,
      componentGroup: c.componentGroup,
      materialName: c.materialName,
      specNote: c.specNote ?? null,
      qtyPerNativeUnit: c.qtyPerNativeUnit,
      nativeUnit: c.nativeUnit,
      nativeBasis: c.nativeBasis ?? null,
      unitPrice: c.unitPrice,
      qtyPerBoqUnit: c.qtyPerBoqUnit,
      costPerBoqUnit,
      totalQty,
      totalCost,
    };
  });

  const computedLineTotal = Math.round(verify.computedUnitCost * volume);
  return {
    boqCode: opts.row.code,
    description: opts.row.label,
    unit: opts.row.unit,
    volume,
    unitCost: verify.computedUnitCost,
    lineTotal: computedLineTotal,
    components: breakdownRows,
    reconciliation: {
      computedUnitCost: verify.computedUnitCost,
      sourceUnitCost: opts.sourceUnitCost,
      unitCostVariance: verify.unitCostVariance,
      computedLineTotal,
      sourceLineTotal: opts.sourceLineTotal,
      lineTotalVariance: computedLineTotal - opts.sourceLineTotal,
      reconciles: true, // we only assemble when verify.reconciles === true
    },
    sourceSheet: `Breakdown ${opts.row.code}`,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
