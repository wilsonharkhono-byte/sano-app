import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import { useProject } from '../../workflows/hooks/useProject';
import { useToast } from '../../workflows/components/Toast';
import GatesAdminScreen from './GatesAdminScreen';
import RoomBoardView from './rooms/RoomBoardView';
import RoomForm from './rooms/RoomForm';
import RoomPasteImport from './rooms/RoomPasteImport';
import {
  listRoomsResult, createRoom, setRoomActive, ensureAreaUmum, roomsToDatumAreas,
  type ParsedRoomRow,
} from '../../tools/rooms';
import { exportRoomLabelSheet } from '../../tools/roomLabelsHtml';
import { attentionMineRequest } from '../../tools/siteEventAttention';
import { canSetProjectPhase, setProjectPhase } from '../../tools/projectPhase';
import { AREA_TYPE_LABELS, PROJECT_PHASES } from '../../tools/constants';
import type { ProjectPhase, Room } from '../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../workflows/theme';

// 'board' is the tab's main view (spec §9); the two authoring screens plan 1
// shipped become sub-screens reached from it. Plan 1's route, icon, label and
// deep link are untouched: this is one more value on a switch that already
// existed.
type SubModule = 'board' | 'rooms' | 'gates';
type Mode = 'none' | 'add' | 'paste';

export default function RoomsAdminScreen() {
  const { project, profile, refresh } = useProject();
  const { show: toast } = useToast();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const [sub, setSub] = useState<SubModule>('board');

  // A SITE_EVENT_DIGEST tap resolves to this tab (tools/notificationRouting.ts)
  // with { projectId, attention, mine } (closure spec §5.6): show the board,
  // whatever sub-screen was open, and hand "Milik saya" to the list.
  const mineRequest = useMemo(() => attentionMineRequest(route.params), [route.params]);
  useEffect(() => {
    if (mineRequest) setSub('board');
  }, [mineRequest]);
  const [mode, setMode] = useState<Mode>('none');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const canPhase = canSetProjectPhase(profile?.role);
  // Falls back to the database default until migration 096 is pasted:
  // select('*') on a projects row with no phase column yields undefined at
  // runtime, even though Project.phase is typed required.
  const phase = project?.phase ?? 'STRUKTUR';

  const load = useCallback(async () => {
    if (!project) { setRooms([]); setLoadError(null); setLoading(false); return; }
    setLoading(true);
    const result = await listRoomsResult(project.id, { includeInactive: true });
    if (result.rooms === null) {
      // A failed read is not "no rooms" (CLAUDE.md §12): stale rows are
      // dropped so the error state below is the only thing shown, rather
      // than a list that might already be out of date next to a warning.
      setLoadError(result.error);
      setRooms([]);
    } else {
      setLoadError(null);
      setRooms(result.rooms);
    }
    setLoading(false);
  }, [project]);

  useEffect(() => { void load(); }, [load]);

  // Rooms grouped by floor, floors in first-appearance order (listRoomsResult
  // already orders by floor, then sort_order, then name).
  const byFloor = useMemo(() => {
    const groups = new Map<string, Room[]>();
    for (const r of rooms) {
      const key = r.floor || 'Tanpa lantai';
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [rooms]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAdd = async (input: { floor: string; room_name: string; area_type: Room['area_type'] }) => {
    if (!project) return;
    setSaving(true);
    // Area Umum is created by the app on first room setup, never by a trigger
    // (spec §4.1) - this is that moment.
    await ensureAreaUmum(project.id, profile?.id ?? null);
    const res = await createRoom({
      project_id: project.id,
      sort_order: rooms.filter((r) => (r.floor || '') === input.floor).length,
      created_by: profile?.id ?? null,
      ...input,
    });
    setSaving(false);
    if (res.error) { Alert.alert('Gagal menambah ruangan', res.error); return; }
    toast(`Ruangan ${res.room?.room_code} dibuat.`, 'ok');
    setMode('none');
    await load();
  };

  const handleImport = async (parsed: ParsedRoomRow[]) => {
    if (!project) return;
    setSaving(true);
    await ensureAreaUmum(project.id, profile?.id ?? null);
    const failures: string[] = [];
    for (const row of parsed) {
      const res = await createRoom({
        project_id: project.id,
        room_name: row.room_name,
        floor: row.floor,
        area_type: row.area_type,
        sort_order: row.sort_order,
        created_by: profile?.id ?? null,
      });
      if (res.error) failures.push(`${row.room_code}: ${res.error}`);
    }
    setSaving(false);
    setMode('none');
    await load();
    if (failures.length > 0) {
      // Partial success is reported in full - a half-imported list that claims
      // success is the failure mode this app refuses (CLAUDE.md §12).
      Alert.alert(
        `${parsed.length - failures.length} dari ${parsed.length} ruangan dibuat`,
        `Gagal:\n${failures.join('\n')}`,
      );
    } else {
      toast(`${parsed.length} ruangan dibuat.`, 'ok');
    }
  };

  const handlePrint = async (only: 'selected' | 'all') => {
    if (!project) return;
    const target = only === 'selected'
      ? rooms.filter((r) => selected.has(r.id))
      : rooms.filter((r) => r.active);
    setBusy(true);
    try {
      await exportRoomLabelSheet(project, target);
      toast(`${target.length} label dikirim ke printer.`, 'ok');
      await load(); // pick up qr_printed_at
    } catch (err: any) {
      Alert.alert('Cetak label', err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDatumExport = () => {
    if (!project) return;
    if (Platform.OS !== 'web') {
      Alert.alert('Ekspor DATUM', 'Ekspor hanya tersedia di versi web. Buka SANO di browser kantor.');
      return;
    }
    const payload = JSON.stringify(
      { project_code: project.code, project_name: project.name, areas: roomsToDatumAreas(rooms) },
      null, 2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `datum-areas-${project.code}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Berkas DATUM diunduh.', 'ok');
  };

  const handlePhase = async (phase: ProjectPhase) => {
    if (!project) return;
    setBusy(true);
    try {
      const { error } = await setProjectPhase(project.id, phase);
      if (error) { Alert.alert('Gagal mengubah fase', error); return; }
      toast('Fase proyek diperbarui.', 'ok');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (sub === 'gates') return <GatesAdminScreen onBack={() => setSub('board')} />;

  if (sub === 'board') {
    return (
      <View style={styles.flex}>
        <Header />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <RoomBoardView
            projectId={project?.id ?? null}
            viewerId={profile?.id ?? null}
            showOwners
            showDigestHealth
            mineRequest={mineRequest}
            onOpenEvent={(eventId, projectId) => navigation.navigate('SiteEventDetail', { eventId, projectId })}
            onOpenRoom={(row) => {
              if (!project || !row.room_code) return;
              navigation.navigate('RoomDetail', { projectCode: project.code, roomCode: row.room_code });
            }}
            headerAction={
              <TouchableOpacity onPress={() => setSub('rooms')} accessibilityRole="button">
                <Text style={styles.linkBtn}>Kelola ruangan</Text>
              </TouchableOpacity>
            }
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => setSub('board')} style={styles.back} accessibilityRole="button">
          <Ionicons name="chevron-back" size={18} color={COLORS.textSec} />
          <Text style={styles.backText}>Papan Ruangan</Text>
        </TouchableOpacity>
        <Text style={styles.sectionHead}>Kelola ruangan</Text>

        {!project && <Card><Text style={styles.empty}>Pilih proyek terlebih dahulu.</Text></Card>}

        {project && (
          <>
            <Card title="Fase proyek" subtitle="Menentukan bentuk laporan progres klien.">
              {canPhase ? (
                <View style={styles.pickerWrap}>
                  <Picker
                    selectedValue={phase} enabled={!busy}
                    onValueChange={(v) => void handlePhase(v as ProjectPhase)}
                  >
                    {PROJECT_PHASES.map((p) => <Picker.Item key={p.value} label={p.label} value={p.value} />)}
                  </Picker>
                </View>
              ) : (
                <Text style={styles.hint}>
                  Fase saat ini: {PROJECT_PHASES.find((p) => p.value === phase)?.label ?? phase}.
                  {'\n'}Hanya admin, prinsipal, atau estimator yang ditugaskan ke proyek ini yang dapat mengubahnya.
                </Text>
              )}
            </Card>

            <Card
              title={`Ruangan (${rooms.length})`}
              subtitle="Kode ruangan dibuat otomatis dan terkunci setelah labelnya dicetak."
              rightAction={
                <TouchableOpacity onPress={() => setSub('gates')} accessibilityRole="button">
                  <Text style={styles.linkBtn}>Kelola gerbang</Text>
                </TouchableOpacity>
              }
            >
              <View style={styles.btnRow}>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setMode(mode === 'add' ? 'none' : 'add')}>
                  <Ionicons name="add" size={16} color={COLORS.text} />
                  <Text style={styles.ghostText}>Tambah ruangan</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setMode(mode === 'paste' ? 'none' : 'paste')}>
                  <Ionicons name="clipboard-outline" size={16} color={COLORS.text} />
                  <Text style={styles.ghostText}>Tempel dari lembar</Text>
                </TouchableOpacity>
              </View>

              {mode === 'add' && <RoomForm saving={saving} onCancel={() => setMode('none')} onSubmit={handleAdd} />}
              {mode === 'paste' && <RoomPasteImport saving={saving} onCancel={() => setMode('none')} onImport={handleImport} />}

              {loading && <Text style={styles.empty}>Memuat…</Text>}

              {!loading && loadError && (
                <View>
                  <Text style={styles.errorText}>
                    Daftar ruangan gagal dimuat. Periksa koneksi lalu coba lagi.
                  </Text>
                  <TouchableOpacity onPress={() => void load()} style={styles.ghostBtn} accessibilityRole="button">
                    <Text style={styles.ghostText}>Coba lagi</Text>
                  </TouchableOpacity>
                </View>
              )}

              {!loading && !loadError && rooms.length === 0 && (
                <Text style={styles.empty}>Belum ada ruangan. Tambahkan satu per satu atau tempel daftarnya.</Text>
              )}

              {!loadError && byFloor.map(([floor, list]) => (
                <View key={floor} style={styles.floorGroup}>
                  <Text style={styles.floorHead}>{floor}</Text>
                  {list.map((r) => (
                    <View key={r.id} style={styles.roomRow}>
                      <TouchableOpacity
                        onPress={() => toggleSelected(r.id)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected.has(r.id) }}
                        accessibilityLabel={`Pilih ${r.room_name} untuk dicetak`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons
                          name={selected.has(r.id) ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={selected.has(r.id) ? COLORS.primary : COLORS.textMuted}
                        />
                      </TouchableOpacity>
                      <View style={styles.roomMeta}>
                        <Text style={[styles.roomName, !r.active && styles.roomOff]} numberOfLines={1}>
                          {r.room_name}
                        </Text>
                        <Text style={styles.roomSub}>
                          {r.room_code} · {AREA_TYPE_LABELS[r.area_type]}
                          {r.qr_printed_at ? ' · label tercetak' : ''}
                          {r.active ? '' : ' · nonaktif'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        disabled={busy}
                        onPress={async () => {
                          setBusy(true);
                          try {
                            const { error } = await setRoomActive(r.id, !r.active);
                            if (error) Alert.alert('Gagal', error); else await load();
                          } finally {
                            setBusy(false);
                          }
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={r.active ? `Nonaktifkan ${r.room_name}` : `Aktifkan ${r.room_name}`}
                      >
                        <Text style={[styles.linkBtn, busy && styles.btnDisabled]}>{r.active ? 'Nonaktifkan' : 'Aktifkan'}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              ))}
            </Card>

            <Card title="Label QR" subtitle="Cetak pada kertas A4, sembilan label per halaman.">
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.primaryBtn, (selected.size === 0 || busy) && styles.primaryBtnOff]}
                  disabled={selected.size === 0 || busy}
                  onPress={() => void handlePrint('selected')}
                >
                  <Text style={styles.primaryText}>Cetak {selected.size} terpilih</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.ghostBtn, busy && styles.btnDisabled]} disabled={busy}
                  onPress={() => void handlePrint('all')}
                >
                  <Ionicons name="qr-code-outline" size={16} color={COLORS.text} />
                  <Text style={styles.ghostText}>Cetak semua aktif</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.hint}>
                Mencetak mengunci kode ruangan: label yang sudah menempel di dinding tidak boleh berubah artinya.
              </Text>
            </Card>

            <Card title="Ekspor untuk DATUM" subtitle="Berkas JSON dalam bentuk area DATUM.">
              <TouchableOpacity
                style={[styles.ghostBtn, busy && styles.btnDisabled]} disabled={busy}
                onPress={handleDatumExport}
              >
                <Ionicons name="download-outline" size={16} color={COLORS.text} />
                <Text style={styles.ghostText}>Unduh JSON</Text>
              </TouchableOpacity>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  sectionHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.6, textTransform: 'uppercase',
    color: COLORS.textSec, marginBottom: SPACE.sm,
  },
  empty: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center', paddingVertical: SPACE.md },
  errorText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.critical, lineHeight: 18, marginBottom: SPACE.sm },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 16, marginTop: SPACE.sm },
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface, overflow: 'hidden' },
  btnRow: { flexDirection: 'row', gap: SPACE.sm, flexWrap: 'wrap' },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.md,
  },
  ghostText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.md },
  primaryBtnOff: { backgroundColor: COLORS.surfaceAlt },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
  btnDisabled: { opacity: 0.6 },
  linkBtn: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.info },
  floorGroup: { marginTop: SPACE.md },
  floorHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.4, textTransform: 'uppercase',
    color: COLORS.textSec, marginBottom: SPACE.xs,
  },
  roomRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub,
  },
  roomMeta: { flex: 1 },
  roomName: { fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.text },
  roomOff: { color: COLORS.textMuted, textDecorationLine: 'line-through' },
  roomSub: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
});
