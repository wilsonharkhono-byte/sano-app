import type { ImportStagingRow } from './types';

type Raw = Record<string, unknown>;

function raw(row: ImportStagingRow): Raw {
  return (row.raw_data ?? {}) as Raw;
}
function parsed(row: ImportStagingRow): Raw {
  return (row.parsed_data ?? {}) as Raw;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

/**
 * Display string for where a staging row came from in the source workbook.
 * Prefers an exact cell (`Analisa!D412`); falls back to row-level
 * (`Material · baris 7`) only when the precise column is unknown; never
 * fabricates a cell — returns `sumber tidak tercatat` when nothing is recorded.
 */
export function sourceLocation(row: ImportStagingRow): string {
  const r = raw(row);
  const sheet = str(r.source_sheet);
  const cell = str(r.source_cell);
  const rowNum = num(r.source_row);
  if (sheet && cell) return `${sheet}!${cell}`;
  if (sheet && rowNum != null) return `${sheet} · baris ${rowNum}`;
  return 'sumber tidak tercatat';
}

function findContainingBlock(
  allRows: ImportStagingRow[],
  sheet: string | null,
  srow: number | null,
): ImportStagingRow | null {
  if (srow == null) return null;
  for (const r of allRows) {
    if (r.row_type !== 'ahs_block') continue;
    const rd = raw(r);
    const bSheet = str(rd.source_sheet);
    if (sheet && bSheet && bSheet !== sheet) continue;
    const t = num(rd.titleRow);
    const j = num(rd.jumlahRow);
    if (t != null && j != null && srow >= t && srow <= j) return r;
  }
  return null;
}

function blockUsage(blockParsed: Raw): string | null {
  if (blockParsed.is_orphan) return '⚠ tidak dipakai BoQ manapun';
  const code = str(blockParsed.linked_boq_code);
  return code ? `Dipakai BoQ ${code}` : null;
}

/**
 * Secondary "role / chain" line for a card. Returns null when there is no
 * useful context to show (caller omits the line).
 */
export function sourceContext(
  row: ImportStagingRow,
  allRows: ImportStagingRow[],
): string | null {
  const r = raw(row);
  const p = parsed(row);
  switch (row.row_type) {
    case 'ahs': {
      const parent = findContainingBlock(allRows, str(r.source_sheet), num(r.source_row));
      if (!parent) return 'Komponen AHS (blok induk tidak ditemukan)';
      const title = str(parsed(parent).title) ?? '(tanpa judul)';
      const usage = blockUsage(parsed(parent));
      return `Komponen AHS: "${title}"${usage ? ` · ${usage}` : ''}`;
    }
    case 'ahs_block':
      return blockUsage(p);
    case 'boq': {
      const chapter = str(r.chapter);
      const code = str(p.code);
      if (chapter && code) return `${chapter} › ${code}`;
      return code ?? chapter ?? null;
    }
    case 'material':
      return 'Katalog material';
    default:
      return null;
  }
}
