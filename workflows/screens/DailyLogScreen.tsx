import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import SelectSheet from '../components/SelectSheet';
import PhotoGalleryField from '../components/PhotoGalleryField';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { pickAndUploadPhoto } from '../../tools/storage';
import { sanitizeText } from '../../tools/validation';
import { getDailyLog, upsertDailyLog, type DailyLogHighlight, type DailyLogPhoto } from '../../tools/dailySiteLogs';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DailyLogScreen({ onBack, initialDate }: { onBack: () => void; initialDate?: string }) {
  const { project, profile, boqItems, refresh } = useProject();
  const { show: toast } = useToast();

  const [logDate] = useState(initialDate ?? todayIso());
  const [weather, setWeather] = useState('');
  const [crewTotal, setCrewTotal] = useState('');
  const [crewBreakdown, setCrewBreakdown] = useState('');
  const [safety, setSafety] = useState('0');
  const [highlights, setHighlights] = useState<DailyLogHighlight[]>([{ area: '', note: '', boq_item_id: null, sort_order: 0 }]);
  const [photos, setPhotos] = useState<DailyLogPhoto[]>([]);
  const [saving, setSaving] = useState(false);

  const boqOptions = useMemo(() => {
    // Flat option list; label = "code — label". Optional link, so include a blank.
    return [{ value: '', label: '(Tanpa item BoQ)' }, ...boqItems.map((b) => ({ value: b.id, code: b.code, label: b.label }))];
  }, [boqItems]);

  const loadExisting = useCallback(async () => {
    if (!project) return;
    const existing = await getDailyLog(project.id, logDate);
    if (existing) {
      setWeather(existing.weather ?? '');
      setCrewTotal(existing.crew_total != null ? String(existing.crew_total) : '');
      setCrewBreakdown(existing.crew_breakdown ?? '');
      setSafety(String(existing.safety_incidents ?? 0));
      setHighlights(existing.highlights.length ? existing.highlights : [{ area: '', note: '', boq_item_id: null, sort_order: 0 }]);
      setPhotos(existing.photos);
    }
  }, [project, logDate]);

  useEffect(() => { loadExisting(); }, [loadExisting]);

  const updateHighlight = (i: number, patch: Partial<DailyLogHighlight>) =>
    setHighlights((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  const addHighlight = () => setHighlights((prev) => [...prev, { area: '', note: '', boq_item_id: null, sort_order: prev.length }]);
  const removeHighlight = (i: number) => setHighlights((prev) => prev.filter((_, idx) => idx !== i));

  const addPhoto = async () => {
    if (!project) return;
    const path = await pickAndUploadPhoto(`daily-log/${project.id}`);
    if (!path) return;
    setPhotos((prev) => [...prev, { storage_path: path, caption: null, is_featured: true, captured_at: new Date().toISOString() }]);
  };
  const removePhoto = (i: number) => setPhotos((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!project || !profile) return;
    setSaving(true);
    try {
      await upsertDailyLog({
        project_id: project.id,
        log_date: logDate,
        weather: weather ? sanitizeText(weather) : null,
        crew_total: crewTotal ? parseInt(crewTotal, 10) : null,
        crew_breakdown: crewBreakdown ? sanitizeText(crewBreakdown) : null,
        safety_incidents: parseInt(safety || '0', 10),
        author_id: profile.id,
        highlights: highlights
          .filter((h) => h.area.trim() || h.note.trim())
          .map((h, i) => ({ ...h, area: sanitizeText(h.area), note: sanitizeText(h.note), sort_order: i })),
        photos,
      });
      toast('Log harian disimpan', 'ok');
      await refresh();
      onBack();
    } catch (err: any) {
      toast(err.message ?? 'Gagal menyimpan log', 'critical');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={onBack} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color={COLORS.textSec} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>
        <Text style={styles.head}>Log Harian — {logDate}</Text>

        <Card title="Kondisi Hari Ini">
          <Text style={styles.label}>Cuaca</Text>
          <TextInput style={styles.input} value={weather} onChangeText={setWeather} placeholder="Cerah / Hujan / Berawan" />
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Tenaga Kerja</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={crewTotal} onChangeText={setCrewTotal} placeholder="8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Insiden K3</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={safety} onChangeText={setSafety} placeholder="0" />
            </View>
          </View>
          <Text style={styles.label}>Rincian Tenaga Kerja</Text>
          <TextInput style={styles.input} value={crewBreakdown} onChangeText={setCrewBreakdown} placeholder="3 tukang · 2 kenek · 1 mandor" />
        </Card>

        <Card title="Update Lapangan" subtitle="Catatan progres naratif. Kaitkan ke item BoQ bila relevan (opsional).">
          {highlights.map((h, i) => (
            <View key={i} style={styles.hlBlock}>
              <View style={styles.hlHead}>
                <Text style={styles.hlNum}>#{i + 1}</Text>
                {highlights.length > 1 && (
                  <TouchableOpacity onPress={() => removeHighlight(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle-outline" size={20} color={COLORS.critical} />
                  </TouchableOpacity>
                )}
              </View>
              <TextInput style={styles.input} value={h.area} onChangeText={(v) => updateHighlight(i, { area: v })} placeholder="Area (mis. Tangga)" />
              <TextInput style={[styles.input, styles.textarea]} value={h.note} onChangeText={(v) => updateHighlight(i, { note: v })} multiline placeholder="Catatan progres..." />
              <Text style={styles.linkLabel}>Kaitkan item BoQ (opsional)</Text>
              <SelectSheet
                value={h.boq_item_id ?? ''}
                options={boqOptions}
                onChange={(v) => updateHighlight(i, { boq_item_id: v || null })}
                placeholder="(Tanpa item BoQ)"
                title="Pilih item BoQ"
              />
            </View>
          ))}
          <TouchableOpacity style={styles.addRow} onPress={addHighlight}>
            <Ionicons name="add" size={16} color={COLORS.primary} />
            <Text style={styles.addText}>Tambah update</Text>
          </TouchableOpacity>
        </Card>

        <Card title="Dokumentasi" subtitle="Foto yang ditandai akan muncul di laporan klien.">
          <PhotoGalleryField
            photoPaths={photos.map((p) => p.storage_path)}
            onAdd={addPhoto}
            onReplace={(_index) => addPhoto()}
            onRemove={removePhoto}
            emptyLabel="Tambah Foto Lapangan"
            helperText="Foto kondisi lapangan, progres, atau material."
          />
        </Card>

        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
          <Text style={styles.saveText}>{saving ? 'Menyimpan...' : 'Simpan Log Harian'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxl },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
  head: { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text, marginBottom: SPACE.md },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: SPACE.xs + 2, marginTop: SPACE.md },
  linkLabel: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, marginBottom: SPACE.xs + 2, marginTop: SPACE.md },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text },
  textarea: { minHeight: 70, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: SPACE.md - 2 },
  hlBlock: { borderBottomWidth: 1, borderBottomColor: COLORS.borderSub, paddingBottom: SPACE.md, marginBottom: SPACE.sm },
  hlHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACE.sm },
  hlNum: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.accent, letterSpacing: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingVertical: SPACE.sm, marginTop: SPACE.xs },
  addText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center', marginTop: SPACE.md },
  saveText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
});
