// workflows/components/analytics/SCurveCard.tsx
// SANO — Kurva-S (spec 2026-09-17 §5.3.1): the assumed S-curve plan, verified
// progress by week, and a projection at the recent pace. With no verified
// progress the actual line is simply absent and the card says so.
import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Card from '../Card';
import LineChart from '../charts/LineChart';
import { buildSCurve } from '../../../tools/analytics/sCurve';
import { weekOf } from '../../../tools/analytics/weekBuckets';
import { todayIsoWIB } from '../../../tools/timeWindow';
import { COLORS } from '../../theme';
import LoadBody from './LoadBody';
import ProjectDatesEditor, { canEditProjectDates } from './ProjectDatesEditor';
import { a, dateLabel, shortLabel } from './analyticsStyles';
import { useLoad } from './useLoad';

export interface ProgressEntryRow { boq_item_id: string; quantity: number; created_at: string }

interface Props {
  project: { id: string; start_date: string | null; end_date: string | null };
  items: ReadonlyArray<{ id: string; planned: number; superseded_at?: string | null }>;
  role: string | null | undefined;
  loadEntries: () => Promise<ProgressEntryRow[]>;
  onDatesSaved: () => void;
  toast?: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
  /** Today as a WIB date; tests pass a fixed one. */
  today?: string;
}

export default function SCurveCard({ project, items, role, loadEntries, onDatesSaved, toast, today = todayIsoWIB() }: Props) {
  const entries = useLoad(loadEntries);
  const [editing, setEditing] = useState(false);
  const canEdit = canEditProjectDates(role);
  const live = useMemo(() => items.filter((i) => (i.superseded_at ?? null) == null && i.planned > 0), [items]);
  const curve = useMemo(
    () => (entries.status === 'ready' ? buildSCurve({ start: project.start_date, end: project.end_date, today, items: live, entries: entries.data }) : null),
    [entries.status, entries.data, project.start_date, project.end_date, today, live],
  );

  const gap = curve?.projection?.weeksFromPlan ?? null;
  const gapText = gap === null ? null : gap === 0 ? 'sesuai rencana' : gap > 0 ? `${gap} minggu lebih lambat dari rencana` : `${-gap} minggu lebih cepat dari rencana`;

  return (
    <Card title="Kurva-S Progres">
      <LoadBody status={entries.status} error={entries.error} onRetry={entries.reload} label="Kurva-S">
        {curve && (
          <View>
            <View style={a.tiles}>
              <View style={a.tile}><Text style={a.tileLabel}>Terverifikasi</Text><Text style={a.tileValue}>{`${curve.latestActual ?? 0}%`}</Text></View>
              <View style={a.tile}><Text style={a.tileLabel}>Rencana hari ini</Text><Text style={a.tileValue}>{curve.plannedToday === null ? '—' : `${curve.plannedToday}%`}</Text></View>
              <View style={a.tile}><Text style={a.tileLabel}>Laju</Text><Text style={a.tileValue}>{curve.projection ? `${curve.projection.pacePerWeek}% / mgg` : '—'}</Text></View>
              <View style={a.tile}>
                <Text style={a.tileLabel}>Proyeksi selesai</Text>
                <Text style={a.tileValue}>{curve.projection ? dateLabel(curve.projection.finishWeek) : '—'}</Text>
                {gapText ? <Text style={a.tileSub}>{gapText}</Text> : null}
              </View>
            </View>

            {(curve.hasPlan || curve.entryCount > 0) && (
              <LineChart
                labels={curve.weeks.map(shortLabel)}
                yMax={100}
                unit="%"
                markerIndex={curve.weeks.indexOf(weekOf(today))}
                accessibilityLabel={`Kurva-S: rencana ${curve.plannedToday ?? '-'} persen hari ini, terverifikasi ${curve.latestActual ?? 0} persen`}
                series={[
                  { key: 'plan', label: 'Rencana (asumsi kurva-S)', color: COLORS.textMuted, dash: '2 4', values: curve.planned },
                  { key: 'actual', label: 'Terverifikasi', color: COLORS.info, values: curve.actual, dots: true },
                  { key: 'projection', label: 'Proyeksi laju sekarang', color: COLORS.info, dash: '6 5', values: curve.projected },
                ]}
              />
            )}

            {!curve.hasPlan && (
              <Text style={a.warn}>
                {canEdit ? 'Isi tanggal selesai rencana untuk menggambar kurva rencana.' : 'Tanggal proyek belum diisi. Minta admin atau prinsipal mengisi tanggal mulai dan selesai rencana.'}
              </Text>
            )}
            {curve.projectionNote ? <Text style={a.note}>{curve.projectionNote}</Text> : null}
            {curve.projection ? (
              <Text style={a.hint}>{`Proyeksi memakai laju ${curve.projection.pacePerWeek}% per minggu dari ${curve.projection.windowWeeks} minggu terakhir.`}</Text>
            ) : null}
            <Text style={a.hint}>
              {`Sumber: ${curve.entryCount} entri progres terverifikasi.${curve.hasPlan ? ` Rencana: asumsi kurva-S ${dateLabel(project.start_date as string)} – ${dateLabel(project.end_date as string)}, bukan jadwal rinci.` : ''}`}
            </Text>

            {canEdit && (curve.hasPlan && !editing ? (
              <TouchableOpacity style={a.ghostBtn} onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel="Ubah tanggal proyek">
                <Text style={a.ghostBtnText}>Ubah tanggal proyek</Text>
              </TouchableOpacity>
            ) : (
              <ProjectDatesEditor
                projectId={project.id}
                startDate={project.start_date}
                endDate={project.end_date}
                toast={toast}
                onSaved={() => { setEditing(false); onDatesSaved(); }}
              />
            ))}
          </View>
        )}
      </LoadBody>
    </Card>
  );
}
