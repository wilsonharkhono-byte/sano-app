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
- subItems include ONLY the AHS line items between the block header and its "Jumlah" line.
- The "Jumlah" and "Harga per m²/kg/m³" rows are NOT subItems; rolledUpTotalPerNativeUnit equals "Harga per ...".
- Items visually separated or with no F-column value (e.g. Perancah) get includedInRolledUpTotal: false.
- cycleFactor (bekisting only) = Jumlah / "Harga per m²"; round to nearest integer if within ±0.05.
- pembesian: ratioBasis = "per_kg_finished_rebar"; the "Besi beton" qtyPerNativeUnit IS the waste coefficient (typically 1.05).
- concrete: the readymix sub-row qtyPerNativeUnit is the waste-inclusive coefficient (typically 1.05).`;

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
      model: 'claude-opus-4-7',
      max_tokens: 800,
      temperature: 0,
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
