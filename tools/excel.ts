// SANO — Excel Export Utility
// Generates well-formatted .xlsx workbooks from ReportPayload objects.
// On web: triggers a browser file download.
// On native: writes to a temp file and opens the system share dialog.

import { Platform } from 'react-native';
import * as XLSX from 'xlsx';
import { encode } from 'base64-arraybuffer';
import type { ReportPayload } from './reports';

// ── helpers ─────────────────────────────────────────────────────────

type LinkCell = { label: string; url?: string | null };
type SheetCell = string | number | LinkCell;
type SheetRow = SheetCell[];

function fmtRp(n: number) {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function colWidths(rows: string[][]): XLSX.ColInfo[] {
  if (!rows.length) return [];
  const widths = rows[0].map((_, ci) =>
    rows.reduce((max, row) => Math.max(max, String(row[ci] ?? '').length), 10)
  );
  return widths.map(w => ({ wch: Math.min(w + 2, 60) }));
}

function addMetaSheet(wb: XLSX.WorkBook, payload: ReportPayload, projectName?: string) {
  const metaRows = [
    ['Laporan', payload.title],
    ['Proyek', projectName ?? payload.project_id],
    ['Dibuat', new Date(payload.generated_at).toLocaleString('id-ID')],
    ['Tipe Laporan', payload.type],
  ];
  const ws = XLSX.utils.aoa_to_sheet(metaRows);
  ws['!cols'] = [{ wch: 18 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Info');
}

function applyHeaderStyle(ws: XLSX.WorkSheet, headerRow: number, cols: number) {
  for (let c = 0; c < cols; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRow, c });
    if (!ws[addr]) continue;
    ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'D9E1F2' } } };
  }
}

function displayCellValue(cell: SheetCell): string {
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'string') return cell;
  return cell.label;
}

function appendSheet(wb: XLSX.WorkBook, name: string, header: string[], rows: SheetRow[]) {
  const displayRows = rows.map(row => row.map(displayCellValue));
  const ws = XLSX.utils.aoa_to_sheet([header, ...displayRows]);
  ws['!cols'] = colWidths([header, ...displayRows]);
  applyHeaderStyle(ws, 0, header.length);

  rows.forEach((row, rowIndex) => {
    row.forEach((cell, cellIndex) => {
      if (typeof cell === 'string' || typeof cell === 'number' || !cell.url) return;
      const addr = XLSX.utils.encode_cell({ r: rowIndex + 1, c: cellIndex });
      ws[addr] = {
        t: 's',
        v: cell.label,
        l: {
          Target: cell.url,
          Tooltip: cell.url,
        },
      };
    });
  });

  XLSX.utils.book_append_sheet(wb, ws, name);
}

function getPhotoExtension(url?: string | null, contentType?: string | null): 'jpeg' | 'png' | 'gif' {
  const normalizedType = (contentType ?? '').toLowerCase();
  if (normalizedType.includes('png')) return 'png';
  if (normalizedType.includes('gif')) return 'gif';

  const cleanUrl = (url ?? '').split('?')[0].toLowerCase();
  if (cleanUrl.endsWith('.png')) return 'png';
  if (cleanUrl.endsWith('.gif')) return 'gif';
  return 'jpeg';
}

function toArrayBuffer(data: ArrayBuffer | SharedArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

async function fetchImageAsset(url?: string | null): Promise<{ base64: string; extension: 'jpeg' | 'png' | 'gif' } | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const extension = getPhotoExtension(url, response.headers.get('content-type'));
    return {
      base64: `data:image/${extension};base64,${encode(buffer)}`,
      extension,
    };
  } catch (err) {
    console.warn('Image fetch for Excel export failed:', err);
    return null;
  }
}

async function embedInlineImages(
  workbook: any,
  worksheet: any,
  photoUrls: Array<string | null | undefined>,
) {
  if (!worksheet || photoUrls.length === 0) return;

  const previewColumn = 7;
  const actionColumn = 8;
  const originalActionHeader = worksheet.getCell(1, previewColumn).value;

  worksheet.getColumn(previewColumn).width = 16;
  worksheet.getColumn(actionColumn).width = 14;
  worksheet.getCell(1, previewColumn).value = 'Preview';
  worksheet.getCell(1, actionColumn).value = originalActionHeader || 'Aksi';

  for (let index = 0; index < photoUrls.length; index += 1) {
    const rowNumber = index + 2;
    const row = worksheet.getRow(rowNumber);
    const previousActionCell = worksheet.getCell(rowNumber, previewColumn);
    worksheet.getCell(rowNumber, actionColumn).value = previousActionCell.value;
    previousActionCell.value = '';
    row.height = 74;

    const asset = await fetchImageAsset(photoUrls[index]);
    if (!asset) {
      worksheet.getCell(rowNumber, previewColumn).value = '—';
      continue;
    }

    const imageId = workbook.addImage({
      base64: asset.base64,
      extension: asset.extension,
    });

    worksheet.addImage(imageId, {
      tl: { col: previewColumn - 1 + 0.12, row: rowNumber - 1 + 0.08 },
      ext: { width: 78, height: 78 },
      editAs: 'oneCell',
    });
  }
}

async function addPhotoPreviewsToWorkbook(workbook: any, payload: ReportPayload) {
  const d = payload.data as any;

  if (payload.type === 'progress_summary') {
    const photoUrls = (d.entries ?? []).flatMap((entry: any) =>
      (entry.photos ?? []).map((photo: any) => photo.photo_url ?? null),
    );
    await embedInlineImages(workbook, workbook.getWorksheet('Lampiran Foto Progres'), photoUrls);
    return;
  }

  if (payload.type === 'receipt_log') {
    const photoUrls = (d.receipts ?? []).flatMap((receipt: any) =>
      (receipt.photos ?? []).map((photo: any) => photo.photo_url ?? null),
    );
    await embedInlineImages(workbook, workbook.getWorksheet('Lampiran Foto Penerimaan'), photoUrls);
    return;
  }

  if (payload.type === 'site_change_log') {
    const photoUrls = (d.items ?? []).flatMap((item: any) =>
      (item.photos ?? []).map((photo: any) => photo.photo_url ?? null),
    );
    await embedInlineImages(workbook, workbook.getWorksheet('Lampiran Foto Perubahan'), photoUrls);
    return;
  }

}

// ── per-report builders ──────────────────────────────────────────────

function buildProgressSummary(wb: XLSX.WorkBook, d: any) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Progress Keseluruhan', `${d.overall_progress}%`],
    ['Total Item BoQ', String(d.total_items)],
    ['Selesai (100%)', String(d.completed_items)],
    ['Sedang Berjalan', String(d.in_progress_items)],
    ['Belum Mulai (0%)', String(d.not_started_items)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan');

  const itemHeader = ['Kode', 'Item Pekerjaan', 'Satuan', 'Volume Rencana', 'Volume Terpasang', 'Progress (%)'];
  const itemRows: SheetRow[] = (d.items ?? []).map((item: any) => [
    item.code,
    item.label,
    item.unit,
    String(item.planned),
    String(item.installed),
    `${item.progress}%`,
  ]);
  appendSheet(wb, 'Detail Item BoQ', itemHeader, itemRows);

  const entryHeader = ['Tanggal', 'Kode BoQ', 'Item', 'Qty', 'Satuan', 'Status', 'Lokasi', 'Catatan', 'Jumlah Foto'];
  const entryRows: SheetRow[] = (d.entries ?? []).map((entry: any) => [
    entry.created_at ? new Date(entry.created_at).toLocaleDateString('id-ID') : '—',
    entry.boq_code ?? '—',
    entry.boq_label ?? '—',
    String(entry.quantity ?? 0),
    entry.unit ?? '—',
    (entry.work_status ?? '—').replace(/_/g, ' '),
    entry.location ?? '—',
    entry.note ?? '—',
    String((entry.photos ?? []).length),
  ]);
  appendSheet(wb, 'Log Progres', entryHeader, entryRows);

  const photoHeader = ['Tanggal', 'Kode BoQ', 'Item', 'Qty', 'Lampiran', 'Referensi File', 'Aksi'];
  const photoRows: SheetRow[] = (d.entries ?? []).flatMap((entry: any) =>
    (entry.photos ?? []).map((photo: any, index: number) => [
      entry.created_at ? new Date(entry.created_at).toLocaleDateString('id-ID') : '—',
      entry.boq_code ?? '—',
      entry.boq_label ?? '—',
      `${entry.quantity ?? 0} ${entry.unit ?? ''}`.trim(),
      `Foto ${index + 1}`,
      photo.storage_path ?? '—',
      { label: 'Buka Foto', url: photo.photo_url ?? null },
    ]),
  );
  appendSheet(wb, 'Lampiran Foto Progres', photoHeader, photoRows);
}

function buildMaterialBalance(wb: XLSX.WorkBook, d: any) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Total Material', String(d.total_materials)],
    ['Over-Received', String(d.over_received)],
    ['Under-Received', String(d.under_received)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan');

  const header = ['Nama Material', 'Satuan', 'Volume Direncanakan', 'Volume Diterima', 'Volume Terpasang', 'Saldo On-Site', 'Status'];
  const rows: string[][] = (d.balances ?? []).map((b: any) => {
    const received = b.received ?? b.total_received ?? 0;
    const planned = b.planned ?? 0;
    const installed = b.installed ?? 0;
    const onSite = b.on_site ?? received - installed;
    const status = onSite < 0 ? 'Defisit di Lapangan' : received < planned * 0.8 ? 'Perlu Pengadaan' : 'Aman';
    return [
      b.material_name ?? b.name ?? '—',
      b.unit ?? '—',
      String(planned),
      String(received),
      String(installed),
      String(onSite),
      status,
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = colWidths([header, ...rows]);
  applyHeaderStyle(ws, 0, header.length);
  XLSX.utils.book_append_sheet(wb, ws, 'Detail Material');
}

function buildReceiptLog(wb: XLSX.WorkBook, d: any) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Total PO', String(d.total_pos)],
    ['Fully Received', String(d.fully_received)],
    ['Masih Open / Parsial', String((d.total_pos ?? 0) - (d.fully_received ?? 0))],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan');

  const header = ['No. PO', 'Material', 'Supplier', 'Qty Dipesan', 'Qty Diterima', 'Satuan', 'Harga Satuan (Rp)', 'Total Nilai (Rp)', 'Status'];
  const rows: SheetRow[] = (d.entries ?? []).map((e: any) => [
    e.po_number ?? e.po_ref ?? '—',
    e.material ?? '—',
    e.supplier ?? '—',
    String(e.ordered_qty ?? 0),
    String(e.received_qty ?? 0),
    e.unit ?? '—',
    e.unit_price != null ? String(e.unit_price) : '—',
    e.unit_price != null ? String((e.ordered_qty ?? 0) * e.unit_price) : '—',
    (e.status ?? '—').replace(/_/g, ' '),
  ]);
  appendSheet(wb, 'Log Penerimaan', header, rows);

  const detailHeader = ['Tanggal', 'Receipt ID', 'No. PO', 'BoQ Ref', 'Material', 'Qty Diterima', 'Satuan', 'Supplier', 'Kendaraan', 'Gate 3', 'Catatan', 'Jumlah Foto'];
  const detailRows: SheetRow[] = (d.receipts ?? []).map((receipt: any) => [
    receipt.created_at ? new Date(receipt.created_at).toLocaleDateString('id-ID') : '—',
    receipt.receipt_id ?? '—',
    receipt.po_number ?? receipt.po_ref ?? '—',
    receipt.po_ref ?? '—',
    receipt.material_name ?? '—',
    String(receipt.quantity_actual ?? 0),
    receipt.unit ?? '—',
    receipt.supplier ?? '—',
    receipt.vehicle_ref ?? '—',
    receipt.gate3_flag ?? '—',
    receipt.notes ?? '—',
    String((receipt.photos ?? []).length),
  ]);
  appendSheet(wb, 'Penerimaan Detail', detailHeader, detailRows);

  const photoHeader = ['Tanggal', 'Receipt ID', 'Material', 'Lampiran', 'GPS', 'Referensi File', 'Aksi'];
  const photoRows: SheetRow[] = (d.receipts ?? []).flatMap((receipt: any) =>
    (receipt.photos ?? []).map((photo: any) => [
      receipt.created_at ? new Date(receipt.created_at).toLocaleDateString('id-ID') : '—',
      receipt.receipt_id ?? '—',
      receipt.material_name ?? '—',
      photo.photo_type ?? '—',
      photo.gps_lat != null && photo.gps_lon != null ? `${photo.gps_lat}, ${photo.gps_lon}` : '—',
      photo.storage_path ?? '—',
      { label: 'Buka Foto', url: photo.photo_url ?? null },
    ]),
  );
  appendSheet(wb, 'Lampiran Foto Penerimaan', photoHeader, photoRows);
}

function buildSiteChangeLog(wb: XLSX.WorkBook, d: any) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Total Catatan', String(d.summary?.total_items ?? 0)],
    ['Pending', String(d.summary?.pending ?? 0)],
    ['Disetujui', String(d.summary?.disetujui ?? 0)],
    ['Ditolak', String(d.summary?.ditolak ?? 0)],
    ['Selesai', String(d.summary?.selesai ?? 0)],
    ['Urgent', String(d.summary?.urgent ?? 0)],
    ['Impact Berat', String(d.summary?.impact_berat ?? 0)],
    ['Rework Belum Selesai', String(d.summary?.open_rework ?? 0)],
    ['Catatan Mutu Open', String(d.summary?.open_quality_notes ?? 0)],
  ];
  if (d.show_costs && d.summary?.approved_cost_total != null) {
    summaryRows.push(['Biaya Disetujui', fmtRp(d.summary.approved_cost_total)]);
  }
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan');

  const byTypeHeader = ['Jenis Perubahan', 'Jumlah'];
  const byTypeRows: SheetRow[] = (d.by_type ?? []).map((row: any) => [
    row.label ?? row.change_type ?? '—',
    String(row.count ?? 0),
  ]);
  appendSheet(wb, 'Breakdown Jenis', byTypeHeader, byTypeRows);

  const itemHeaderBase = [
    'Tanggal',
    'Jenis',
    'Deskripsi',
    'Lokasi',
    'Referensi BoQ',
    'Impact',
    'Status',
    'Flag',
    'Pelapor',
    'Mandor',
    'Catatan Review',
  ];
  const itemHeader = d.show_costs
    ? [...itemHeaderBase, 'Estimasi Biaya (Rp)', 'Beban Biaya']
    : itemHeaderBase;
  const itemRows: SheetRow[] = (d.items ?? []).map((item: any) => {
    const base: SheetRow = [
      item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '—',
      item.change_type_label ?? item.change_type ?? '—',
      item.description ?? '—',
      item.location ?? '—',
      item.boq_code ? `${item.boq_code}${item.boq_label ? ` · ${item.boq_label}` : ''}` : '—',
      item.impact_label ?? item.impact ?? '—',
      item.decision_label ?? item.decision ?? '—',
      (item.flags ?? []).join(' · ') || '—',
      item.reporter_name ?? '—',
      item.mandor_name ?? '—',
      item.estimator_note ?? '—',
    ];
    if (d.show_costs) {
      base.push(item.est_cost != null ? String(item.est_cost) : '—');
      base.push(item.cost_bearer_label ?? '—');
    }
    return base;
  });
  appendSheet(wb, 'Daftar Perubahan', itemHeader, itemRows);

  const photoHeader = ['Tanggal', 'Jenis', 'Deskripsi', 'Lokasi', 'Lampiran', 'Referensi File', 'Aksi'];
  const photoRows: SheetRow[] = (d.items ?? []).flatMap((item: any) =>
    (item.photos ?? []).map((photo: any, index: number) => [
      item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '—',
      item.change_type_label ?? item.change_type ?? '—',
      item.description ?? '—',
      item.location ?? '—',
      `Foto ${index + 1}`,
      photo.storage_path ?? '—',
      { label: 'Buka Foto', url: photo.photo_url ?? null },
    ]),
  );
  appendSheet(wb, 'Lampiran Foto Perubahan', photoHeader, photoRows);
}

function buildScheduleVariance(wb: XLSX.WorkBook, d: any) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Total Milestone', String(d.total_milestones)],
    ['On Track / Ahead', String(d.on_track)],
    ['At Risk', String(d.at_risk)],
    ['Delayed', String(d.delayed)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan');

  const header = ['Milestone', 'Tanggal Rencana', 'Tanggal Revisi', 'Sisa Hari', 'Status'];
  const rows: string[][] = (d.milestones ?? []).map((m: any) => [
    m.label ?? '—',
    m.planned_date ? new Date(m.planned_date).toLocaleDateString('id-ID') : '—',
    m.revised_date ? new Date(m.revised_date).toLocaleDateString('id-ID') : '—',
    m.days_remaining >= 0
      ? `${m.days_remaining} hari lagi`
      : `Terlambat ${Math.abs(m.days_remaining)} hari`,
    (m.status ?? '—').replace(/_/g, ' '),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = colWidths([header, ...rows]);
  applyHeaderStyle(ws, 0, header.length);
  XLSX.utils.book_append_sheet(wb, ws, 'Detail Milestone');
}

function buildWeeklyDigest(wb: XLSX.WorkBook, d: any) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Periode', `${d.week_start} — ${d.week_end}`],
    ['Total Aktivitas', String(d.total_activities)],
    ['Progress Keseluruhan', `${d.overall_progress}%`],
  ];
  if (d.by_flag) {
    summaryRows.push(['', '']);
    summaryRows.push(['Flag', 'Jumlah']);
    Object.entries(d.by_flag).forEach(([flag, count]: any) => {
      summaryRows.push([flag, String(count)]);
    });
  }
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Minggu');

  if (d.by_type) {
    const typeHeader = ['Tipe Aktivitas', 'Jumlah'];
    const typeRows: string[][] = Object.entries(d.by_type).map(([type, count]: any) => [
      type, String(count),
    ]);
    const wsType = XLSX.utils.aoa_to_sheet([typeHeader, ...typeRows]);
    wsType['!cols'] = colWidths([typeHeader, ...typeRows]);
    applyHeaderStyle(wsType, 0, 2);
    XLSX.utils.book_append_sheet(wb, wsType, 'Aktivitas per Tipe');
  }
}

function buildPayrollSupportSummary(wb: XLSX.WorkBook, d: any) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Tujuan', d.purpose ?? '—'],
    ['Total Entri', String(d.total_entries ?? 0)],
    ['Total Qty', String(d.total_qty ?? 0)],
    ['Jumlah Pelapor', String((d.by_reporter ?? []).length)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Payroll');

  const groupHeader = ['Pelapor', 'Jumlah Entri', 'Total Qty'];
  const groupRows: SheetRow[] = (d.by_reporter ?? []).map((group: any) => [
    group.reporter_name ?? '—',
    String(group.entry_count ?? 0),
    String(group.total_qty ?? 0),
  ]);
  appendSheet(wb, 'Rekap Pelapor', groupHeader, groupRows);

  const entryHeader = ['Tanggal', 'Pelapor', 'Kode BoQ', 'Item', 'Qty', 'Satuan', 'Lokasi', 'Catatan'];
  const entryRows: SheetRow[] = (d.entries ?? []).map((entry: any) => [
    entry.created_at ? new Date(entry.created_at).toLocaleDateString('id-ID') : '—',
    entry.reporter_name ?? '—',
    entry.boq_code ?? '—',
    entry.boq_label ?? '—',
    String(entry.quantity ?? 0),
    entry.unit ?? '—',
    entry.location ?? '—',
    entry.note ?? '—',
  ]);
  appendSheet(wb, 'Entri Payroll Support', entryHeader, entryRows);
}

function buildClientChargeReport(wb: XLSX.WorkBook, d: any) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Tujuan', d.purpose ?? '—'],
    ['Estimasi VO Tagih', fmtRp(d.grand_total_est_cost ?? 0)],
    ['Jumlah VO Terkait Klien', String(d.vo_charges?.items?.length ?? 0)],
    ['Jumlah Support Progress', String(d.progress_support?.total_entries ?? 0)],
    ['Total Qty Support Progress', String(d.progress_support?.total_qty ?? 0)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Tagihan');

  const voHeader = ['Tanggal', 'Lokasi', 'Deskripsi', 'Pemohon', 'Penyebab', 'Material Estimasi', 'Est. Biaya (Rp)', 'Status'];
  const voRows: SheetRow[] = (d.vo_charges?.items ?? []).map((item: any) => [
    item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '—',
    item.location ?? '—',
    item.description ?? '—',
    item.requested_by_name ?? '—',
    (item.cause ?? '—').replace(/_/g, ' '),
    item.est_material ?? '—',
    item.est_cost != null ? String(item.est_cost) : '—',
    (item.status ?? '—').replace(/_/g, ' '),
  ]);
  appendSheet(wb, 'VO Tagihan Klien', voHeader, voRows);

  const progressHeader = ['Tanggal', 'Pelapor', 'Kode BoQ', 'Item', 'Qty', 'Satuan', 'Lokasi', 'Catatan'];
  const progressRows: SheetRow[] = (d.progress_support?.items ?? []).map((item: any) => [
    item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '—',
    item.reporter_name ?? '—',
    item.boq_code ?? '—',
    item.boq_label ?? '—',
    String(item.quantity ?? 0),
    item.unit ?? '—',
    item.location ?? '—',
    item.note ?? '—',
  ]);
  appendSheet(wb, 'Support Progress', progressHeader, progressRows);
}

function buildAuditList(wb: XLSX.WorkBook, d: any) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Total Anomali', String(d.anomalies?.total ?? 0)],
    ['Total Audit Case', String(d.audit_cases?.total ?? 0)],
    ['Audit Case Open', String(d.audit_cases?.open ?? 0)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Audit');

  const anomalyHeader = ['Tanggal', 'Event Type', 'Entity Type', 'Entity ID', 'Severity', 'Deskripsi'];
  const anomalyRows: SheetRow[] = (d.anomalies?.items ?? []).map((item: any) => [
    item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '—',
    item.event_type ?? '—',
    item.entity_type ?? '—',
    item.entity_id ?? '—',
    item.severity ?? '—',
    item.description ?? '—',
  ]);
  appendSheet(wb, 'Anomali', anomalyHeader, anomalyRows);

  const auditHeader = ['Tanggal', 'Trigger', 'Entity Type', 'Entity ID', 'Status', 'Catatan'];
  const auditRows: SheetRow[] = (d.audit_cases?.items ?? []).map((item: any) => [
    item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '—',
    item.trigger_type ?? '—',
    item.entity_type ?? '—',
    item.entity_id ?? '—',
    (item.status ?? '—').replace(/_/g, ' '),
    item.notes ?? '—',
  ]);
  appendSheet(wb, 'Audit Case', auditHeader, auditRows);
}

// ── main export function ─────────────────────────────────────────────

export async function exportReportToExcel(
  payload: ReportPayload,
  projectName?: string
): Promise<void> {
  const wb = XLSX.utils.book_new();
  const d = payload.data as any;

  // Add summary info sheet first
  addMetaSheet(wb, payload, projectName);

  switch (payload.type) {
    case 'progress_summary':   buildProgressSummary(wb, d); break;
    case 'material_balance':   buildMaterialBalance(wb, d); break;
    case 'receipt_log':        buildReceiptLog(wb, d); break;
    case 'site_change_log':    buildSiteChangeLog(wb, d); break;
    case 'schedule_variance':  buildScheduleVariance(wb, d); break;
    case 'weekly_digest':      buildWeeklyDigest(wb, d); break;
    case 'payroll_support_summary': buildPayrollSupportSummary(wb, d); break;
    case 'client_charge_report': buildClientChargeReport(wb, d); break;
    case 'audit_list':         buildAuditList(wb, d); break;
  }

  const baseWorkbookBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const ExcelJSImport = await import('exceljs');
  const ExcelJS = (ExcelJSImport as any).default ?? ExcelJSImport;
  const enhancedWorkbook = new ExcelJS.Workbook();
  await enhancedWorkbook.xlsx.load(baseWorkbookBuffer as ArrayBuffer);
  await addPhotoPreviewsToWorkbook(enhancedWorkbook, payload);

  const workbookBuffer = toArrayBuffer(await enhancedWorkbook.xlsx.writeBuffer());
  const fileName = `SANO_${payload.type}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  if (Platform.OS === 'web') {
    const blob = new Blob([workbookBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    const FileSystem = await import('expo-file-system/legacy');
    const Sharing = await import('expo-sharing');
    const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(fileUri, encode(workbookBuffer), {
      encoding: FileSystem.EncodingType.Base64,
    });
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: `Export ${payload.title}`,
      UTI: 'com.microsoft.excel.xlsx',
    });
  }
}
