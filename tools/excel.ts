// SANO — Excel Export Utility
// Generates well-formatted .xlsx workbooks from ReportPayload objects.
// On web: triggers a browser file download.
// On native: writes to a temp file and opens the system share dialog.

import { Platform } from 'react-native';
import * as XLSX from 'xlsx';
import { encode } from 'base64-arraybuffer';
import type { ReportPayload } from './reports';
import { formatDriftPct } from './planDrift';
import { needsProcurement } from './materialThresholds';
import type {
  ProgressSummaryData,
  MaterialBalanceData,
  ReceiptLogData,
  SiteChangeLogData,
  ScheduleVarianceData,
  WeeklyDigestData,
  AuditListData,
  AIUsageData,
  ApprovalSLAData,
  OperationalDisciplineData,
  ToolUsageData,
  ExceptionHandlingData,
  ReportPhoto,
} from './reportDataTypes';

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

async function addPhotoPreviewsToWorkbook(workbook: Record<string, unknown>, payload: ReportPayload) {
  const wb = workbook as { getWorksheet(name: string): unknown };

  if (payload.type === 'progress_summary') {
    const d = payload.data as ProgressSummaryData;
    const photoUrls = (d.entries ?? []).flatMap((entry) =>
      (entry.photos ?? []).map((photo) => photo.photo_url ?? null),
    );
    await embedInlineImages(wb, wb.getWorksheet('Lampiran Foto Progres'), photoUrls);
    return;
  }

  if (payload.type === 'receipt_log') {
    const d = payload.data as ReceiptLogData;
    const photoUrls = (d.receipts ?? []).flatMap((receipt) =>
      (receipt.photos ?? []).map((photo: ReportPhoto) => photo.photo_url ?? null),
    );
    await embedInlineImages(wb, wb.getWorksheet('Lampiran Foto Penerimaan'), photoUrls);
    return;
  }

  if (payload.type === 'site_change_log') {
    const d = payload.data as SiteChangeLogData;
    const photoUrls = (d.items ?? []).flatMap((item) =>
      (item.photos ?? []).map((photo: ReportPhoto) => photo.photo_url ?? null),
    );
    await embedInlineImages(wb, wb.getWorksheet('Lampiran Foto Perubahan'), photoUrls);
    return;
  }

}

// ── per-report builders ──────────────────────────────────────────────

function buildProgressSummary(wb: XLSX.WorkBook, d: ProgressSummaryData) {
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
  const itemRows: SheetRow[] = (d.items ?? []).map((item) => [
    item.code,
    item.label,
    item.unit,
    String(item.planned),
    String(item.installed),
    `${item.progress}%`,
  ]);
  appendSheet(wb, 'Detail Item BoQ', itemHeader, itemRows);

  const entryHeader = ['Tanggal', 'Kode BoQ', 'Item', 'Qty', 'Satuan', 'Status', 'Lokasi', 'Catatan', 'Jumlah Foto'];
  const entryRows: SheetRow[] = (d.entries ?? []).map((entry) => [
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
  const photoRows: SheetRow[] = (d.entries ?? []).flatMap((entry) =>
    (entry.photos ?? []).map((photo, index: number) => [
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

export function buildMaterialBalance(wb: XLSX.WorkBook, d: MaterialBalanceData) {
  const showCosts = d.show_costs === true;
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Total Material', String(d.total_materials)],
    ['Over-Received', String(d.over_received)],
    ['Perlu Pengadaan', String(d.needs_procurement)],
    ['Over-Budget', String(d.over_budget ?? 0)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan');

  const header = [
    'Nama Material', 'Satuan', 'Volume Direncanakan', 'Volume Diterima',
    'Volume Terpasang', 'Saldo On-Site', 'Status',
    'Tier', 'Kontrol',
    ...(showCosts ? ['Anggaran (Rp)', 'Terpakai (Rp)'] : []),
    'Burn %', 'Flag',
    // Signal-2 plan drift (Task 2.13) — office viewers only, same show_costs
    // gate as the Rp columns above (see MaterialBalanceData.drift_pct).
    ...(showCosts ? ['Drift vs Baseline'] : []),
  ];
  const rows: string[][] = (d.balances ?? []).map((b) => {
    const received = b.received ?? b.total_received ?? 0;
    const planned = b.planned ?? 0;
    const installed = b.installed ?? 0;
    const onSite = b.on_site ?? received - installed;
    // Task 3.3: shared on_site-based predicate (tools/materialThresholds.ts) —
    // same rule as the LaporanScreen tile and the reports.ts summary count.
    const status = onSite < 0 ? 'Defisit di Lapangan' : needsProcurement({ planned, on_site: onSite }) ? 'Perlu Pengadaan' : 'Aman';
    const isRp = b.control === 'RP';
    return [
      b.material_name ?? b.name ?? '—',
      b.unit ?? '—',
      String(planned),
      String(received),
      String(installed),
      String(onSite),
      status,
      b.tier == null ? '—' : String(b.tier),
      b.control ?? '—',
      ...(showCosts ? [
        isRp ? Math.round(b.budget_total_rupiah ?? 0).toLocaleString('id-ID') : '—',
        isRp ? Math.round(b.committed_rupiah ?? 0).toLocaleString('id-ID') : '—',
      ] : []),
      b.control === 'NONE' || b.burn_pct == null ? '—' : b.burn_pct.toFixed(0) + '%',
      b.control === 'NONE' ? '—' : (b.flag ?? '—'),
      ...(showCosts ? [b.drift_pct == null ? '—' : formatDriftPct(b.drift_pct)] : []),
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = colWidths([header, ...rows]);
  applyHeaderStyle(ws, 0, header.length);
  XLSX.utils.book_append_sheet(wb, ws, 'Detail Material');
}

export function buildReceiptLog(wb: XLSX.WorkBook, d: ReceiptLogData) {
  const showCosts = d.show_costs === true;
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

  const header = [
    'No. PO', 'Material', 'Supplier', 'Qty Dipesan', 'Qty Diterima', 'Satuan',
    ...(showCosts ? ['Harga Satuan (Rp)', 'Total Nilai (Rp)'] : []),
    'Status',
  ];
  const rows: SheetRow[] = (d.entries ?? []).map((e) => [
    e.po_number ?? e.po_ref ?? '—',
    e.material ?? '—',
    e.supplier ?? '—',
    String(e.ordered_qty ?? 0),
    String(e.received_qty ?? 0),
    e.unit ?? '—',
    ...(showCosts ? [
      e.unit_price != null ? String(e.unit_price) : '—',
      e.unit_price != null ? String((e.ordered_qty ?? 0) * e.unit_price) : '—',
    ] : []),
    (e.status ?? '—').replace(/_/g, ' '),
  ]);
  appendSheet(wb, 'Log Penerimaan', header, rows);

  const detailHeader = ['Tanggal', 'Receipt ID', 'No. PO', 'BoQ Ref', 'Material', 'Qty Diterima', 'Satuan', 'Supplier', 'Kendaraan', 'Gate 3', 'Catatan', 'Jumlah Foto'];
  const detailRows: SheetRow[] = (d.receipts ?? []).map((receipt) => [
    receipt.created_at ? new Date(receipt.created_at).toLocaleDateString('id-ID') : '—',
    receipt.receipt_id ?? '—',
    receipt.po_number ?? receipt.po_ref ?? '—',
    receipt.po_ref ?? '—',
    receipt.material_name ?? '—',
    String(receipt.quantity_actual ?? 0),
    receipt.unit ?? '—',
    receipt.supplier ?? '—',
    receipt.vehicle_ref ?? '—',
    String(receipt.gate3_flag) ?? '—',
    receipt.notes ?? '—',
    String((receipt.photos ?? []).length),
  ]);
  appendSheet(wb, 'Penerimaan Detail', detailHeader, detailRows);

  const photoHeader = ['Tanggal', 'Receipt ID', 'Material', 'Lampiran', 'GPS', 'Referensi File', 'Aksi'];
  const photoRows: SheetRow[] = (d.receipts ?? []).flatMap((receipt) =>
    (receipt.photos ?? []).map((photo: ReportPhoto) => [
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

function buildSiteChangeLog(wb: XLSX.WorkBook, d: SiteChangeLogData) {
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
  const byTypeRows: SheetRow[] = (d.by_type ?? []).map((row) => [
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
  const itemRows: SheetRow[] = (d.items ?? []).map((item) => {
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
  const photoRows: SheetRow[] = (d.items ?? []).flatMap((item) =>
    (item.photos ?? []).map((photo: ReportPhoto, index: number) => [
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

function buildScheduleVariance(wb: XLSX.WorkBook, d: ScheduleVarianceData) {
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
  const rows: string[][] = (d.milestones ?? []).map((m) => [
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

function buildWeeklyDigest(wb: XLSX.WorkBook, d: WeeklyDigestData) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Periode', `${d.week_start} — ${d.week_end}`],
    ['Total Aktivitas', String(d.total_activities)],
    ['Progress Keseluruhan', `${d.overall_progress}%`],
  ];
  if (d.by_flag) {
    summaryRows.push(['', '']);
    summaryRows.push(['Flag', 'Jumlah']);
    Object.entries(d.by_flag).forEach(([flag, count]: [string, number]) => {
      summaryRows.push([flag, String(count)]);
    });
  }
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Minggu');

  if (d.by_type) {
    const typeHeader = ['Tipe Aktivitas', 'Jumlah'];
    const typeRows: string[][] = Object.entries(d.by_type).map(([type, count]: [string, number]) => [
      type, String(count),
    ]);
    const wsType = XLSX.utils.aoa_to_sheet([typeHeader, ...typeRows]);
    wsType['!cols'] = colWidths([typeHeader, ...typeRows]);
    applyHeaderStyle(wsType, 0, 2);
    XLSX.utils.book_append_sheet(wb, wsType, 'Aktivitas per Tipe');
  }
}

// Restored (post-3.4): AI Usage Summary — live principal report. Excel builder
// added to satisfy the surviving-type invariant (was meta-sheet-only before).
function buildAIUsageSummary(wb: XLSX.WorkBook, d: AIUsageData) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Total Interaksi', String(d.summary?.total_interactions ?? 0)],
    ['User Aktif', String(d.summary?.active_users ?? 0)],
    ['Total Token', String(d.summary?.total_tokens ?? 0)],
    ['Token Input', String(d.summary?.total_input_tokens ?? 0)],
    ['Token Output', String(d.summary?.total_output_tokens ?? 0)],
    ['Chat Haiku', String(d.summary?.haiku_count ?? 0)],
    ['Chat Sonnet', String(d.summary?.sonnet_count ?? 0)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan AI');

  const userHeader = ['User', 'Peran', 'Chat', 'Token Input', 'Token Output', 'Total Token', 'Haiku', 'Sonnet', 'Hari Aktif', 'Terakhir Pakai'];
  const userRows: SheetRow[] = (d.users ?? []).map((u) => [
    u.full_name ?? '—',
    u.role ?? '—',
    String(u.interaction_count ?? 0),
    String(u.input_tokens ?? 0),
    String(u.output_tokens ?? 0),
    String(u.total_tokens ?? 0),
    String(u.haiku_count ?? 0),
    String(u.sonnet_count ?? 0),
    String(u.active_days ?? 0),
    u.last_used_at ? new Date(u.last_used_at).toLocaleString('id-ID') : '—',
  ]);
  appendSheet(wb, 'AI per User', userHeader, userRows);

  const dayHeader = ['Tanggal', 'Chat', 'Token Input', 'Token Output', 'Total Token'];
  const dayRows: SheetRow[] = (d.usage_by_day ?? []).map((row) => [
    row.date ?? '—',
    String(row.interaction_count ?? 0),
    String(row.input_tokens ?? 0),
    String(row.output_tokens ?? 0),
    String(row.total_tokens ?? 0),
  ]);
  appendSheet(wb, 'Tren Harian', dayHeader, dayRows);
}

// Task 3.4: launched report — Approval SLA per User (input tables are live:
// approval_tasks + the per-module review timestamps). Sheets mirror the
// summary + detail pattern used by the other builders.
function buildApprovalSLAUser(wb: XLSX.WorkBook, d: ApprovalSLAData) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Event Ditangani', String(d.summary?.handled_events ?? 0)],
    ['Reviewer Aktif', String(d.summary?.active_reviewers ?? 0)],
    ['Rata-rata SLA (jam)', String(d.summary?.avg_hours ?? 0)],
    ['Median SLA (jam)', String(d.summary?.median_hours ?? 0)],
    ['Lebih dari 24 jam', String(d.summary?.over_24h ?? 0)],
    ['Item Pending', String(d.summary?.pending_items ?? 0)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan SLA');

  const queueHeader = ['Antrean', 'Pending'];
  const queueRows: SheetRow[] = (d.pending_by_queue ?? []).map((row) => [
    row.label ?? '—',
    String(row.count ?? 0),
  ]);
  appendSheet(wb, 'Pending per Antrean', queueHeader, queueRows);

  const userHeader = ['User', 'Peran', 'Ditangani', 'Avg (jam)', 'Median (jam)', '>24 jam', 'Pending', 'Terakhir Aksi'];
  const userRows: SheetRow[] = (d.users ?? []).map((u) => [
    u.full_name ?? '—',
    u.role ?? '—',
    String(u.handled_events ?? 0),
    String(u.avg_hours ?? 0),
    String(u.median_hours ?? 0),
    String(u.over_24h ?? 0),
    String(u.assigned_pending ?? 0),
    u.last_acted_at ? new Date(u.last_acted_at).toLocaleString('id-ID') : '—',
  ]);
  appendSheet(wb, 'SLA per User', userHeader, userRows);

  const entityHeader = ['Jenis Approval', 'Event', 'Avg (jam)', 'Median (jam)'];
  const entityRows: SheetRow[] = (d.entity_sla ?? []).map((row) => [
    row.entity ?? '—',
    String(row.handled_events ?? 0),
    String(row.avg_hours ?? 0),
    String(row.median_hours ?? 0),
  ]);
  appendSheet(wb, 'SLA per Jenis', entityHeader, entityRows);
}

// Task 3.4: launched report — Operational Entry Discipline (input table live:
// activity_log + per-module entry/photo tables).
function buildOperationalEntryDiscipline(wb: XLSX.WorkBook, d: OperationalDisciplineData) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Total Entry', String(d.summary?.total_entries ?? 0)],
    ['User Aktif', String(d.summary?.active_users ?? 0)],
    ['Entry Eligible Foto', String(d.summary?.photo_eligible_entries ?? 0)],
    ['Foto Lengkap', String(d.summary?.photo_backed_entries ?? 0)],
    ['Cakupan Foto', `${d.summary?.photo_coverage_pct ?? 0}%`],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Disiplin');

  const moduleHeader = ['Modul', 'Jumlah Entry'];
  const moduleRows: SheetRow[] = (d.by_module ?? []).map((row) => [
    row.module ?? '—',
    String(row.count ?? 0),
  ]);
  appendSheet(wb, 'Distribusi Modul', moduleHeader, moduleRows);

  const userHeader = ['User', 'Peran', 'Total Entry', 'Hari Aktif', 'Cakupan Foto', 'Aktivitas Terakhir'];
  const userRows: SheetRow[] = (d.users ?? []).map((u) => [
    u.full_name ?? '—',
    u.role ?? '—',
    String(u.total_entries ?? 0),
    String(u.active_days ?? 0),
    u.photo_coverage_pct != null ? `${u.photo_coverage_pct}%` : '—',
    u.last_activity ? new Date(u.last_activity).toLocaleString('id-ID') : '—',
  ]);
  appendSheet(wb, 'Disiplin per User', userHeader, userRows);
}

function buildAuditList(wb: XLSX.WorkBook, d: AuditListData) {
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
  const anomalyRows: SheetRow[] = (d.anomalies?.items ?? []).map((item) => [
    item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '—',
    item.event_type ?? '—',
    item.entity_type ?? '—',
    item.entity_id ?? '—',
    item.severity ?? '—',
    item.description ?? '—',
  ]);
  appendSheet(wb, 'Anomali', anomalyHeader, anomalyRows);

  const auditHeader = ['Tanggal', 'Trigger', 'Entity Type', 'Entity ID', 'Status', 'Catatan'];
  const auditRows: SheetRow[] = (d.audit_cases?.items ?? []).map((item) => [
    item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '—',
    item.trigger_type ?? '—',
    item.entity_type ?? '—',
    item.entity_id ?? '—',
    (item.status ?? '—').replace(/_/g, ' '),
    item.notes ?? '—',
  ]);
  appendSheet(wb, 'Audit Case', auditHeader, auditRows);
}

// Restored (post-3.4): Tool Usage Summary — live principal report. Excel builder
// added to satisfy the surviving-type invariant (was meta-sheet-only before).
function buildToolUsageSummary(wb: XLSX.WorkBook, d: ToolUsageData) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['Total Export', String(d.summary?.total_exports ?? 0)],
    ['User Export', String(d.summary?.export_users ?? 0)],
    ['Total Chat AI', String(d.summary?.total_ai_chats ?? 0)],
    ['User AI', String(d.summary?.ai_users ?? 0)],
    ['Total Token AI', String(d.summary?.total_ai_tokens ?? 0)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Tool');

  const typeHeader = ['Tipe Laporan', 'Jumlah Export'];
  const typeRows: SheetRow[] = (d.top_report_types ?? []).map((row) => [
    row.report_type ?? '—',
    String(row.count ?? 0),
  ]);
  appendSheet(wb, 'Export per Tipe', typeHeader, typeRows);

  const userHeader = ['User', 'Peran', 'Export', 'Chat AI', 'Total Token', 'Haiku', 'Sonnet', 'Aktivitas Terakhir'];
  const userRows: SheetRow[] = (d.users ?? []).map((u) => [
    u.full_name ?? '—',
    u.role ?? '—',
    String(u.export_count ?? 0),
    String(u.ai_chat_count ?? 0),
    String(u.total_tokens ?? 0),
    String(u.haiku_count ?? 0),
    String(u.sonnet_count ?? 0),
    u.last_seen ? new Date(u.last_seen).toLocaleString('id-ID') : '—',
  ]);
  appendSheet(wb, 'Tool per User', userHeader, userRows);
}

// Restored (post-3.4): Exception Handling Load — live principal report. Excel
// builder added to satisfy the surviving-type invariant.
function buildExceptionHandlingLoad(wb: XLSX.WorkBook, d: ExceptionHandlingData) {
  const summaryRows: string[][] = [
    ['Indikator', 'Nilai'],
    ['AUTO_HOLD Request', String(d.summary?.auto_hold_requests ?? 0)],
    ['Request Ditolak', String(d.summary?.rejected_requests ?? 0)],
    ['Perubahan Ditolak', String(d.summary?.rejected_vo ?? 0)],
    ['MTN Ditolak', String(d.summary?.rejected_mtn ?? 0)],
    ['Hold/Reject/Override', String(d.summary?.hold_reject_override_actions ?? 0)],
    ['Total Anomali', String(d.summary?.anomalies_total ?? 0)],
    ['Anomali High/Critical', String(d.summary?.anomalies_high_or_critical ?? 0)],
    ['Audit Case Open', String(d.summary?.audit_cases_open ?? 0)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = colWidths(summaryRows);
  applyHeaderStyle(wsSummary, 0, 2);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Exception');

  const userHeader = ['User', 'Peran', 'Generated', 'Handled', 'Hold/Reject/Override', 'Terakhir Sentuh'];
  const userRows: SheetRow[] = (d.users ?? []).map((u) => [
    u.full_name ?? '—',
    u.role ?? '—',
    String(u.generated_count ?? 0),
    String(u.handled_count ?? 0),
    String(u.hold_reject_override ?? 0),
    u.last_touch ? new Date(u.last_touch).toLocaleString('id-ID') : '—',
  ]);
  appendSheet(wb, 'Beban per User', userHeader, userRows);

  const anomalyHeader = ['Tipe Anomali', 'Jumlah'];
  const anomalyRows: SheetRow[] = (d.anomaly_breakdown ?? []).map((row) => [
    row.event_type ?? '—',
    String(row.count ?? 0),
  ]);
  appendSheet(wb, 'Breakdown Anomali', anomalyHeader, anomalyRows);
}

// ── main export function ─────────────────────────────────────────────

export async function exportReportToExcel(
  payload: ReportPayload,
  projectName?: string
): Promise<void> {
  const wb = XLSX.utils.book_new();

  // Add summary info sheet first
  addMetaSheet(wb, payload, projectName);

  switch (payload.type) {
    case 'progress_summary':   buildProgressSummary(wb, payload.data as ProgressSummaryData); break;
    case 'material_balance':   buildMaterialBalance(wb, payload.data as MaterialBalanceData); break;
    case 'receipt_log':        buildReceiptLog(wb, payload.data as ReceiptLogData); break;
    case 'site_change_log':    buildSiteChangeLog(wb, payload.data as SiteChangeLogData); break;
    case 'schedule_variance':  buildScheduleVariance(wb, payload.data as ScheduleVarianceData); break;
    case 'weekly_digest':      buildWeeklyDigest(wb, payload.data as WeeklyDigestData); break;
    case 'audit_list':         buildAuditList(wb, payload.data as AuditListData); break;
    case 'ai_usage_summary':   buildAIUsageSummary(wb, payload.data as AIUsageData); break;
    case 'approval_sla_user':  buildApprovalSLAUser(wb, payload.data as ApprovalSLAData); break;
    case 'operational_entry_discipline': buildOperationalEntryDiscipline(wb, payload.data as OperationalDisciplineData); break;
    case 'tool_usage_summary': buildToolUsageSummary(wb, payload.data as ToolUsageData); break;
    case 'exception_handling_load': buildExceptionHandlingLoad(wb, payload.data as ExceptionHandlingData); break;
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
