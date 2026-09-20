// workflows/components/analytics/ProjectAnalytics.tsx
// SANO — Analitik Proyek (spec 2026-09-17 §5): the same block on every role's
// Beranda, so the whole team reads the same graphs. The S-curve is always
// open; the other cards expand on tap, start collapsed on a narrow screen, and
// read their data only when first opened. Reads are shared between cards.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../Card';
import { loadApprovalData, loadChainSupport, loadDiaryData, loadMaterialData, loadProgressEntries } from '../../../tools/analytics/data';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';
import ApprovalFlowCard from './ApprovalFlowCard';
import DiaryActivityCard from './DiaryActivityCard';
import MaterialChainCard from './MaterialChainCard';
import SCurveCard from './SCurveCard';
import { lh } from './analyticsStyles';

interface Props {
  project: { id: string; start_date: string | null; end_date: string | null } | null;
  boqItems: ReadonlyArray<{ id: string; planned: number; superseded_at?: string | null; project_id?: string | null }>;
  role: string | null | undefined;
  /** Wide screens start with every card open. */
  wide?: boolean;
  /** Bump to read everything again, e.g. on pull-to-refresh. */
  reloadKey?: number;
  /** After the project dates changed, so the caller reloads the project. */
  onProjectChanged: () => void;
  toast?: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
}

type SectionKey = 'material' | 'diary' | 'approval';
const SECTIONS: ReadonlyArray<{ key: SectionKey; title: string }> = [
  { key: 'material', title: 'Material vs Progres' },
  { key: 'diary', title: 'Aktivitas Lapangan' },
  { key: 'approval', title: 'Alur Persetujuan Material' },
];

export default function ProjectAnalytics({ project, boqItems, role, wide = false, reloadKey = 0, onProjectChanged, toast }: Props) {
  const projectId = project?.id ?? null;
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({ material: wide, diary: wide, approval: wide });
  // One read per project and kind, shared by the cards; a failed read is forgotten so "Coba lagi" reads again.
  const cache = useRef(new Map<string, Promise<unknown>>());
  // Every pull-to-refresh and every project adds a set of keys, so drop the ones no loader can ask
  // for again. Entries of the current project and reloadKey stay: the cards still share them, and a
  // card whose section is opened later must not read a second time.
  const prefix = `${projectId}:${reloadKey}:`;
  useEffect(() => {
    for (const key of [...cache.current.keys()]) if (!key.startsWith(prefix)) cache.current.delete(key);
  }, [prefix]);
  const shared = useCallback(<T,>(kind: string, read: (id: string) => Promise<T>) => (): Promise<T> => {
    if (!projectId) return Promise.reject(new Error('Proyek belum dipilih.'));
    const key = `${prefix}${kind}`;
    if (!cache.current.has(key)) {
      cache.current.set(key, read(projectId).catch((err) => { cache.current.delete(key); throw err; }));
    }
    return cache.current.get(key) as Promise<T>;
  }, [projectId, prefix]);
  const loadEntries = useCallback(shared('entries', loadProgressEntries), [shared]);
  const loadDiary = useCallback(shared('diary', loadDiaryData), [shared]);
  const loadMaterial = useCallback(shared('material', loadMaterialData), [shared]);
  const loadHeaders = useCallback(shared('approval', loadApprovalData), [shared]);
  const loadChain = useCallback(shared('chain', loadChainSupport), [shared]);

  const items = useMemo(() => boqItems.filter((b) => b.project_id == null || b.project_id === projectId), [boqItems, projectId]);
  if (!project) return null;

  return (
    <View>
      <Text style={styles.head}>Analitik Proyek</Text>
      <SCurveCard project={project} items={items} role={role} loadEntries={loadEntries} onDatesSaved={onProjectChanged} toast={toast} />
      {SECTIONS.map((s) => (
        <Card key={s.key}>
          <TouchableOpacity
            style={styles.sectionHead}
            onPress={() => setOpen((prev) => ({ ...prev, [s.key]: !prev[s.key] }))}
            accessibilityRole="button"
            accessibilityLabel={s.title}
            accessibilityState={{ expanded: open[s.key] }}
          >
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <Ionicons name={open[s.key] ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSec} />
          </TouchableOpacity>
          {open[s.key] && (
            <View style={styles.sectionBody}>
              {s.key === 'material' && <MaterialChainCard loadMaterial={loadMaterial} loadDiary={loadDiary} loadChain={loadChain} />}
              {s.key === 'diary' && <DiaryActivityCard loadDiary={loadDiary} loadEntries={loadEntries} items={items} />}
              {s.key === 'approval' && <ApprovalFlowCard loadHeaders={loadHeaders} />}
            </View>
          )}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase', marginTop: SPACE.md, marginBottom: SPACE.xs },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  sectionTitle: { fontSize: TYPE.md, lineHeight: lh(TYPE.md), fontFamily: FONTS.semibold, color: COLORS.text },
  sectionBody: { marginTop: SPACE.sm },
});
