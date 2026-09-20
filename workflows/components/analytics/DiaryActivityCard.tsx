// workflows/components/analytics/DiaryActivityCard.tsx
// SANO — Aktivitas lapangan (spec 2026-09-17 §5.3.3).
import React, { useCallback, useMemo } from 'react';
import { Text, View } from 'react-native';
import LineChart from '../charts/LineChart';
import StackedBarChart from '../charts/StackedBarChart';
import { buildDiaryActivity } from '../../../tools/analytics/diaryActivity';
import { buildSCurve } from '../../../tools/analytics/sCurve';
import { WORK_TYPE_LABELS, WORK_TYPES, type WorkType } from '../../../tools/analytics/workType';
import { todayIsoWIB } from '../../../tools/timeWindow';
import { COLORS } from '../../theme';
import LoadBody from './LoadBody';
import type { DiaryData } from '../../../tools/analytics/data';
import type { ProgressEntryRow } from './SCurveCard';
import { a, shortLabel } from './analyticsStyles';
import { useLoad } from './useLoad';

const WORK_COLORS: Record<Exclude<WorkType, 'LAINNYA'>, string> = {
  GALIAN: '#8D6E63', BEKISTING: COLORS.warning, PEMBESIAN: COLORS.info, PENGECORAN: COLORS.ok, PASANGAN: COLORS.accent, MEP: '#6A4C93',
};

interface Props {
  loadDiary: () => Promise<DiaryData>;
  loadEntries: () => Promise<ProgressEntryRow[]>;
  items: ReadonlyArray<{ id: string; planned: number; superseded_at?: string | null }>;
  today?: string;
}

export default function DiaryActivityCard({ loadDiary, loadEntries, items, today = todayIsoWIB() }: Props) {
  const loadBoth = useCallback(async () => {
    const [diary, entries] = await Promise.all([loadDiary(), loadEntries()]);
    return { diary, entries };
  }, [loadDiary, loadEntries]);
  const state = useLoad(loadBoth);
  const view = useMemo(() => {
    if (state.status !== 'ready') return null;
    const activity = buildDiaryActivity({ today, reports: state.data.diary.reports, links: state.data.diary.links });
    const live = items.filter((i) => (i.superseded_at ?? null) == null && i.planned > 0);
    const verified = buildSCurve({ start: null, end: null, today, items: live, entries: state.data.entries }).latestActual ?? 0;
    const crewDays = activity.byWeek.reduce((sum, w) => sum + w.crewDays, 0);
    return { activity, verified, crewDays, missing: activity.byWeek.reduce((sum, w) => sum + w.daysWithoutReport, 0) };
  }, [state.status, state.data, today, items]);

  return (
    <LoadBody status={state.status} error={state.error} onRetry={state.reload} label="Aktivitas lapangan">
      {view && (view.activity.reportCount === 0 ? (
        <Text style={a.hint}>Belum ada laporan harian untuk proyek ini.</Text>
      ) : (
        <View>
          <Text style={a.subhead}>Jenis pekerjaan di laporan harian, per minggu</Text>
          <StackedBarChart
            labels={view.activity.weeks.map(shortLabel)}
            accessibilityLabel="Jumlah baris laporan harian per jenis pekerjaan per minggu"
            series={WORK_TYPES.filter((t): t is Exclude<WorkType, 'LAINNYA'> => t !== 'LAINNYA').map((t) => ({
              key: t, label: WORK_TYPE_LABELS[t], color: WORK_COLORS[t], values: view.activity.byWeek.map((w) => w.mix[t] ?? 0),
            }))}
          />
          <Text style={a.subhead}>Rata-rata tukang per hari, per minggu</Text>
          <LineChart
            labels={view.activity.weeks.map(shortLabel)}
            accessibilityLabel="Rata-rata jumlah tukang per hari per minggu dari laporan harian"
            series={[{ key: 'crew', label: 'Tukang per hari', color: COLORS.accentDark, values: view.activity.byWeek.map((w) => w.crewAvg), dots: true }]}
          />
          <Text style={a.note}>{`${view.activity.reportCount} laporan · ${view.missing} hari kerja (Senin–Sabtu) tanpa laporan sejak laporan pertama`}</Text>
          {view.verified > 0 && view.crewDays > 0 ? (
            <Text style={a.note}>{`${Math.round(view.crewDays / view.verified)} tukang-hari per 1% progres terverifikasi (${view.crewDays} tukang-hari, ${view.verified}%).`}</Text>
          ) : (
            <Text style={a.hint}>Tukang-hari per 1% progres muncul setelah ada progres terverifikasi.</Text>
          )}
          <Text style={a.hint}>
            {`Sumber: laporan harian (revisi terakhir). ${view.activity.keywordShare}% baris dikelompokkan dengan perkiraan kata kunci; sisanya dari tautan yang dikonfirmasi.`}
          </Text>
        </View>
      ))}
    </LoadBody>
  );
}
