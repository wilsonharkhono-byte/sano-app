// tools/pdf.ts
// SANO — PDF Export Utility
// Generates print-ready PDF reports from ReportPayload objects.
// On web: triggers a browser file download.
// On native: writes to a temp file and opens the system share dialog.

import { Platform } from 'react-native';
import { encode } from 'base64-arraybuffer';
import type { ReportPayload } from './reports';
import type {
  ProgressSummaryData,
  MaterialBalanceData,
  ReceiptLogData,
  SiteChangeLogData,
  ScheduleVarianceData,
  WeeklyDigestData,
  PayrollSupportData,
  ClientChargeData,
  AuditListData,
  AIUsageData,
  ApprovalSLAData,
  OperationalDisciplineData,
  ToolUsageData,
  ExceptionHandlingData,
  ReportPhoto,
} from './reportDataTypes';
import { SanoDoc, C, FS, PDF } from './pdf-layout';

// ── Helpers ───────────────────────────────────────────────────────────

function fmtRp(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('id-ID');
}

/** Short date for tight table columns: "26/3/26" */
function fmtDateShort(v?: string | null): string {
  if (!v) return '—';
  const dt = new Date(v);
  return `${dt.getDate()}/${dt.getMonth() + 1}/${String(dt.getFullYear()).slice(2)}`;
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

async function buildProgressSummary(sd: SanoDoc, d: ProgressSummaryData): Promise<void> {
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
      (d.items ?? []).map((item) => [
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
        { header: 'Tgl', width: 0.09 },
        { header: 'Kode', width: 0.10 },
        { header: 'Item', width: 0.30 },
        { header: 'Qty', width: 0.08, align: 'right' },
        { header: 'Sat.', width: 0.07 },
        { header: 'Status', width: 0.16 },
        { header: 'Lokasi', width: 0.20 },
      ],
      (d.entries ?? []).slice(0, 50).map((entry) => [
        fmtDateShort(entry.created_at),
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
  const photoUrls = (d.entries ?? []).flatMap((e) =>
    (e.photos ?? []).map((p) => p.photo_url),
  ).slice(0, 12);

  if (photoUrls.length > 0) {
    sd.gap(6);
    sd.sectionTitle('Lampiran Foto');
    await sd.photoGrid(photoUrls, { size: 110, perRow: 4 });
  }
}

async function buildMaterialBalance(sd: SanoDoc, d: MaterialBalanceData): Promise<void> {
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
        { header: 'Material', width: 0.28 },
        { header: 'Sat.', width: 0.06 },
        { header: 'Rencana', width: 0.12, align: 'right' },
        { header: 'Diterima', width: 0.12, align: 'right' },
        { header: 'Terpasang', width: 0.12, align: 'right' },
        { header: 'On-Site', width: 0.12, align: 'right' },
        { header: 'Status', width: 0.18 },
      ],
      (d.balances ?? []).map((b) => {
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

async function buildReceiptLog(sd: SanoDoc, d: ReceiptLogData): Promise<void> {
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
        { header: 'No. PO', width: 0.10 },
        { header: 'Material', width: 0.22 },
        { header: 'Supplier', width: 0.16 },
        { header: 'Pesan', width: 0.08, align: 'right' },
        { header: 'Terima', width: 0.08, align: 'right' },
        { header: 'Sat.', width: 0.06 },
        { header: 'Harga/Unit', width: 0.14, align: 'right' },
        { header: 'Status', width: 0.16 },
      ],
      (d.entries ?? []).map((e) => [
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
  const photoUrls = (d.receipts ?? []).flatMap((r) =>
    (r.photos ?? []).map((p) => p.photo_url),
  ).slice(0, 12);
  if (photoUrls.length > 0) {
    sd.gap(6);
    sd.sectionTitle('Lampiran Foto Penerimaan');
    await sd.photoGrid(photoUrls, { size: 110, perRow: 4 });
  }
}

async function buildScheduleVariance(sd: SanoDoc, d: ScheduleVarianceData): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_milestones ?? 0), label: 'Total Milestone', color: C.info },
    { value: String(d.on_track ?? 0), label: 'On Track', color: C.ok },
    { value: String(d.at_risk ?? 0), label: 'At Risk', color: C.warning },
    { value: String(d.delayed ?? 0), label: 'Delayed', color: C.critical },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total Milestone', String(d.total_milestones ?? 0));
  sd.metricRow('On Track / Ahead', String(d.on_track ?? 0), { valueColor: C.ok });
  sd.metricRow('At Risk', String(d.at_risk ?? 0), { valueColor: C.warning });
  sd.metricRow('Delayed', String(d.delayed ?? 0), { valueColor: C.critical });

  if ((d.milestones ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Detail Milestone');
    sd.table(
      [
        { header: 'Milestone', width: 0.30 },
        { header: 'Tgl Rencana', width: 0.15 },
        { header: 'Tgl Revisi', width: 0.15 },
        { header: 'Sisa Hari', width: 0.22, align: 'right' },
        { header: 'Status', width: 0.18 },
      ],
      (d.milestones ?? []).map((m) => [
        m.label ?? '—',
        fmtDate(m.planned_date),
        fmtDate(m.revised_date),
        m.days_remaining >= 0
          ? `${m.days_remaining} hari lagi`
          : `Terlambat ${Math.abs(m.days_remaining)} hari`,
        (m.status ?? '—').replace(/_/g, ' '),
      ]),
    );
  }
}

async function buildWeeklyDigest(sd: SanoDoc, d: WeeklyDigestData): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_activities ?? 0), label: 'Total Aktivitas', color: C.info },
    { value: fmtPct(d.overall_progress ?? 0), label: 'Progress', color: C.accent },
  ]);

  sd.sectionTitle('Ringkasan Minggu');
  sd.metricRow('Periode', `${d.week_start ?? '—'} — ${d.week_end ?? '—'}`);
  sd.metricRow('Total Aktivitas', String(d.total_activities ?? 0));
  sd.metricRow('Progress Keseluruhan', fmtPct(d.overall_progress ?? 0));

  if (d.by_flag) {
    sd.gap(6);
    sd.sectionTitle('Aktivitas per Flag');
    Object.entries(d.by_flag).forEach(([flag, count]: [string, number]) => {
      const color = flag === 'CRITICAL' ? C.critical : flag === 'WARNING' ? C.warning : flag === 'OK' ? C.ok : C.info;
      sd.metricRow(flag, String(count), { valueColor: color });
    });
  }

  if (d.by_type) {
    sd.gap(6);
    sd.sectionTitle('Aktivitas per Tipe');
    Object.entries(d.by_type).forEach(([type, count]: [string, number]) => {
      sd.metricRow(type, String(count));
    });
  }
}

async function buildPayrollSupportSummary(sd: SanoDoc, d: PayrollSupportData): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_entries ?? 0), label: 'Total Entri', color: C.info },
    { value: String(d.total_qty ?? 0), label: 'Total Qty', color: C.accent },
    { value: String((d.by_reporter ?? []).length), label: 'Jumlah Pelapor', color: C.ok },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Tujuan', d.purpose ?? '—');
  sd.metricRow('Total Entri', String(d.total_entries ?? 0));
  sd.metricRow('Total Qty', String(d.total_qty ?? 0));

  if ((d.by_reporter ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Rekap per Pelapor');
    sd.table(
      [
        { header: 'Pelapor', width: 0.50 },
        { header: 'Jumlah Entri', width: 0.25, align: 'right' },
        { header: 'Total Qty', width: 0.25, align: 'right' },
      ],
      (d.by_reporter ?? []).map((g) => [
        g.reporter_name ?? '—',
        String(g.entry_count ?? 0),
        String(g.total_qty ?? 0),
      ]),
    );
  }

  if ((d.entries ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Detail Entri');
    sd.table(
      [
        { header: 'Tgl', width: 0.08 },
        { header: 'Pelapor', width: 0.14 },
        { header: 'Kode', width: 0.09 },
        { header: 'Item', width: 0.22 },
        { header: 'Qty', width: 0.07, align: 'right' },
        { header: 'Sat.', width: 0.06 },
        { header: 'Lokasi', width: 0.14 },
        { header: 'Catatan', width: 0.20 },
      ],
      (d.entries ?? []).slice(0, 100).map((e) => [
        fmtDateShort(e.created_at),
        e.reporter_name ?? '—',
        e.boq_code ?? '—',
        e.boq_label ?? '—',
        String(e.quantity ?? 0),
        e.unit ?? '—',
        e.location ?? '—',
        e.note ?? '—',
      ]),
    );
  }
}

async function buildClientChargeReport(sd: SanoDoc, d: ClientChargeData): Promise<void> {
  sd.kpiRow([
    { value: fmtRp(d.grand_total_est_cost ?? 0), label: 'Est. Tagihan VO', color: C.critical },
    { value: String(d.vo_charges?.items?.length ?? 0), label: 'VO Klien', color: C.warning },
    { value: String(d.progress_support?.total_entries ?? 0), label: 'Support Entries', color: C.info },
  ]);

  sd.sectionTitle('Ringkasan Tagihan');
  sd.metricRow('Tujuan', d.purpose ?? '—');
  sd.metricRow('Estimasi VO Tagih', fmtRp(d.grand_total_est_cost ?? 0), { valueColor: C.critical });
  sd.metricRow('Jumlah VO Terkait Klien', String(d.vo_charges?.items?.length ?? 0));
  sd.metricRow('Support Progress Entries', String(d.progress_support?.total_entries ?? 0));

  if ((d.vo_charges?.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('VO Tagihan Klien');
    sd.table(
      [
        { header: 'Tgl', width: 0.08 },
        { header: 'Lokasi', width: 0.14 },
        { header: 'Deskripsi', width: 0.26 },
        { header: 'Pemohon', width: 0.13 },
        { header: 'Penyebab', width: 0.11 },
        { header: 'Est. Biaya', width: 0.14, align: 'right' },
        { header: 'Status', width: 0.14 },
      ],
      (d.vo_charges.items ?? []).map((item) => [
        fmtDateShort(item.created_at),
        item.location ?? '—',
        item.description ?? '—',
        item.requested_by_name ?? '—',
        (item.cause ?? '—').replace(/_/g, ' '),
        item.est_cost != null ? fmtRp(item.est_cost) : '—',
        (item.status ?? '—').replace(/_/g, ' '),
      ]),
    );
  }

  if ((d.progress_support?.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Support Progress');
    sd.table(
      [
        { header: 'Tgl', width: 0.08 },
        { header: 'Pelapor', width: 0.14 },
        { header: 'Kode', width: 0.09 },
        { header: 'Item', width: 0.22 },
        { header: 'Qty', width: 0.07, align: 'right' },
        { header: 'Sat.', width: 0.06 },
        { header: 'Lokasi', width: 0.14 },
        { header: 'Catatan', width: 0.20 },
      ],
      (d.progress_support.items ?? []).slice(0, 80).map((item) => [
        fmtDateShort(item.created_at),
        item.reporter_name ?? '—',
        item.boq_code ?? '—',
        item.boq_label ?? '—',
        String(item.quantity ?? 0),
        item.unit ?? '—',
        item.location ?? '—',
        item.note ?? '—',
      ]),
    );
  }
}

async function buildAuditList(sd: SanoDoc, d: AuditListData): Promise<void> {
  sd.kpiRow([
    { value: String(d.anomalies?.total ?? 0), label: 'Total Anomali', color: C.warning },
    { value: String(d.audit_cases?.total ?? 0), label: 'Audit Case', color: C.info },
    { value: String(d.audit_cases?.open ?? 0), label: 'Case Open', color: C.critical },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total Anomali', String(d.anomalies?.total ?? 0));
  sd.metricRow('Total Audit Case', String(d.audit_cases?.total ?? 0));
  sd.metricRow('Audit Case Open', String(d.audit_cases?.open ?? 0), { valueColor: C.critical });

  if ((d.anomalies?.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Anomali');
    sd.table(
      [
        { header: 'Tanggal', width: 0.12 },
        { header: 'Event', width: 0.16 },
        { header: 'Entity', width: 0.12 },
        { header: 'Entity ID', width: 0.18 },
        { header: 'Severity', width: 0.12 },
        { header: 'Deskripsi', width: 0.30 },
      ],
      (d.anomalies.items ?? []).map((item) => [
        fmtDate(item.created_at),
        item.event_type ?? '—',
        item.entity_type ?? '—',
        item.entity_id ?? '—',
        item.severity ?? '—',
        item.description ?? '—',
      ]),
    );
  }

  if ((d.audit_cases?.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Audit Case');
    sd.table(
      [
        { header: 'Tanggal', width: 0.14 },
        { header: 'Trigger', width: 0.18 },
        { header: 'Entity', width: 0.14 },
        { header: 'Entity ID', width: 0.18 },
        { header: 'Status', width: 0.14 },
        { header: 'Catatan', width: 0.22 },
      ],
      (d.audit_cases.items ?? []).map((item) => [
        fmtDate(item.created_at),
        item.trigger_type ?? '—',
        item.entity_type ?? '—',
        item.entity_id ?? '—',
        (item.status ?? '—').replace(/_/g, ' '),
        item.notes ?? '—',
      ]),
    );
  }
}

async function buildAIUsageSummary(sd: SanoDoc, d: AIUsageData): Promise<void> {
  sd.kpiRow([
    { value: String(d.summary.total_interactions ?? 0), label: 'Total Chat', color: C.info },
    { value: String(d.summary.active_users ?? 0), label: 'User Aktif', color: C.ok },
    { value: `${Math.round((d.summary.total_tokens ?? 0) / 1000)}k`, label: 'Total Token', color: C.accent },
  ]);

  sd.sectionTitle('Ringkasan Penggunaan AI');
  sd.metricRow('Total Chat (30 hari)', String(d.summary.total_interactions ?? 0));
  sd.metricRow('User Aktif', String(d.summary.active_users ?? 0));
  sd.metricRow('Total Token', `${Math.round((d.summary.total_tokens ?? 0) / 1000)}k`);
  sd.metricRow('Chat Sonnet', String(d.summary.sonnet_count ?? 0));

  if ((d.users ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Penggunaan per User');
    sd.table(
      [
        { header: 'User', width: 0.30 },
        { header: 'Jumlah Chat', width: 0.20, align: 'right' },
        { header: 'Total Token', width: 0.25, align: 'right' },
        { header: 'Chat Sonnet', width: 0.25, align: 'right' },
      ],
      (d.users ?? []).map((u) => [
        u.full_name ?? '—',
        String(u.interaction_count ?? 0),
        String(u.total_tokens ?? 0),
        String(u.sonnet_count ?? 0),
      ]),
    );
  }

  if ((d.usage_by_day ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Tren Harian');
    sd.table(
      [
        { header: 'Tanggal', width: 0.30 },
        { header: 'Jumlah Chat', width: 0.35, align: 'right' },
        { header: 'Token', width: 0.35, align: 'right' },
      ],
      (d.usage_by_day ?? []).slice(0, 30).map((row) => [
        fmtDate(row.date),
        String(row.interaction_count ?? 0),
        String(row.total_tokens ?? 0),
      ]),
    );
  }
}

async function buildApprovalSLAUser(sd: SanoDoc, d: ApprovalSLAData): Promise<void> {
  sd.kpiRow([
    { value: String(d.summary.pending_items ?? 0), label: 'Total Queued', color: C.info },
    { value: String(d.summary.avg_hours ?? 0), label: 'Avg Hours', color: C.accent },
    { value: String(d.summary.over_24h ?? 0), label: 'SLA Breached', color: C.critical },
  ]);

  sd.sectionTitle('Ringkasan SLA Approval');
  sd.metricRow('Total Di-Queue', String(d.summary.pending_items ?? 0));
  sd.metricRow('Rata-rata Jam Respons', String(d.summary.avg_hours ?? 0));
  sd.metricRow('SLA Breach', String(d.summary.over_24h ?? 0), { valueColor: C.critical });

  if ((d.users ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('SLA per User');
    sd.table(
      [
        { header: 'User', width: 0.25 },
        { header: 'Queued', width: 0.15, align: 'right' },
        { header: 'Approved', width: 0.15, align: 'right' },
        { header: 'Rejected', width: 0.15, align: 'right' },
        { header: 'Avg Hours', width: 0.15, align: 'right' },
        { header: 'Breach', width: 0.15, align: 'right' },
      ],
      (d.users ?? []).map((u) => [
        u.full_name ?? '—',
        String(u.assigned_pending ?? 0),
        String(u.handled_events ?? 0),
        String(u.over_24h ?? 0),
        String(u.avg_hours ?? 0),
        String(u.over_24h ?? 0),
      ]),
    );
  }
}

async function buildOperationalEntryDiscipline(sd: SanoDoc, d: OperationalDisciplineData): Promise<void> {
  sd.kpiRow([
    { value: fmtPct(d.summary.photo_coverage_pct ?? 0), label: 'Foto Coverage', color: C.accent },
    { value: String(d.summary.total_entries ?? 0), label: 'Total Entri', color: C.info },
    { value: String(d.summary.photo_backed_entries ?? 0), label: 'Dengan Foto', color: C.ok },
  ]);

  sd.sectionTitle('Disiplin Entry Operasional');
  sd.metricRow('Total Entri', String(d.summary.total_entries ?? 0));
  sd.metricRow('Entri dengan Foto', String(d.summary.photo_backed_entries ?? 0), { valueColor: C.ok });
  sd.metricRow('Photo Coverage', fmtPct(d.summary.photo_coverage_pct ?? 0));
  sd.gap(4);
  sd.progressBar(d.summary.photo_coverage_pct ?? 0, { label: `Foto coverage: ${fmtPct(d.summary.photo_coverage_pct ?? 0)}` });

  if ((d.users ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Coverage per User');
    sd.table(
      [
        { header: 'User', width: 0.30 },
        { header: 'Total Entri', width: 0.20, align: 'right' },
        { header: 'Coverage', width: 0.25, align: 'right' },
        { header: 'Hari Aktif', width: 0.25, align: 'right' },
      ],
      (d.users ?? []).map((u) => [
        u.full_name ?? '—',
        String(u.total_entries ?? 0),
        fmtPct(u.photo_coverage_pct ?? 0),
        String(u.active_days ?? 0),
      ]),
    );
  }
}

async function buildToolUsageSummary(sd: SanoDoc, d: ToolUsageData): Promise<void> {
  sd.kpiRow([
    { value: String(d.summary.total_exports ?? 0), label: 'Total Export', color: C.info },
    { value: String(d.summary.total_ai_chats ?? 0), label: 'AI Chat', color: C.accent },
    { value: String(d.summary.export_users ?? 0), label: 'User Export', color: C.ok },
  ]);

  sd.sectionTitle('Penggunaan Laporan & AI');
  sd.metricRow('Total Export Laporan', String(d.summary.total_exports ?? 0));
  sd.metricRow('Total AI Chat', String(d.summary.total_ai_chats ?? 0));
  sd.metricRow('User yang Pernah Export', String(d.summary.export_users ?? 0));

  if ((d.top_report_types ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Export per Tipe Laporan');
    sd.table(
      [
        { header: 'Tipe Laporan', width: 0.50 },
        { header: 'Jumlah Export', width: 0.50, align: 'right' },
      ],
      (d.top_report_types ?? []).map((r) => [
        r.report_type ?? '—',
        String(r.count ?? 0),
      ]),
    );
  }
}

async function buildExceptionHandlingLoad(sd: SanoDoc, d: ExceptionHandlingData): Promise<void> {
  sd.kpiRow([
    { value: String(d.summary.auto_hold_requests ?? 0), label: 'Hold', color: C.warning },
    { value: String((d.summary.rejected_requests ?? 0) + (d.summary.rejected_vo ?? 0) + (d.summary.rejected_mtn ?? 0)), label: 'Reject', color: C.critical },
    { value: String(d.summary.hold_reject_override_actions ?? 0), label: 'Override', color: C.info },
  ]);

  sd.sectionTitle('Beban Penanganan Exception');
  sd.metricRow('Total Hold', String(d.summary.auto_hold_requests ?? 0), { valueColor: C.warning });
  sd.metricRow('Total Reject', String((d.summary.rejected_requests ?? 0) + (d.summary.rejected_vo ?? 0) + (d.summary.rejected_mtn ?? 0)), { valueColor: C.critical });
  sd.metricRow('Total Override', String(d.summary.hold_reject_override_actions ?? 0));

  if ((d.anomaly_breakdown ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Anomali per Tipe');
    sd.table(
      [
        { header: 'Tipe Anomali', width: 0.40 },
        { header: 'Jumlah', width: 0.30, align: 'right' },
        { header: 'Severity Avg', width: 0.30, align: 'right' },
      ],
      (d.anomaly_breakdown ?? []).map((a) => [
        a.event_type ?? '—',
        String(a.count ?? 0),
        '—',
      ]),
    );
  }

  if ((d.users ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Beban per User');
    sd.table(
      [
        { header: 'User', width: 0.30 },
        { header: 'Hold', width: 0.17, align: 'right' },
        { header: 'Reject', width: 0.18, align: 'right' },
        { header: 'Override', width: 0.18, align: 'right' },
        { header: 'Total', width: 0.17, align: 'right' },
      ],
      (d.users ?? []).map((u) => [
        u.full_name ?? '—',
        String(u.generated_count ?? 0),
        String(u.handled_count ?? 0),
        String(u.hold_reject_override ?? 0),
        String((u.generated_count ?? 0) + (u.handled_count ?? 0) + (u.hold_reject_override ?? 0)),
      ]),
    );
  }
}

// ── Site Change Log ───────────────────────────────────────────────────

async function buildSiteChangeLog(sd: SanoDoc, d: SiteChangeLogData): Promise<void> {
  const s = d.summary ?? {};

  sd.kpiRow([
    { value: String(s.total_items ?? 0), label: 'Total', color: C.info },
    { value: String(s.pending ?? 0), label: 'Pending', color: C.warning },
    { value: String(s.impact_berat ?? 0), label: 'Berat', color: C.critical },
    { value: String(s.selesai ?? 0), label: 'Selesai', color: C.ok },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total Perubahan', String(s.total_items ?? 0));
  sd.metricRow('Pending', String(s.pending ?? 0), { valueColor: C.warning });
  sd.metricRow('Disetujui', String(s.disetujui ?? 0), { valueColor: C.info });
  sd.metricRow('Ditolak', String(s.ditolak ?? 0), { valueColor: C.critical });
  sd.metricRow('Selesai', String(s.selesai ?? 0), { valueColor: C.ok });
  sd.metricRow('Urgent', String(s.urgent ?? 0), { valueColor: C.critical });
  sd.metricRow('Impact Berat', String(s.impact_berat ?? 0), { valueColor: C.critical });
  sd.metricRow('Open Rework', String(s.open_rework ?? 0), { valueColor: C.warning });
  if (d.show_costs && s.approved_cost_total != null) {
    sd.metricRow('Biaya Disetujui', fmtRp(s.approved_cost_total));
  }

  // By type breakdown
  if ((d.by_type ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Per Jenis');
    sd.table(
      [
        { header: 'Jenis Perubahan', width: 0.60 },
        { header: 'Jumlah', width: 0.40, align: 'right' },
      ],
      (d.by_type ?? []).map((t) => [t.label ?? t.change_type ?? '—', String(t.count ?? 0)]),
    );
  }

  // By decision breakdown
  if ((d.by_decision ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Per Keputusan');
    sd.table(
      [
        { header: 'Keputusan', width: 0.60 },
        { header: 'Jumlah', width: 0.40, align: 'right' },
      ],
      (d.by_decision ?? []).map((t) => [t.label ?? t.decision ?? '—', String(t.count ?? 0)]),
    );
  }

  // Item detail table
  if ((d.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Daftar Perubahan');

    const showCosts = Boolean(d.show_costs);
    const cols = [
      { header: 'Tgl', width: 0.08 },
      { header: 'Lokasi', width: 0.14 },
      { header: 'Deskripsi', width: showCosts ? 0.26 : 0.36 },
      { header: 'Jenis', width: 0.13 },
      { header: 'Impact', width: 0.08 },
      { header: 'Keputusan', width: 0.10 },
      ...(showCosts ? [{ header: 'Est. Biaya', width: 0.11, align: 'right' as const }] : []),
      { header: 'Pelapor', width: 0.10 },
    ];

    sd.table(
      cols,
      (d.items ?? []).map((item) => {
        const row = [
          fmtDateShort(item.created_at),
          item.location ?? '—',
          item.description ?? '—',
          item.change_type_label ?? item.change_type ?? '—',
          (item.impact_label ?? item.impact ?? '—') + (item.is_urgent ? ' [!]' : ''),
          item.decision_label ?? item.decision ?? '—',
        ];
        if (showCosts) row.push(item.est_cost != null ? fmtRp(item.est_cost) : '—');
        row.push(item.reporter_name ?? '—');
        return row;
      }),
    );
  }

  // Photos
  const allPhotoUrls = (d.items ?? []).flatMap((item) =>
    (item.photos ?? []).map((p) => p.photo_url ?? p.storage_path),
  ).filter(Boolean).slice(0, 16);

  if (allPhotoUrls.length > 0) {
    sd.gap(6);
    sd.sectionTitle(`Lampiran Foto (${allPhotoUrls.length})`);
    await sd.photoGrid(allPhotoUrls, { size: 110, perRow: 4 });
  }
}

// forward declarations populated below
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous builder map requires flexible data param
const BUILDERS: Partial<Record<string, (sd: SanoDoc, d: any) => Promise<void>>> = {};
type AnyReportData = ProgressSummaryData | MaterialBalanceData | ReceiptLogData | SiteChangeLogData | ScheduleVarianceData | WeeklyDigestData | PayrollSupportData | ClientChargeData | AuditListData | AIUsageData | ApprovalSLAData | OperationalDisciplineData | ToolUsageData | ExceptionHandlingData;

BUILDERS['progress_summary'] = buildProgressSummary;
BUILDERS['material_balance'] = buildMaterialBalance;
BUILDERS['receipt_log'] = buildReceiptLog;
BUILDERS['schedule_variance'] = buildScheduleVariance;
BUILDERS['weekly_digest'] = buildWeeklyDigest;
BUILDERS['payroll_support_summary'] = buildPayrollSupportSummary;
BUILDERS['client_charge_report'] = buildClientChargeReport;
BUILDERS['audit_list'] = buildAuditList;
BUILDERS['ai_usage_summary'] = buildAIUsageSummary;
BUILDERS['approval_sla_user'] = buildApprovalSLAUser;
BUILDERS['operational_entry_discipline'] = buildOperationalEntryDiscipline;
BUILDERS['tool_usage_summary'] = buildToolUsageSummary;
BUILDERS['exception_handling_load'] = buildExceptionHandlingLoad;
BUILDERS['site_change_log'] = buildSiteChangeLog;

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

  switch (payload.type) {
    case 'progress_summary':
      await buildProgressSummary(sd, payload.data as ProgressSummaryData);
      break;
    case 'material_balance':
      await buildMaterialBalance(sd, payload.data as MaterialBalanceData);
      break;
    case 'receipt_log':
      await buildReceiptLog(sd, payload.data as ReceiptLogData);
      break;
    case 'site_change_log':
      await buildSiteChangeLog(sd, payload.data as SiteChangeLogData);
      break;
    case 'schedule_variance':
      await buildScheduleVariance(sd, payload.data as ScheduleVarianceData);
      break;
    case 'weekly_digest':
      await buildWeeklyDigest(sd, payload.data as WeeklyDigestData);
      break;
    case 'payroll_support_summary':
      await buildPayrollSupportSummary(sd, payload.data as PayrollSupportData);
      break;
    case 'client_charge_report':
      await buildClientChargeReport(sd, payload.data as ClientChargeData);
      break;
    case 'audit_list':
      await buildAuditList(sd, payload.data as AuditListData);
      break;
    case 'ai_usage_summary':
      await buildAIUsageSummary(sd, payload.data as AIUsageData);
      break;
    case 'approval_sla_user':
      await buildApprovalSLAUser(sd, payload.data as ApprovalSLAData);
      break;
    case 'operational_entry_discipline':
      await buildOperationalEntryDiscipline(sd, payload.data as OperationalDisciplineData);
      break;
    case 'tool_usage_summary':
      await buildToolUsageSummary(sd, payload.data as ToolUsageData);
      break;
    case 'exception_handling_load':
      await buildExceptionHandlingLoad(sd, payload.data as ExceptionHandlingData);
      break;
    default:
      // Fallback: render raw JSON preview
      sd.sectionTitle('Data Laporan');
      sd.text(JSON.stringify(payload.data, null, 2).substring(0, 3000), { size: FS.xs });
  }

  const pdfBytes = await sd.save();
  const fileName = `SANO_${payload.type}_${new Date().toISOString().slice(0, 10)}.pdf`;

  if (Platform.OS === 'web') {
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
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
