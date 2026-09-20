// workflows/components/analytics/MaterialChainCard.tsx
// SANO — Material vs progres (spec 2026-09-20 §4): per material group, a
// radial of this week's Diminta / Disetujui / Terpasang / menurut laporan
// harian, the stock, lead and cover in words, and the weekly trend chart on
// demand. Every figure comes from buildMaterialChain; this file only lays it
// out and keeps the switches.
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ChainSupport, DiaryData, MaterialData } from '../../../tools/analytics/data';
import { buildDiaryActivity } from '../../../tools/analytics/diaryActivity';
import { buildMaterialChain, type ChainGroup } from '../../../tools/analytics/materialChain';
import { WAITING_AFTER_DAYS, buildMaterialCoverage, type CoverageGroup } from '../../../tools/analytics/materialCoverage';
import { daysBetween } from '../../../tools/analytics/weekBuckets';
import { WORK_TYPE_LABELS } from '../../../tools/analytics/workType';
import { todayIsoWIB } from '../../../tools/timeWindow';
import { CHART, COLORS, FONTS, SPACE, TYPE } from '../../theme';
import LineChart, { type Annotation, type Band, type LineSeries } from '../charts/LineChart';
import RadialRings, { type Ring } from '../charts/RadialRings';
import LoadBody from './LoadBody';
import { a, lh, qty, shortLabel } from './analyticsStyles';
import { useLoad } from './useLoad';

interface Props {
  loadMaterial: () => Promise<MaterialData>;
  loadDiary: () => Promise<DiaryData>;
  loadChain: () => Promise<ChainSupport>;
  /** Today as a WIB date; tests pass a fixed one. */
  today?: string;
}

type RingKey = 'requested' | 'approved' | 'verified' | 'diary';
const RING_ITEMS: ReadonlyArray<{ key: RingKey; label: string; color: string; opacity: number }> = [
  { key: 'requested', label: 'Diminta', color: CHART.procurement, opacity: CHART.tintOpacity },
  { key: 'approved', label: 'Disetujui', color: CHART.procurement, opacity: 1 },
  { key: 'verified', label: 'Terpasang (terverifikasi)', color: CHART.installed, opacity: 1 },
  { key: 'diary', label: 'Menurut laporan harian (belum diverifikasi)', color: CHART.diary, opacity: 1 },
];
const LINES_OFF_BY_DEFAULT = ['requested', 'diary'];

const pctText = (v: number | null) => (v === null ? '—' : `${qty(v)} %`);
/** A quantity in the group's unit; kilograms read as tonnes from a thousand. */
export function qtyText(n: number, unit: string): string {
  return unit === 'kg' && Math.abs(n) >= 1000 ? `${qty(n / 1000)} t` : `${qty(n)} ${unit}`;
}

function useSetToggle(initial: string[]) {
  const [set, setSet] = useState<Set<string>>(() => new Set(initial));
  const toggle = useCallback((key: string) => setSet((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; }), []);
  return [set, toggle] as const;
}

export default function MaterialChainCard({ loadMaterial, loadDiary, loadChain, today = todayIsoWIB() }: Props) {
  const loadAll = useCallback(async () => {
    const [material, diary, chain] = await Promise.all([loadMaterial(), loadDiary(), loadChain()]);
    return { material, diary, chain };
  }, [loadMaterial, loadDiary, loadChain]);
  const state = useLoad(loadAll);
  const [selected, setSelected] = useState<string | null>(null);
  const [hiddenRings, toggleRing] = useSetToggle([]);
  const [hiddenLines, toggleLine] = useSetToggle(LINES_OFF_BY_DEFAULT);
  const [expanded, setExpanded] = useState(false);

  const view = useMemo(() => {
    if (state.status !== 'ready') return null;
    const { material, diary, chain } = state.data;
    const activity = buildDiaryActivity({ today, reports: diary.reports, links: diary.links });
    const coverage = buildMaterialCoverage({ ...material, firstMentions: activity.firstMentions, today });
    const chains = buildMaterialChain({ today, planned: material.planned, requests: material.requests, catalog: material.catalog, weights: chain.weights, verifiedLines: chain.verified, diary: chain.diary });
    return { coverage, chains };
  }, [state.status, state.data, today]);
  const group: ChainGroup | null = view ? view.chains.groups.find((g) => g.key === selected) ?? view.chains.groups[0] ?? null : null;
  const cov: CoverageGroup | null = view && group ? view.coverage.groups.find((c) => c.key === group.key) ?? null : null;

  return (
    <LoadBody status={state.status} error={state.error} onRetry={state.reload} label="Material vs progres">
      {view && (
        <View>
          <Text style={a.hint}>Posisi minggu ini, % dari rencana BoQ</Text>
          {view.chains.groups.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {view.chains.groups.map((g) => {
                const on = g.key === group?.key;
                return (
                  <TouchableOpacity key={g.key} style={[styles.chip, on && styles.chipOn]} onPress={() => setSelected(g.key)} accessibilityRole="button" accessibilityLabel={g.chipLabel} accessibilityState={{ selected: on }}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{g.chipLabel}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
          {!group && <Text style={a.hint}>Belum ada rencana material untuk proyek ini.</Text>}
          {group && <GroupView group={group} cov={cov} today={today} hiddenRings={hiddenRings} toggleRing={toggleRing} hiddenLines={hiddenLines} toggleLine={toggleLine} expanded={expanded} setExpanded={setExpanded} />}
          {view.coverage.groups.some((g) => g.requested === 0 && g.planned > 0) && (
            <Text style={a.note}>{`Belum pernah diminta: ${view.coverage.groups.filter((g) => g.requested === 0 && g.planned > 0).map((g) => `${g.category} (${g.unit})`).join(', ')}.`}</Text>
          )}
          {view.chains.planWithoutAreaOnly.length > 0 && <Text style={a.note}>{`Rencana hanya di tingkat proyek: ${view.chains.planWithoutAreaOnly.join(', ')}.`}</Text>}
          {view.chains.unplannedRequested.length > 0 && <Text style={a.note}>{`Diminta tanpa rencana di BoQ terbit: ${view.chains.unplannedRequested.join(', ')}.`}</Text>}
          <Text style={a.hint}>
            {`${group && !group.diaryReadable ? 'Laporan harian belum bisa dibaca. ' : ''}Diminta dan disetujui dari permintaan material; terpasang dari klaim terverifikasi × rencana material per area; laporan harian: Berjalan 50 · Selesai 100, belum diverifikasi. Permintaan yang ditolak tidak dihitung.`}
          </Text>
        </View>
      )}
    </LoadBody>
  );
}

interface GroupProps {
  group: ChainGroup;
  cov: CoverageGroup | null;
  today: string;
  hiddenRings: ReadonlySet<string>;
  toggleRing: (key: string) => void;
  hiddenLines: ReadonlySet<string>;
  toggleLine: (key: string) => void;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
}

function GroupView({ group, cov, today, hiddenRings, toggleRing, hiddenLines, toggleLine, expanded, setExpanded }: GroupProps) {
  const { today: t, relation: rel } = group;
  const diaryValue = group.diaryReadable ? t.diary : null;
  const rings: Ring[] = [
    {
      key: 'approved', color: CHART.procurement,
      value: hiddenRings.has('approved') ? 0 : t.approved,
      tint: hiddenRings.has('requested') ? null : { from: t.approved, value: t.requested, opacity: CHART.tintOpacity },
      hidden: hiddenRings.has('approved') && hiddenRings.has('requested'),
    },
    { key: 'verified', color: CHART.installed, value: t.verified, endDot: true, hidden: hiddenRings.has('verified') },
    { key: 'diary', color: CHART.diary, value: diaryValue, hidden: hiddenRings.has('diary') || !group.diaryReadable },
  ];
  const values: Record<RingKey, number | null> = { requested: t.requested, approved: t.approved, verified: t.verified, diary: diaryValue };
  const hero = t.verified === null ? { value: '—', label: 'belum ada progres terverifikasi' } : { value: pctText(t.verified), label: 'terpasang, terverifikasi' };

  const series: LineSeries[] = [
    { key: 'requested', label: 'Diminta', color: CHART.procurement, opacity: CHART.tintOpacity, values: group.requested },
    { key: 'approved', label: 'Disetujui', color: CHART.procurement, values: group.approved, endLabel: true },
    { key: 'verified', label: 'Terpasang (terverifikasi)', color: CHART.installed, values: group.verified, dots: true, endLabel: true },
    { key: 'diary', label: 'Menurut laporan harian (belum diverifikasi)', color: CHART.diary, width: 1.5, values: group.diary },
    { key: 'projected', label: 'Proyeksi laju 4 minggu (titik-titik)', color: CHART.installed, dash: '2 4', values: group.projected },
  ];
  const bands: Band[] = [{ key: 'stock', between: ['approved', 'verified'], color: CHART.procurement, opacity: 0.1, label: 'stok teoretis' }];
  const annotations: Annotation[] = [];
  if (rel.leadWeeks !== null && rel.leadWeekIndex !== null && t.verified !== null) {
    annotations.push({ key: 'lead', kind: 'bracket', level: t.verified, fromIndex: rel.leadWeekIndex, toIndex: group.thisWeekIndex, label: `~${rel.leadWeeks} minggu`, requires: ['approved', 'verified'] });
  }
  if (rel.coverWeeks !== null) {
    annotations.push({ key: 'cover', kind: 'run', level: t.approved, fromIndex: group.thisWeekIndex, toIndex: Math.min(group.weeks.length - 1, group.thisWeekIndex + rel.coverWeeks), label: `cukup ~${rel.coverWeeks} minggu`, color: CHART.procurement, requires: ['approved', 'projected'] });
  }

  return (
    <View>
      <RadialRings
        rings={rings}
        hero={hero}
        accessibilityLabel={`${group.shortName}: diminta ${pctText(t.requested)}, disetujui ${pctText(t.approved)}, terpasang ${pctText(t.verified)}, menurut laporan harian ${pctText(diaryValue)}`}
      />
      <View style={styles.rows}>
        {RING_ITEMS.map((item) => (
          <View key={item.key} style={styles.row}>
            <View style={[styles.swatch, { backgroundColor: item.color, opacity: item.opacity }]} />
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={styles.rowValue}>{pctText(values[item.key])}</Text>
          </View>
        ))}
      </View>
      <View style={styles.legend}>
        {RING_ITEMS.map((item) => {
          const on = !hiddenRings.has(item.key);
          return (
            <TouchableOpacity key={item.key} style={[styles.legendItem, !on && styles.legendOff]} onPress={() => toggleRing(item.key)} accessibilityRole="switch" accessibilityLabel={`Tampilkan cincin ${item.label}`} accessibilityState={{ checked: on }}>
              <View style={styles.swatchWrap}>
                <View style={[styles.swatch, { backgroundColor: item.color, opacity: item.opacity }]} />
                {!on && <View style={styles.strike} />}
              </View>
              <Text style={styles.legendText}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={a.tiles}>
        <View style={a.tile}>
          <Text style={a.tileLabel}>Stok teoretis</Text>
          <Text style={a.tileValue}>{rel.stockQty === null ? '—' : qtyText(rel.stockQty, group.unit)}</Text>
          <Text style={a.tileSub}>{rel.stockPts === null ? rel.stockNote : `disetujui − terpasang · ${qty(rel.stockPts)} poin`}</Text>
        </View>
        <View style={a.tile}>
          <Text style={a.tileLabel}>Jeda material → pekerjaan</Text>
          <Text style={a.tileValue}>{rel.leadWeeks === null ? '—' : `~${rel.leadWeeks} minggu`}</Text>
          <Text style={a.tileSub}>{rel.leadWeeks === null ? rel.leadNote : 'disetujui sebelum terpasang'}</Text>
        </View>
        <View style={a.tile}>
          <Text style={a.tileLabel}>Cukup untuk</Text>
          <Text style={a.tileValue}>{rel.coverWeeks === null ? '—' : rel.coverWeeks > 52 ? '> 52 minggu' : `~${rel.coverWeeks} minggu`}</Text>
          <Text style={a.tileSub}>{rel.coverWeeks === null ? rel.coverNote : `pada laju ${qty(rel.pacePerWeek ?? 0)} poin/minggu`}</Text>
        </View>
      </View>

      {group.warnings.map((w) => <Text key={w} style={a.warn}>{w}</Text>)}
      {cov?.waiting && cov.workType && cov.firstRequest && (
        <Text style={a.warn}>{`Material diminta ${daysBetween(cov.firstRequest, today)} hari lalu, ${WORK_TYPE_LABELS[cov.workType].toLowerCase()} belum muncul di laporan harian (batas ${WAITING_AFTER_DAYS} hari).`}</Text>
      )}

      <TouchableOpacity style={a.ghostBtn} onPress={() => setExpanded(!expanded)} accessibilityRole="button" accessibilityLabel={expanded ? 'Sembunyikan tren' : 'Lihat tren mingguan'} accessibilityState={{ expanded }}>
        <Text style={a.ghostBtnText}>{expanded ? 'Sembunyikan tren' : 'Lihat tren mingguan'}</Text>
      </TouchableOpacity>
      {expanded && (
        <View style={styles.trend}>
          <Text style={a.hint}>Kumulatif per minggu, % dari rencana BoQ</Text>
          <LineChart
            labels={group.weeks.map(shortLabel)}
            yMax={100}
            unit="%"
            markerIndex={group.thisWeekIndex}
            series={series}
            bands={bands}
            annotations={annotations}
            hidden={hiddenLines}
            onToggle={toggleLine}
            accessibilityLabel={`Tren ${group.shortName} per minggu: disetujui ${pctText(t.approved)}, terpasang ${pctText(t.verified)}`}
          />
          {group.projectionNote ? <Text style={a.note}>{group.projectionNote}</Text> : null}
        </View>
      )}

      {cov?.workType && cov.firstRequest && cov.lagDays !== null && (
        <Text style={a.hint}>
          {cov.lagDays >= 0
            ? `Diminta pertama ${shortLabel(cov.firstRequest)}; ${WORK_TYPE_LABELS[cov.workType].toLowerCase()} muncul di laporan harian ${cov.lagDays} hari kemudian.`
            : `${WORK_TYPE_LABELS[cov.workType]} sudah berjalan ${-cov.lagDays} hari sebelum permintaan pertama (${shortLabel(cov.firstRequest)}).`}
        </Text>
      )}
      <Text style={a.hint}>{`Rencana ${qty(group.planned)} ${group.unit} per area kerja${group.plannedWithoutArea > 0 ? ` · ${qty(group.plannedWithoutArea)} ${group.unit} tanpa area kerja (tidak digambar)` : ''}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: SPACE.sm, paddingVertical: SPACE.sm },
  chip: { minHeight: 32, paddingHorizontal: SPACE.md, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, justifyContent: 'center' },
  chipOn: { backgroundColor: COLORS.accentBg, borderColor: COLORS.accentDark },
  chipText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.medium, color: COLORS.textSec },
  chipTextOn: { color: COLORS.text },
  rows: { marginTop: SPACE.sm, gap: SPACE.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  rowLabel: { flex: 1, fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  rowValue: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  swatchWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  strike: { position: 'absolute', width: 14, height: 1, backgroundColor: COLORS.textMuted, transform: [{ rotate: '45deg' }] },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md, marginTop: SPACE.md, marginBottom: SPACE.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, minHeight: 32 },
  legendOff: { opacity: 0.4 },
  legendText: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  trend: { marginTop: SPACE.sm },
});
