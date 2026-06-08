import { sourceLocation, sourceContext } from '../sourceProvenance';
import type { ImportStagingRow } from '../types';

function row(partial: Partial<ImportStagingRow>): ImportStagingRow {
  return {
    id: 'id', session_id: 's', row_number: 1, row_type: 'ahs',
    raw_data: {}, parsed_data: {}, confidence: 1, needs_review: false,
    review_status: 'PENDING', reviewer_notes: null, created_at: '',
    ...partial,
  } as ImportStagingRow;
}

describe('sourceLocation', () => {
  it('formats sheet!cell when both present', () => {
    const r = row({ raw_data: { source_sheet: 'Analisa', source_cell: 'D412' } });
    expect(sourceLocation(r)).toBe('Analisa!D412');
  });
  it('falls back to row-level when cell is missing', () => {
    const r = row({ raw_data: { source_sheet: 'Material', source_row: 7 } });
    expect(sourceLocation(r)).toBe('Material · baris 7');
  });
  it('shows "sumber tidak tercatat" when nothing is recorded', () => {
    expect(sourceLocation(row({ raw_data: {} }))).toBe('sumber tidak tercatat');
  });
});

describe('sourceContext', () => {
  const block = row({
    row_type: 'ahs_block',
    raw_data: { source_sheet: 'Analisa', titleRow: 10, jumlahRow: 15 },
    parsed_data: { title: 'PEKERJAAN PAGAR SENG T. 3m', is_orphan: true, linked_boq_code: null },
  });

  it('links an AHS component to its parent block by row range (orphan)', () => {
    const comp = row({ row_type: 'ahs', raw_data: { source_sheet: 'Analisa', source_row: 12 } });
    expect(sourceContext(comp, [block, comp])).toBe(
      'Komponen AHS: "PEKERJAAN PAGAR SENG T. 3m" · ⚠ tidak dipakai BoQ manapun',
    );
  });

  it('shows linked BoQ for a non-orphan block', () => {
    const linked = row({
      row_type: 'ahs_block',
      raw_data: { source_sheet: 'Analisa', titleRow: 20, jumlahRow: 25 },
      parsed_data: { title: 'Bekisting Balok', is_orphan: false, linked_boq_code: 'IV.A.2.7' },
    });
    expect(sourceContext(linked, [linked])).toBe('Dipakai BoQ IV.A.2.7');
  });

  it('reports when no containing block is found', () => {
    const orphanComp = row({ row_type: 'ahs', raw_data: { source_sheet: 'Analisa', source_row: 999 } });
    expect(sourceContext(orphanComp, [block, orphanComp])).toBe('Komponen AHS (blok induk tidak ditemukan)');
  });

  it('shows chapter › code for a BoQ row', () => {
    const boq = row({ row_type: 'boq', raw_data: { chapter: 'III.A.1' }, parsed_data: { code: 'III.A.1.2' } });
    expect(sourceContext(boq, [boq])).toBe('III.A.1 › III.A.1.2');
  });

  it('labels a material row as catalog', () => {
    const material = row({ row_type: 'material', raw_data: { source_sheet: 'Material', source_cell: 'B2' } });
    expect(sourceContext(material, [material])).toBe('Katalog material');
  });
});
