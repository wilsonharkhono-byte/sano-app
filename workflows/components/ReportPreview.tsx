import React from 'react';
import { View, Text, Image } from 'react-native';
import { COLORS } from '../theme';
import type { ReportPayload } from '../../tools/reports';

function RRow({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)' }}>
      <Text style={{ fontSize: 13, color: COLORS.textSec, flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: color ?? COLORS.text }}>{String(value)}</Text>
    </View>
  );
}

function SLabel({ children }: { children: string }) {
  return (
    <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: COLORS.textSec, marginTop: 14, marginBottom: 6 }}>
      {children}
    </Text>
  );
}

function PhotoGrid({ photos }: { photos: Array<{ photo_url: string; storage_path?: string }> }) {
  if (!photos.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      {photos.map((photo, index) => (
        <View
          key={`${photo.storage_path ?? photo.photo_url}-${index}`}
          style={{
            width: 86,
            height: 86,
            borderRadius: 10,
            backgroundColor: '#ECE7DE',
            borderWidth: 1,
            borderColor: 'rgba(148,148,148,0.18)',
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 6,
          }}
        >
          <Image source={{ uri: photo.photo_url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
        </View>
      ))}
    </View>
  );
}

export function ReportPreview({ payload }: { payload: ReportPayload }) {
  const d = payload.data as any;

  if (payload.type === 'progress_summary') {
    return (
      <>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Progress Keseluruhan" value={`${d.overall_progress}%`} color={COLORS.accent} />
        <RRow label="Total Item BoQ" value={d.total_items} />
        <RRow label="Selesai" value={d.completed_items} color={COLORS.ok} />
        <RRow label="Sedang Berjalan" value={d.in_progress_items} color={COLORS.warning} />
        <RRow label="Belum Mulai" value={d.not_started_items} />
        <SLabel>Detail per Item</SLabel>
        {(d.items ?? []).map((item: any, i: number) => (
          <View key={i} style={{ marginBottom: 10 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{item.code} — {item.label}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Text style={{ fontSize: 12, color: COLORS.textSec, flex: 1 }}>
                Terpasang: {item.installed} / {item.planned} {item.unit}
              </Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: item.progress >= 100 ? COLORS.ok : item.progress > 0 ? COLORS.warning : COLORS.textSec }}>
                {item.progress}%
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: 'rgba(0,0,0,0.07)', borderRadius: 3, marginTop: 4 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: item.progress >= 100 ? COLORS.ok : COLORS.accent, width: `${Math.min(100, item.progress)}%` as any }} />
            </View>
          </View>
        ))}
        <SLabel>Lampiran Progres Terbaru</SLabel>
        {(d.entries ?? [])
          .filter((entry: any) => (entry.photos ?? []).length > 0)
          .slice(0, 5)
          .map((entry: any, i: number) => (
            <View key={i} style={{ marginBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: '600' }}>{entry.boq_code} — {entry.boq_label}</Text>
              <Text style={{ fontSize: 12, color: COLORS.textSec }}>
                {entry.created_at ? new Date(entry.created_at).toLocaleDateString('id-ID') : '—'} · {entry.quantity} {entry.unit}
                {entry.location ? ` · ${entry.location}` : ''}
              </Text>
              <PhotoGrid photos={entry.photos ?? []} />
            </View>
          ))}
      </>
    );
  }

  if (payload.type === 'material_balance') {
    return (
      <>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Total Material" value={d.total_materials} />
        <RRow label="Over-Received" value={d.over_received} color={COLORS.warning} />
        <RRow label="Under-Received" value={d.under_received} color={COLORS.critical} />
        <SLabel>Detail Material</SLabel>
        {(d.balances ?? []).map((b: any, i: number) => (
          <View key={i} style={{ marginBottom: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{b.material_name ?? b.name ?? '—'}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              Rencana: {b.planned ?? 0} {b.unit} · Diterima: {b.received ?? b.total_received ?? 0} {b.unit}
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              Terpasang: {b.installed ?? 0} {b.unit} · Saldo: {b.on_site ?? 0} {b.unit}
            </Text>
          </View>
        ))}
        {(d.balances ?? []).length === 0 && (
          <Text style={{ fontSize: 13, color: COLORS.textSec }}>Belum ada data material balance yang bisa dihitung untuk proyek ini.</Text>
        )}
      </>
    );
  }

  if (payload.type === 'receipt_log') {
    return (
      <>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Total PO" value={d.total_pos} />
        <RRow label="Fully Received" value={d.fully_received} color={COLORS.ok} />
        <SLabel>Log Penerimaan</SLabel>
        {(d.entries ?? []).map((e: any, i: number) => (
          <View key={i} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{e.material}</Text>
            <Text style={{ fontSize: 12, color: COLORS.primary, fontWeight: '700' }}>{e.po_number ?? e.po_ref ?? '—'}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>{e.supplier}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <Text style={{ fontSize: 12 }}>Diterima: {e.received_qty} / {e.ordered_qty} {e.unit}</Text>
              <Text style={{ fontSize: 12, fontWeight: '600', color: e.status === 'FULLY_RECEIVED' ? COLORS.ok : e.status === 'OPEN' ? COLORS.textSec : COLORS.warning }}>
                {e.status.replace(/_/g, ' ')}
              </Text>
            </View>
          </View>
        ))}
        <SLabel>Bukti Penerimaan Terbaru</SLabel>
        {(d.receipts ?? [])
          .filter((receipt: any) => (receipt.photos ?? []).length > 0)
          .slice(0, 5)
          .map((receipt: any, i: number) => (
            <View key={i} style={{ marginBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: '600' }}>{receipt.material_name}</Text>
              <Text style={{ fontSize: 12, color: COLORS.textSec }}>
                {receipt.po_number ?? receipt.po_ref ?? '—'} ·
                {' '}
                {receipt.created_at ? new Date(receipt.created_at).toLocaleDateString('id-ID') : '—'} · {receipt.quantity_actual} {receipt.unit}
                {receipt.vehicle_ref ? ` · ${receipt.vehicle_ref}` : ''}
              </Text>
              <PhotoGrid photos={receipt.photos ?? []} />
            </View>
          ))}
        {(d.entries ?? []).length === 0 && <Text style={{ fontSize: 13, color: COLORS.textSec }}>Belum ada PO atau penerimaan.</Text>}
      </>
    );
  }

  if (payload.type === 'site_change_log') {
    const formatRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
    const showCosts = Boolean(d.show_costs);
    return (
      <>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Total Catatan" value={d.summary?.total_items ?? 0} />
        <RRow label="Pending" value={d.summary?.pending ?? 0} color={(d.summary?.pending ?? 0) > 0 ? COLORS.warning : COLORS.ok} />
        <RRow label="Disetujui" value={d.summary?.disetujui ?? 0} color={COLORS.info} />
        <RRow label="Ditolak" value={d.summary?.ditolak ?? 0} color={COLORS.critical} />
        <RRow label="Selesai" value={d.summary?.selesai ?? 0} color={COLORS.ok} />
        <RRow label="Urgent" value={d.summary?.urgent ?? 0} color={(d.summary?.urgent ?? 0) > 0 ? COLORS.critical : undefined} />
        <RRow label="Impact Berat" value={d.summary?.impact_berat ?? 0} color={(d.summary?.impact_berat ?? 0) > 0 ? COLORS.warning : undefined} />
        <RRow label="Rework Belum Selesai" value={d.summary?.open_rework ?? 0} color={(d.summary?.open_rework ?? 0) > 0 ? COLORS.warning : undefined} />
        <RRow label="Catatan Mutu Open" value={d.summary?.open_quality_notes ?? 0} color={(d.summary?.open_quality_notes ?? 0) > 0 ? COLORS.warning : undefined} />
        {showCosts && d.summary?.approved_cost_total != null ? (
          <RRow label="Biaya Disetujui" value={formatRp(d.summary.approved_cost_total)} color={COLORS.warning} />
        ) : null}
        {(d.by_type ?? []).length > 0 && (
          <>
            <SLabel>Jenis Perubahan</SLabel>
            {(d.by_type ?? []).map((row: any, index: number) => (
              <RRow key={index} label={row.label ?? row.change_type} value={row.count} />
            ))}
          </>
        )}
        <SLabel>Daftar Catatan</SLabel>
        {(d.items ?? []).map((item: any, i: number) => (
          <View key={i} style={{ marginBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', flex: 1 }}>{item.description}</Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: item.decision === 'ditolak' ? COLORS.critical : item.decision === 'pending' ? COLORS.warning : item.decision === 'selesai' ? COLORS.ok : COLORS.info }}>
                {item.decision_label}
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              {item.change_type_label} · {item.location}
              {item.boq_code ? ` · ${item.boq_code}` : ''}
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              Impact: {item.impact_label}
              {item.reporter_name ? ` · ${item.reporter_name}` : ''}
              {item.mandor_name ? ` · ${item.mandor_name}` : ''}
            </Text>
            {(item.flags ?? []).length > 0 ? (
              <Text style={{ fontSize: 12, color: COLORS.warning, marginTop: 2 }}>
                Flag: {(item.flags ?? []).join(' · ')}
              </Text>
            ) : null}
            {showCosts && item.est_cost != null ? (
              <Text style={{ fontSize: 12, color: COLORS.textSec, marginTop: 2 }}>
                Estimasi: {formatRp(item.est_cost)}
                {item.cost_bearer_label ? ` · Beban: ${item.cost_bearer_label}` : ''}
              </Text>
            ) : null}
            {item.estimator_note ? (
              <Text style={{ fontSize: 12, color: COLORS.textSec, marginTop: 2 }}>Catatan review: {item.estimator_note}</Text>
            ) : null}
            {(item.photos ?? []).length > 0 ? <PhotoGrid photos={item.photos} /> : null}
          </View>
        ))}
        {(d.items ?? []).length === 0 && <Text style={{ fontSize: 13, color: COLORS.textSec }}>Belum ada catatan perubahan pada proyek ini.</Text>}
      </>
    );
  }

  if (payload.type === 'schedule_variance') {
    const statusColor = (s: string) =>
      s === 'ON_TRACK' || s === 'AHEAD' ? COLORS.ok : s === 'AT_RISK' ? COLORS.warning : COLORS.critical;
    return (
      <>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Total Milestone" value={d.total_milestones} />
        <RRow label="On Track / Ahead" value={d.on_track} color={COLORS.ok} />
        <RRow label="At Risk" value={d.at_risk} color={COLORS.warning} />
        <RRow label="Delayed" value={d.delayed} color={COLORS.critical} />
        <SLabel>Detail Milestone</SLabel>
        {(d.milestones ?? []).map((m: any, i: number) => (
          <View key={i} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', flex: 1 }}>{m.label}</Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: statusColor(m.status) }}>{m.status.replace(/_/g, ' ')}</Text>
            </View>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              Target: {new Date(m.planned_date).toLocaleDateString('id-ID')}
              {m.days_remaining >= 0 ? ` · ${m.days_remaining} hari lagi` : ` · terlambat ${Math.abs(m.days_remaining)} hari`}
            </Text>
            {m.revised_date ? <Text style={{ fontSize: 12, color: COLORS.warning }}>Revisi: {new Date(m.revised_date).toLocaleDateString('id-ID')}</Text> : null}
          </View>
        ))}
        {(d.milestones ?? []).length === 0 && <Text style={{ fontSize: 13, color: COLORS.textSec }}>Belum ada milestone.</Text>}
      </>
    );
  }

  if (payload.type === 'weekly_digest') {
    return (
      <>
        <SLabel>Periode</SLabel>
        <RRow label="Minggu" value={`${d.week_start} — ${d.week_end}`} />
        <RRow label="Total Aktivitas" value={d.total_activities} />
        <RRow label="Progress Keseluruhan" value={`${d.overall_progress}%`} color={COLORS.accent} />
        {d.by_flag && Object.keys(d.by_flag).length > 0 && (
          <>
            <SLabel>Aktivitas per Flag</SLabel>
            {Object.entries(d.by_flag).map(([flag, count]: any) => (
              <RRow key={flag} label={flag} value={count}
                color={flag === 'OK' ? COLORS.ok : flag === 'WARNING' ? COLORS.warning : flag === 'CRITICAL' ? COLORS.critical : undefined} />
            ))}
          </>
        )}
        {d.by_type && Object.keys(d.by_type).length > 0 && (
          <>
            <SLabel>Aktivitas per Tipe</SLabel>
            {Object.entries(d.by_type).map(([type, count]: any) => (
              <RRow key={type} label={type} value={count} />
            ))}
          </>
        )}
      </>
    );
  }

  if (payload.type === 'payroll_support_summary') {
    return (
      <>
        <SLabel>Tujuan</SLabel>
        <Text style={{ fontSize: 13, color: COLORS.textSec, lineHeight: 19 }}>{d.purpose}</Text>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Total Entri" value={d.total_entries ?? 0} />
        <RRow label="Total Qty" value={d.total_qty ?? 0} color={COLORS.accent} />
        <RRow label="Jumlah Pelapor" value={(d.by_reporter ?? []).length} />
        <SLabel>Rekap per Pelapor</SLabel>
        {(d.by_reporter ?? []).map((group: any, index: number) => (
          <View key={index} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{group.reporter_name}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              {group.entry_count} entri · total {group.total_qty} unit pekerjaan
            </Text>
          </View>
        ))}
        {(d.by_reporter ?? []).length === 0 && <Text style={{ fontSize: 13, color: COLORS.textSec }}>Belum ada entri payroll support pada rentang ini.</Text>}
      </>
    );
  }

  if (payload.type === 'client_charge_report') {
    const formatRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
    return (
      <>
        <SLabel>Tujuan</SLabel>
        <Text style={{ fontSize: 13, color: COLORS.textSec, lineHeight: 19 }}>{d.purpose}</Text>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Estimasi Biaya Ditagihkan" value={formatRp(d.grand_total_est_cost ?? 0)} color={COLORS.warning} />
        <RRow label="Perubahan Terkait Klien" value={d.vo_charges?.items?.length ?? 0} />
        <RRow label="Entri Support Progress" value={d.progress_support?.total_entries ?? 0} />
        <SLabel>Perubahan Potensial Ditagihkan</SLabel>
        {(d.vo_charges?.items ?? []).map((item: any, index: number) => (
          <View key={index} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{item.description}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>{item.location ?? '—'} · {item.requested_by_name ?? '—'}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>{item.est_material ?? 'Tanpa material estimasi'} · {item.est_cost ? formatRp(item.est_cost) : 'Belum ada estimasi biaya'}</Text>
          </View>
        ))}
        {(d.vo_charges?.items ?? []).length === 0 && <Text style={{ fontSize: 13, color: COLORS.textSec }}>Belum ada catatan perubahan permintaan owner pada filter ini.</Text>}
        <SLabel>Support Progress</SLabel>
        {(d.progress_support?.items ?? []).slice(0, 10).map((item: any, index: number) => (
          <View key={index} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{item.boq_code} — {item.boq_label}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              {item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '—'} · {item.quantity} {item.unit}
              {item.location ? ` · ${item.location}` : ''}
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>{item.reporter_name}</Text>
          </View>
        ))}
      </>
    );
  }

  if (payload.type === 'audit_list') {
    return (
      <>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Total Anomali" value={d.anomalies?.total ?? 0} color={COLORS.warning} />
        <RRow label="Total Audit Case" value={d.audit_cases?.total ?? 0} color={COLORS.critical} />
        <RRow label="Audit Case Open" value={d.audit_cases?.open ?? 0} color={COLORS.critical} />
        <SLabel>Daftar Anomali</SLabel>
        {(d.anomalies?.items ?? []).map((item: any, index: number) => (
          <View key={index} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{item.event_type}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>{item.entity_type} · {item.entity_id}</Text>
            <Text style={{ fontSize: 12, color: item.severity === 'CRITICAL' ? COLORS.critical : item.severity === 'WARNING' ? COLORS.warning : COLORS.textSec }}>{item.description}</Text>
          </View>
        ))}
        {(d.anomalies?.items ?? []).length === 0 && <Text style={{ fontSize: 13, color: COLORS.textSec }}>Belum ada anomali pada filter ini.</Text>}
        <SLabel>Audit Case</SLabel>
        {(d.audit_cases?.items ?? []).map((item: any, index: number) => (
          <View key={index} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{item.trigger_type}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>{item.entity_type} · {item.entity_id}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>Status: {(item.status ?? 'OPEN').replace(/_/g, ' ')}</Text>
            {item.notes ? <Text style={{ fontSize: 12, color: COLORS.textSec }}>{item.notes}</Text> : null}
          </View>
        ))}
        {(d.audit_cases?.items ?? []).length === 0 && <Text style={{ fontSize: 13, color: COLORS.textSec }}>Belum ada audit case pada filter ini.</Text>}
      </>
    );
  }

  if (payload.type === 'ai_usage_summary') {
    const fmtTokens = (value: number) => value.toLocaleString('id-ID');
    return (
      <>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Total Interaksi" value={d.summary?.total_interactions ?? 0} />
        <RRow label="User Aktif" value={d.summary?.active_users ?? 0} />
        <RRow label="Total Token" value={fmtTokens(d.summary?.total_tokens ?? 0)} color={COLORS.accent} />
        <RRow label="Haiku" value={d.summary?.haiku_count ?? 0} />
        <RRow label="Sonnet" value={d.summary?.sonnet_count ?? 0} color={COLORS.warning} />
        {d.error ? (
          <Text style={{ fontSize: 13, color: COLORS.warning, lineHeight: 19, marginTop: 8 }}>
            Data penggunaan AI belum bisa dibaca: {d.error}
          </Text>
        ) : null}
        <SLabel>Per User</SLabel>
        {(d.users ?? []).map((user: any, index: number) => (
          <View key={index} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{user.full_name}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              {user.role ?? '—'} · {user.interaction_count} chat · {user.active_days} hari aktif
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              Token: {fmtTokens(user.total_tokens ?? 0)} · Haiku {user.haiku_count ?? 0} · Sonnet {user.sonnet_count ?? 0}
            </Text>
            {user.last_used_at ? (
              <Text style={{ fontSize: 12, color: COLORS.textSec }}>
                Terakhir pakai: {new Date(user.last_used_at).toLocaleString('id-ID')}
              </Text>
            ) : null}
          </View>
        ))}
        {(d.users ?? []).length === 0 && <Text style={{ fontSize: 13, color: COLORS.textSec }}>Belum ada penggunaan AI pada filter ini.</Text>}
        <SLabel>Tren Harian</SLabel>
        {(d.usage_by_day ?? []).slice(-10).reverse().map((row: any, index: number) => (
          <View key={index} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{new Date(row.date).toLocaleDateString('id-ID')}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              {row.interaction_count} chat · {fmtTokens(row.total_tokens ?? 0)} token
            </Text>
          </View>
        ))}
      </>
    );
  }

  if (payload.type === 'approval_sla_user') {
    return (
      <>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Event Ditangani" value={d.summary?.handled_events ?? 0} />
        <RRow label="Reviewer Aktif" value={d.summary?.active_reviewers ?? 0} />
        <RRow label="Rata-rata SLA" value={`${d.summary?.avg_hours ?? 0} jam`} color={COLORS.accent} />
        <RRow label="Median SLA" value={`${d.summary?.median_hours ?? 0} jam`} />
        <RRow label="Lebih dari 24 jam" value={d.summary?.over_24h ?? 0} color={COLORS.warning} />
        <RRow label="Queue Pending" value={d.summary?.pending_items ?? 0} color={COLORS.critical} />
        <SLabel>Queue Pending</SLabel>
        {(d.pending_by_queue ?? []).map((row: any, index: number) => (
          <RRow key={index} label={row.label} value={row.count} color={row.count > 0 ? COLORS.warning : undefined} />
        ))}
        <SLabel>Per User</SLabel>
        {(d.users ?? []).map((user: any, index: number) => (
          <View key={index} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{user.full_name}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              {user.role ?? '—'} · {user.handled_events} handled · avg {user.avg_hours} jam · median {user.median_hours} jam
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              Pending assigned: {user.assigned_pending ?? 0} · &gt;24 jam: {user.over_24h ?? 0}
            </Text>
            {user.last_acted_at ? <Text style={{ fontSize: 12, color: COLORS.textSec }}>Terakhir aksi: {new Date(user.last_acted_at).toLocaleString('id-ID')}</Text> : null}
          </View>
        ))}
        <SLabel>Per Jenis Approval</SLabel>
        {(d.entity_sla ?? []).map((row: any, index: number) => (
          <View key={index} style={{ marginBottom: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{row.entity}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              {row.handled_events} event · avg {row.avg_hours} jam · median {row.median_hours} jam
            </Text>
          </View>
        ))}
      </>
    );
  }

  if (payload.type === 'operational_entry_discipline') {
    return (
      <>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Total Entry" value={d.summary?.total_entries ?? 0} />
        <RRow label="User Aktif" value={d.summary?.active_users ?? 0} />
        <RRow label="Entry Eligible Foto" value={d.summary?.photo_eligible_entries ?? 0} />
        <RRow label="Foto Lengkap" value={d.summary?.photo_backed_entries ?? 0} color={COLORS.ok} />
        <RRow label="Cakupan Foto" value={`${d.summary?.photo_coverage_pct ?? 0}%`} color={COLORS.accent} />
        <SLabel>Distribusi Modul</SLabel>
        {(d.by_module ?? []).map((row: any, index: number) => (
          <RRow key={index} label={row.module} value={row.count} />
        ))}
        <SLabel>Per User</SLabel>
        {(d.users ?? []).map((user: any, index: number) => (
          <View key={index} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{user.full_name}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              {user.role ?? '—'} · {user.total_entries} entry · {user.active_days} hari aktif
            </Text>
            {user.photo_coverage_pct != null ? (
              <Text style={{ fontSize: 12, color: COLORS.textSec }}>Cakupan foto: {user.photo_coverage_pct}%</Text>
            ) : null}
            {user.last_activity ? <Text style={{ fontSize: 12, color: COLORS.textSec }}>Aktivitas terakhir: {new Date(user.last_activity).toLocaleString('id-ID')}</Text> : null}
          </View>
        ))}
      </>
    );
  }

  if (payload.type === 'tool_usage_summary') {
    const fmtTokens = (value: number) => value.toLocaleString('id-ID');
    return (
      <>
        <SLabel>Ringkasan</SLabel>
        <RRow label="Total Export" value={d.summary?.total_exports ?? 0} />
        <RRow label="User Export Aktif" value={d.summary?.export_users ?? 0} />
        <RRow label="Total Chat AI" value={d.summary?.total_ai_chats ?? 0} color={COLORS.accent} />
        <RRow label="User AI Aktif" value={d.summary?.ai_users ?? 0} />
        <RRow label="Total Token AI" value={fmtTokens(d.summary?.total_ai_tokens ?? 0)} />
        <SLabel>Report Paling Sering</SLabel>
        {(d.top_report_types ?? []).map((row: any, index: number) => (
          <RRow key={index} label={row.report_type} value={row.count} />
        ))}
        <SLabel>Per User</SLabel>
        {(d.users ?? []).map((user: any, index: number) => (
          <View key={index} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{user.full_name}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              {user.role ?? '—'} · {user.export_count} export · {user.ai_chat_count} chat AI
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              Token AI: {fmtTokens(user.total_tokens ?? 0)} · Haiku {user.haiku_count ?? 0} · Sonnet {user.sonnet_count ?? 0}
            </Text>
            {user.last_seen ? <Text style={{ fontSize: 12, color: COLORS.textSec }}>Aktivitas terakhir: {new Date(user.last_seen).toLocaleString('id-ID')}</Text> : null}
          </View>
        ))}
        {d.note ? <Text style={{ fontSize: 12, color: COLORS.textSec, lineHeight: 18 }}>{d.note}</Text> : null}
      </>
    );
  }

  if (payload.type === 'exception_handling_load') {
    return (
      <>
        <SLabel>Ringkasan</SLabel>
        <RRow label="AUTO_HOLD Request" value={d.summary?.auto_hold_requests ?? 0} color={COLORS.warning} />
        <RRow label="Request Ditolak" value={d.summary?.rejected_requests ?? 0} />
        <RRow label="Perubahan Ditolak" value={d.summary?.rejected_vo ?? 0} />
        <RRow label="MTN Ditolak" value={d.summary?.rejected_mtn ?? 0} />
        <RRow label="Hold / Reject / Override" value={d.summary?.hold_reject_override_actions ?? 0} color={COLORS.critical} />
        <RRow label="Anomali High/Critical" value={d.summary?.anomalies_high_or_critical ?? 0} color={COLORS.critical} />
        <RRow label="Audit Case Open" value={d.summary?.audit_cases_open ?? 0} color={COLORS.critical} />
        <SLabel>Per User</SLabel>
        {(d.users ?? []).map((user: any, index: number) => (
          <View key={index} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,148,148,0.15)', paddingBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600' }}>{user.full_name}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              {user.role ?? '—'} · generated {user.generated_count ?? 0} · handled {user.handled_count ?? 0}
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.textSec }}>
              Hold/Reject/Override: {user.hold_reject_override ?? 0}
            </Text>
            {user.last_touch ? <Text style={{ fontSize: 12, color: COLORS.textSec }}>Terakhir sentuh: {new Date(user.last_touch).toLocaleString('id-ID')}</Text> : null}
          </View>
        ))}
        <SLabel>Breakdown Anomali</SLabel>
        {(d.anomaly_breakdown ?? []).map((row: any, index: number) => (
          <RRow key={index} label={row.event_type} value={row.count} />
        ))}
        <SLabel>Breakdown Audit Case</SLabel>
        {(d.audit_breakdown ?? []).map((row: any, index: number) => (
          <RRow key={index} label={`${row.trigger_type} · ${row.status}`} value={row.count} />
        ))}
      </>
    );
  }

  return <Text style={{ fontSize: 13, color: COLORS.textSec }}>Tipe laporan tidak dikenali.</Text>;
}
