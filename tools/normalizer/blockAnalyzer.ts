import type Anthropic from '@anthropic-ai/sdk';
import type { HarvestedCell } from '../boqParserV2/types';
import type { BlockSchema } from './types';

const ROWS_BEFORE = 3;
const ROWS_AFTER = 15;

export interface CellContext {
  sheet: string;
  anchorRow: number;
  rows: Array<{ row: number; cells: HarvestedCell[] }>;
}

export function extractBlockCellContext(blockId: string, cells: HarvestedCell[]): CellContext {
  const bangIdx = blockId.indexOf('!');
  if (bangIdx < 0) throw new Error(`extractBlockCellContext: invalid blockId ${blockId}`);
  const sheet = blockId.slice(0, bangIdx);
  const addr = blockId.slice(bangIdx + 1);
  const m = /^[A-Z]+(\d+)$/.exec(addr);
  if (!m) throw new Error(`extractBlockCellContext: invalid blockId ${blockId}`);
  const anchorRow = parseInt(m[1], 10);
  const minRow = anchorRow - ROWS_BEFORE;
  const maxRow = anchorRow + ROWS_AFTER;

  const byRow = new Map<number, HarvestedCell[]>();
  for (const c of cells) {
    if (c.sheet !== sheet) continue;
    if (c.row < minRow || c.row > maxRow) continue;
    const bucket = byRow.get(c.row) ?? [];
    bucket.push(c);
    byRow.set(c.row, bucket);
  }

  const rows = Array.from(byRow.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([row, rowCells]) => ({ row, cells: rowCells }));

  return { sheet, anchorRow, rows };
}

const SYSTEM_PROMPT = `You analyze Indonesian construction "Analisa Harga Satuan" (AHS) blocks from RAB workbooks.
For each block extract its structured breakdown so a downstream parser can apply it to BoQ rows.

Output strict JSON matching this schema (no prose, no markdown):
{
  "blockType": "bekisting" | "pembesian" | "concrete",
  "elementHint": string | null,
  "subItems": [{ "materialName": string, "specNote": string | null, "qtyPerNativeUnit": number, "nativeUnit": string, "unitPrice": number, "includedInRolledUpTotal": boolean }],
  "cycleFactor": number | null,
  "ratioBasis": "per_m2_form_per_cycle" | "per_kg_finished_rebar" | "per_m3_concrete",
  "rolledUpTotalPerNativeUnit": number,
  "confidence": "high" | "medium" | "low",
  "notes": string | null
}

Rules:
- subItems include ALL AHS line items between the block header and its "Jumlah" line, regardless of which cost column (F/G/H/I) carries their cost.
- The "Jumlah" and "Harga per m²/kg/m³" rows are NOT subItems; rolledUpTotalPerNativeUnit equals "Harga per ...".
- includedInRolledUpTotal defaults to true. Mark it false ONLY when the item is explicitly excluded from the block's rolled-up total — for bekisting blocks this is typically the "Perancah" / scaffolding row (sewa, kept on a separate BoQ line). For concrete blocks, labor (Upah cor) and equipment (Sewa peralatan, vibrator, concrete pump) rows ARE part of the rolled-up total even though their cost sits in col G/H instead of F — keep them as true.
- cycleFactor (bekisting only) = Jumlah / "Harga per m²"; round to nearest integer if within ±0.05.
- pembesian: ratioBasis = "per_kg_finished_rebar"; the "Besi beton" qtyPerNativeUnit IS the waste coefficient (typically 1.05).
- concrete: ratioBasis = "per_m3_concrete"; the readymix sub-row qtyPerNativeUnit is the waste-inclusive coefficient (typically 1.05). Concrete blocks ALWAYS include a labor sub-item (Upah cor/borongan) and an equipment sub-item (Sewa peralatan/vibrator/pump) in addition to the readymix — include all of them as subItems.`;

function formatCellsForPrompt(ctx: CellContext): string {
  const lines: string[] = [];
  for (const r of ctx.rows) {
    for (const c of r.cells) {
      const v = c.value == null ? '' : String(c.value);
      lines.push(`${c.sheet}!${c.address} = ${v}${c.formula ? `  (formula: ${c.formula})` : ''}`);
    }
  }
  return lines.join('\n');
}

export async function analyzeBlockWithOpus(
  blockId: string,
  ctx: CellContext,
  client: Anthropic,
): Promise<BlockSchema> {
  const userMsg = `Block reference: ${blockId}\nCells (sheet!cell = value):\n${formatCellsForPrompt(ctx)}\n\nReturn the JSON schema for this block.`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await client.messages.create({
      // Opus 4.7 no longer accepts `temperature` — the model uses its default
      // sampling. The strict-JSON prompt + retry-on-parse-failure handles
      // determinism well enough for structured block extraction.
      model: 'claude-opus-4-7',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: userMsg + (attempt === 1 ? '\n\nReminder: respond with ONLY the JSON object, no prose.' : ''),
      }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const block = resp.content.find((c: any) => c.type === 'text') as any;
    const text = (block?.text ?? '').trim();
    try {
      const parsed = JSON.parse(text);
      return { ...parsed, blockId };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`analyzeBlockWithOpus: failed to parse JSON for ${blockId} after 2 attempts: ${lastErr}`);
}
