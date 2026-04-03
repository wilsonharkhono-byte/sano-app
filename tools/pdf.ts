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

// (builders defined in subsequent tasks — see Tasks 5–10)

// forward declarations populated below
const BUILDERS: Partial<Record<string, (sd: SanoDoc, d: any) => Promise<void>>> = {};

BUILDERS['progress_summary'] = buildProgressSummary;

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
