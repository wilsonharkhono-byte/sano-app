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

async function buildPunchList(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_defects ?? 0), label: 'Total Cacat', color: C.info },
    { value: String(d.critical_open ?? 0), label: 'Critical Open', color: C.critical },
    { value: String(d.major_open ?? 0), label: 'Major Open', color: C.warning },
    { value: String(d.minor_open ?? 0), label: 'Minor Open', color: C.accent },
  ]);

  // Handover eligibility
  sd.gap(4);
  const eligible = d.handover_eligible;
  sd.metricRow(
    'Status Serah Terima',
    eligible ? 'ELIGIBLE' : 'BELUM ELIGIBLE',
    { valueColor: eligible ? C.ok : C.critical },
  );

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total Cacat', String(d.total_defects ?? 0));
  sd.metricRow('Masih Open', String(d.open ?? 0), { valueColor: C.warning });
  sd.metricRow('Critical Open', String(d.critical_open ?? 0), { valueColor: C.critical });
  sd.metricRow('Major Open', String(d.major_open ?? 0), { valueColor: C.warning });

  if ((d.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Daftar Cacat');
    sd.table(
      [
        { header: 'Deskripsi', width: 0.28 },
        { header: 'Lokasi', width: 0.15 },
        { header: 'BoQ Ref', width: 0.12 },
        { header: 'Severity', width: 0.12 },
        { header: 'Status', width: 0.15 },
        { header: 'PIC', width: 0.10 },
        { header: 'Tanggal', width: 0.08 },
      ],
      (d.items ?? []).map((item: any) => [
        item.description ?? '—',
        item.location ?? '—',
        item.boq_ref ?? '—',
        item.severity ?? '—',
        (item.status ?? '—').replace(/_/g, ' '),
        item.responsible_party ?? '—',
        fmtDate(item.reported_at),
      ]),
    );
  }

  // Photos
  const photoUrls = (d.items ?? []).flatMap((item: any) => [
    ...(item.report_photos ?? []).map((p: any) => p.photo_url),
    ...(item.repair_photos ?? []).map((p: any) => p.photo_url),
  ]).slice(0, 16);
  if (photoUrls.length > 0) {
    sd.gap(6);
    sd.sectionTitle('Lampiran Foto');
    await sd.photoGrid(photoUrls, { size: 100, perRow: 4 });
  }
}

async function buildVoSummary(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_vos ?? 0), label: 'Total VO', color: C.info },
    { value: String(d.total_reworks ?? 0), label: 'Total Rework', color: C.warning },
    { value: fmtRp(d.total_est_cost ?? 0), label: 'Est. Biaya VO', color: C.critical },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total VO', String(d.total_vos ?? 0));
  sd.metricRow('Total Rework', String(d.total_reworks ?? 0));
  sd.metricRow('Estimasi Biaya VO', fmtRp(d.total_est_cost ?? 0), { valueColor: C.critical });
  sd.metricRow('Estimasi Dampak Rework', fmtRp(d.total_rework_cost ?? 0), { valueColor: C.warning });

  // By cause breakdown
  if (d.by_cause) {
    sd.gap(6);
    sd.sectionTitle('Distribusi Penyebab');
    Object.entries(d.by_cause).forEach(([cause, count]: any) => {
      sd.metricRow(cause.replace(/_/g, ' '), String(count));
    });
  }

  // VO table
  if ((d.vos ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Daftar VO');
    sd.table(
      [
        { header: 'No. VO', width: 0.09 },
        { header: 'Tanggal', width: 0.10 },
        { header: 'Lokasi', width: 0.15 },
        { header: 'Deskripsi', width: 0.22 },
        { header: 'Pemohon', width: 0.12 },
        { header: 'Est. Biaya', width: 0.14, align: 'right' },
        { header: 'Status', width: 0.10 },
        { header: 'Tipe', width: 0.08 },
      ],
      (d.vos ?? []).map((v: any) => [
        v.entry_code ?? 'VO-000',
        fmtDate(v.created_at),
        v.location ?? '—',
        v.description ?? '—',
        v.requested_by_name ?? '—',
        v.est_cost != null ? fmtRp(v.est_cost) : '—',
        (v.status ?? '—').replace(/_/g, ' '),
        v.is_micro ? 'Mikro' : 'Standar',
      ]),
    );
  }

  // Rework table
  if ((d.reworks ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Daftar Rework');
    sd.table(
      [
        { header: 'No. RE', width: 0.10 },
        { header: 'Tanggal', width: 0.10 },
        { header: 'Kode BoQ', width: 0.12 },
        { header: 'Item BoQ', width: 0.20 },
        { header: 'Deskripsi', width: 0.20 },
        { header: 'Penyebab', width: 0.14 },
        { header: 'Biaya', width: 0.14, align: 'right' },
      ],
      (d.reworks ?? []).map((r: any) => [
        r.entry_code ?? 'RE-000',
        fmtDate(r.created_at),
        r.boq_code ?? '—',
        r.boq_label ?? '—',
        r.description ?? '—',
        (r.cause ?? '—').replace(/_/g, ' '),
        r.cost_impact != null ? fmtRp(r.cost_impact) : '—',
      ]),
    );
  }

  // Photos (VO + rework combined)
  const photoUrls = [
    ...(d.vos ?? []).flatMap((v: any) => (v.photos ?? []).map((p: any) => p.photo_url)),
    ...(d.reworks ?? []).flatMap((r: any) => (r.photos ?? []).map((p: any) => p.photo_url)),
  ].slice(0, 16);
  if (photoUrls.length > 0) {
    sd.gap(6);
    sd.sectionTitle('Lampiran Foto');
    await sd.photoGrid(photoUrls, { size: 100, perRow: 4 });
  }
}

async function buildScheduleVariance(sd: SanoDoc, d: any): Promise<void> {
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
      (d.milestones ?? []).map((m: any) => [
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

async function buildWeeklyDigest(sd: SanoDoc, d: any): Promise<void> {
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
    Object.entries(d.by_flag).forEach(([flag, count]: any) => {
      const color = flag === 'CRITICAL' ? C.critical : flag === 'WARNING' ? C.warning : flag === 'OK' ? C.ok : C.info;
      sd.metricRow(flag, String(count), { valueColor: color });
    });
  }

  if (d.by_type) {
    sd.gap(6);
    sd.sectionTitle('Aktivitas per Tipe');
    Object.entries(d.by_type).forEach(([type, count]: any) => {
      sd.metricRow(type, String(count));
    });
  }
}

async function buildPayrollSupportSummary(sd: SanoDoc, d: any): Promise<void> {
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
      (d.by_reporter ?? []).map((g: any) => [
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
        { header: 'Tanggal', width: 0.12 },
        { header: 'Pelapor', width: 0.15 },
        { header: 'Kode BoQ', width: 0.10 },
        { header: 'Item', width: 0.20 },
        { header: 'Qty', width: 0.08, align: 'right' },
        { header: 'Satuan', width: 0.08 },
        { header: 'Lokasi', width: 0.12 },
        { header: 'Catatan', width: 0.15 },
      ],
      (d.entries ?? []).slice(0, 100).map((e: any) => [
        fmtDate(e.created_at),
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

async function buildClientChargeReport(sd: SanoDoc, d: any): Promise<void> {
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
        { header: 'Tanggal', width: 0.10 },
        { header: 'Lokasi', width: 0.15 },
        { header: 'Deskripsi', width: 0.22 },
        { header: 'Pemohon', width: 0.13 },
        { header: 'Penyebab', width: 0.12 },
        { header: 'Est. Biaya', width: 0.14, align: 'right' },
        { header: 'Status', width: 0.14 },
      ],
      (d.vo_charges.items ?? []).map((item: any) => [
        fmtDate(item.created_at),
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
        { header: 'Tanggal', width: 0.12 },
        { header: 'Pelapor', width: 0.15 },
        { header: 'Kode BoQ', width: 0.12 },
        { header: 'Item', width: 0.22 },
        { header: 'Qty', width: 0.10, align: 'right' },
        { header: 'Satuan', width: 0.08 },
        { header: 'Lokasi', width: 0.12 },
        { header: 'Catatan', width: 0.09 },
      ],
      (d.progress_support.items ?? []).slice(0, 80).map((item: any) => [
        fmtDate(item.created_at),
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

async function buildAuditList(sd: SanoDoc, d: any): Promise<void> {
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
      (d.anomalies.items ?? []).map((item: any) => [
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
      (d.audit_cases.items ?? []).map((item: any) => [
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

// (builders defined in subsequent tasks — see Tasks 5–10)

// forward declarations populated below
const BUILDERS: Partial<Record<string, (sd: SanoDoc, d: any) => Promise<void>>> = {};

BUILDERS['progress_summary'] = buildProgressSummary;
BUILDERS['material_balance'] = buildMaterialBalance;
BUILDERS['receipt_log'] = buildReceiptLog;
BUILDERS['punch_list'] = buildPunchList;
BUILDERS['vo_summary'] = buildVoSummary;
BUILDERS['schedule_variance'] = buildScheduleVariance;
BUILDERS['weekly_digest'] = buildWeeklyDigest;
BUILDERS['payroll_support_summary'] = buildPayrollSupportSummary;
BUILDERS['client_charge_report'] = buildClientChargeReport;
BUILDERS['audit_list'] = buildAuditList;

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
