// workflows/components/analytics/MaterialCoverageCard.tsx
// SANO — Material vs progres (spec 2026-09-17 §5.3.2).
import React, { useCallback, useMemo } from 'react';
import { Text, View } from 'react-native';
import Meter from '../charts/Meter';
import { buildDiaryActivity, type DiaryReport } from '../../../tools/analytics/diaryActivity';
import { WAITING_AFTER_DAYS, buildMaterialCoverage, type CatalogEntry, type PlannedLine, type RequestedLine } from '../../../tools/analytics/materialCoverage';
import { daysBetween } from '../../../tools/analytics/weekBuckets';
import { WORK_TYPE_LABELS } from '../../../tools/analytics/workType';
import { todayIsoWIB } from '../../../tools/timeWindow';
import LoadBody from './LoadBody';
import { a, qty, shortLabel } from './analyticsStyles';
import { useLoad } from './useLoad';

export interface MaterialData { planned: PlannedLine[]; requests: RequestedLine[]; catalog: Map<string, CatalogEntry> }
export interface DiaryData { reports: DiaryReport[]; links: Map<string, string | null> }

interface Props { loadMaterial: () => Promise<MaterialData>; loadDiary: () => Promise<DiaryData>; today?: string }

export default function MaterialCoverageCard({ loadMaterial, loadDiary, today = todayIsoWIB() }: Props) {
  const loadBoth = useCallback(async () => {
    const [material, diary] = await Promise.all([loadMaterial(), loadDiary()]);
    return { material, diary };
  }, [loadMaterial, loadDiary]);
  const state = useLoad(loadBoth);
  const view = useMemo(() => {
    if (state.status !== 'ready') return null;
    const activity = buildDiaryActivity({ today, reports: state.data.diary.reports, links: state.data.diary.links });
    return { coverage: buildMaterialCoverage({ ...state.data.material, firstMentions: activity.firstMentions, today }), activity, requestLines: state.data.material.requests.length };
  }, [state.status, state.data, today]);

  return (
    <LoadBody status={state.status} error={state.error} onRetry={state.reload} label="Material vs progres">
      {view && (view.coverage.groups.length === 0 ? (
        <Text style={a.hint}>Belum ada rencana material atau permintaan material untuk proyek ini.</Text>
      ) : (
        <View>
          {view.coverage.groups.filter((g) => g.requested > 0).map((g) => (
            <View key={g.key}>
              <Meter
                label={`${g.category} (${g.unit})`}
                primaryPct={g.approvedPct}
                secondaryPct={g.requestedPct}
                caption={g.planned > 0
                  ? `${qty(g.approved)} disetujui (${g.approvedPct}%) · ${qty(g.requested)} diminta (${g.requestedPct}%) · rencana ${qty(g.planned)} ${g.unit}`
                  : `${qty(g.requested)} ${g.unit} diminta, tanpa rencana di BoQ terbit`}
              />
              {g.workType && g.firstRequest && g.lagDays !== null && (
                <Text style={a.hint}>
                  {g.lagDays >= 0
                    ? `Diminta pertama ${shortLabel(g.firstRequest)}; ${WORK_TYPE_LABELS[g.workType].toLowerCase()} muncul di laporan harian ${g.lagDays} hari kemudian.`
                    : `${WORK_TYPE_LABELS[g.workType]} sudah berjalan ${-g.lagDays} hari sebelum permintaan pertama (${shortLabel(g.firstRequest)}).`}
                </Text>
              )}
              {g.waiting && g.workType && g.firstRequest && (
                <Text style={a.warn}>
                  {`Material diminta ${daysBetween(g.firstRequest, today)} hari lalu, ${WORK_TYPE_LABELS[g.workType].toLowerCase()} belum muncul di laporan harian (batas ${WAITING_AFTER_DAYS} hari).`}
                </Text>
              )}
            </View>
          ))}
          {view.coverage.groups.some((g) => g.requested === 0) && (
            <Text style={a.note}>
              {`Belum pernah diminta: ${view.coverage.groups.filter((g) => g.requested === 0).map((g) => `${g.category} (${g.unit})`).join(', ')}.`}
            </Text>
          )}
          <Text style={a.hint}>
            {`Sumber: ${view.requestLines} baris permintaan material dan rencana material BoQ terbit; permintaan yang ditolak tidak dihitung. Jenis pekerjaan di laporan harian: ${view.activity.keywordShare}% masih perkiraan kata kunci.`}
          </Text>
        </View>
      ))}
    </LoadBody>
  );
}
