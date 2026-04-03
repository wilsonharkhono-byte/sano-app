// tools/pdf.ts
// SANO — PDF Export Utility
// Generates print-ready PDF reports from ReportPayload objects.
// On web: triggers a browser file download.
// On native: writes to a temp file and opens the system share dialog.

import { Platform } from 'react-native';
import { encode } from 'base64-arraybuffer';
import type { ReportPayload } from './reports';
import { SanoDoc, C, FS, PDF } from './pdf-layout';

// ── Helpers ───────────────────────────────────────────────────────────

function fmtRp(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('id-ID');
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

function statusColor(status: string) {
  switch (status) {
    case 'APPROVED': case 'RECEIVED': case 'VERIFIED': case 'ON_TRACK': case 'AHEAD':
      return C.ok;
    case 'REJECTED': case 'CRITICAL': case 'DELAYED':
      return C.critical;
    case 'REVIEWED': case 'UNDER_REVIEW': case 'INFO':
      return C.info;
    default:
      return C.warning;
  }
}

// ── Per-report builders ───────────────────────────────────────────────
// Each builder receives a SanoDoc and the report's `data` payload,
// draws the report body, and returns void.

async function buildProgressSummary(sd: SanoDoc, d: any): Promise<void> {
  // KPI row
  sd.kpiRow([
    { value: fmtPct(d.overall_progress ?? 0), label: 'Progress', color: C.accent },
    { value: String(d.total_items ?? 0), label: 'Total Item', color: C.info },
    { value: String(d.completed_items ?? 0), label: 'Selesai', color: C.ok },
    { value: String(d.not_started_items ?? 0), label: 'Belum Mulai', color: C.warning },
  ]);

  // Overall progress bar
  sd.gap(4);
  sd.label('Progress Keseluruhan');
  sd.progressBar(d.overall_progress ?? 0);

  // Summary metrics
  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total Item BoQ', String(d.total_items ?? 0));
  sd.metricRow('Selesai (100%)', String(d.completed_items ?? 0), { valueColor: C.ok });
  sd.metricRow('Sedang Berjalan', String(d.in_progress_items ?? 0), { valueColor: C.info });
  sd.metricRow('Belum Mulai (0%)', String(d.not_started_items ?? 0), { valueColor: C.warning });

  // Item detail table
  if ((d.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Detail Item BoQ');
    sd.table(
      [
        { header: 'Kode', width: 0.12 },
        { header: 'Item Pekerjaan', width: 0.35 },
        { header: 'Satuan', width: 0.10 },
        { header: 'Vol. Rencana', width: 0.14, align: 'right' },
        { header: 'Vol. Terpasang', width: 0.14, align: 'right' },
        { header: 'Progress', width: 0.15, align: 'right' },
      ],
      (d.items ?? []).map((item: any) => [
        item.code ?? '—',
        item.label ?? '—',
        item.unit ?? '—',
        String(item.planned ?? 0),
        String(item.installed ?? 0),
        fmtPct(item.progress ?? 0),
      ]),
    );
  }

  // Progress log
  if ((d.entries ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Log Progres Terbaru');
    sd.table(
      [
        { header: 'Tanggal', width: 0.13 },
        { header: 'Kode BoQ', width: 0.12 },
        { header: 'Item', width: 0.28 },
        { header: 'Qty', width: 0.08, align: 'right' },
        { header: 'Satuan', width: 0.08 },
        { header: 'Status', width: 0.14 },
        { header: 'Lokasi', width: 0.17 },
      ],
      (d.entries ?? []).slice(0, 50).map((entry: any) => [
        fmtDate(entry.created_at),
        entry.boq_code ?? '—',
        entry.boq_label ?? '—',
        String(entry.quantity ?? 0),
        entry.unit ?? '—',
        (entry.work_status ?? '—').replace(/_/g, ' '),
        entry.location ?? '—',
      ]),
    );
  }

  // Photos (first 12)
  const photoUrls = (d.entries ?? []).flatMap((e: any) =>
    (e.photos ?? []).map((p: any) => p.photo_url),
  ).slice(0, 12);

  if (photoUrls.length > 0) {
    sd.gap(6);
    sd.sectionTitle('Lampiran Foto');
    await sd.photoGrid(photoUrls, { size: 110, perRow: 4 });
  }
}

async function buildMaterialBalance(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_materials ?? 0), label: 'Total Material', color: C.info },
    { value: String(d.over_received ?? 0), label: 'Over-Received', color: C.warning },
    { value: String(d.under_received ?? 0), label: 'Under-Received', color: C.critical },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total Material', String(d.total_materials ?? 0));
  sd.metricRow('Over-Received', String(d.over_received ?? 0), { valueColor: C.warning });
  sd.metricRow('Under-Received', String(d.under_received ?? 0), { valueColor: C.critical });

  if ((d.balances ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Detail Material');
    sd.table(
      [
        { header: 'Material', width: 0.25 },
        { header: 'Satuan', width: 0.08 },
        { header: 'Rencana', width: 0.13, align: 'right' },
        { header: 'Diterima', width: 0.13, align: 'right' },
        { header: 'Terpasang', width: 0.13, align: 'right' },
        { header: 'On-Site', width: 0.13, align: 'right' },
        { header: 'Status', width: 0.15 },
      ],
      (d.balances ?? []).map((b: any) => {
        const received = b.received ?? b.total_received ?? 0;
        const planned = b.planned ?? 0;
        const installed = b.installed ?? 0;
        const onSite = b.on_site ?? received - installed;
        const status = onSite < 0 ? 'Defisit' : received < planned * 0.8 ? 'Perlu Pengadaan' : 'Aman';
        return [
          b.material_name ?? b.name ?? '—',
          b.unit ?? '—',
          String(planned),
          String(received),
          String(installed),
          String(onSite),
          status,
        ];
      }),
    );
  }
}

async function buildReceiptLog(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_pos ?? 0), label: 'Total PO', color: C.info },
    { value: String(d.fully_received ?? 0), label: 'Fully Received', color: C.ok },
    { value: String((d.total_pos ?? 0) - (d.fully_received ?? 0)), label: 'Open/Parsial', color: C.warning },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total PO', String(d.total_pos ?? 0));
  sd.metricRow('Fully Received', String(d.fully_received ?? 0), { valueColor: C.ok });
  sd.metricRow('Open / Parsial', String((d.total_pos ?? 0) - (d.fully_received ?? 0)), { valueColor: C.warning });

  if ((d.entries ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Log Penerimaan');
    sd.table(
      [
        { header: 'No. PO', width: 0.12 },
        { header: 'Material', width: 0.20 },
        { header: 'Supplier', width: 0.15 },
        { header: 'Dipesan', width: 0.10, align: 'right' },
        { header: 'Diterima', width: 0.10, align: 'right' },
        { header: 'Satuan', width: 0.08 },
        { header: 'Harga/Unit', width: 0.12, align: 'right' },
        { header: 'Status', width: 0.13 },
      ],
      (d.entries ?? []).map((e: any) => [
        e.po_number ?? e.po_ref ?? '—',
        e.material ?? '—',
        e.supplier ?? '—',
        String(e.ordered_qty ?? 0),
        String(e.received_qty ?? 0),
        e.unit ?? '—',
        e.unit_price != null ? fmtRp(e.unit_price) : '—',
        (e.status ?? '—').replace(/_/g, ' '),
      ]),
    );
  }

  // Photos
  const photoUrls = (d.receipts ?? []).flatMap((r: any) =>
    (r.photos ?? []).map((p: any) => p.photo_url),
  ).slice(0, 12);
  if (photoUrls.length > 0) {
    sd.gap(6);
    sd.sectionTitle('Lampiran Foto Penerimaan');
    await sd.photoGrid(photoUrls, { size: 110, perRow: 4 });
  }
}

// (builders defined in subsequent tasks — see Tasks 5–10)

// forward declarations populated below
const BUILDERS: Partial<Record<string, (sd: SanoDoc, d: any) => Promise<void>>> = {};

BUILDERS['progress_summary'] = buildProgressSummary;
BUILDERS['material_balance'] = buildMaterialBalance;
BUILDERS['receipt_log'] = buildReceiptLog;

// ── Main export function ──────────────────────────────────────────────

export async function exportReportToPdf(
  payload: ReportPayload,
  projectName?: string,
): Promise<void> {
  const sd = await SanoDoc.create({
    title: payload.title,
    projectName: projectName ?? payload.project_id,
    generatedAt: payload.generated_at,
  });

  const builder = BUILDERS[payload.type];
  if (builder) {
    await builder(sd, payload.data as any);
  } else {
    // Fallback: render raw JSON preview
    sd.sectionTitle('Data Laporan');
    sd.text(JSON.stringify(payload.data, null, 2).substring(0, 3000), { size: FS.xs });
  }

  const pdfBytes = await sd.save();
  const fileName = `SANO_${payload.type}_${new Date().toISOString().slice(0, 10)}.pdf`;

  if (Platform.OS === 'web') {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
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
    const buffer = pdfBytes.buffer as ArrayBuffer;
    await FileSystem.writeAsStringAsync(fileUri, encode(buffer), {
      encoding: FileSystem.EncodingType.Base64,
    });
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/pdf',
      dialogTitle: `Export ${payload.title}`,
      UTI: 'com.adobe.pdf',
    });
  }
}
