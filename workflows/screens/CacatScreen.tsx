import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import Header from '../components/Header';
import Card from '../components/Card';
import StatTile from '../components/StatTile';
import Badge from '../components/Badge';
import PhotoGalleryField from '../components/PhotoGalleryField';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { transitionDefect } from '../../tools/defectLifecycle';
import { validateDefect, sanitizeText } from '../../tools/validation';
import { pickAndUploadPhoto } from '../../tools/storage';
import { supabase } from '../../tools/supabase';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

const SEVERITY_OPTIONS = ['Minor', 'Major', 'Critical'] as const;
const SEV_COLORS: Record<string, string> = { Minor: COLORS.info, Major: COLORS.warning, Critical: COLORS.critical };
const STATUS_COLORS: Record<string, string> = { OPEN: COLORS.critical, 'IN_REPAIR': COLORS.warning, RESOLVED: COLORS.info, VERIFIED: COLORS.ok };

export default function CacatScreen() {
  const { boqItems, defects, project, profile, refresh } = useProject();
  const { show: toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [boqRef, setBoqRef] = useState('');
  const [loc, setLoc] = useState('');
  const [desc, setDesc] = useState('');
  const [severity, setSeverity] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const openCount = defects.filter(d => d.status === 'OPEN').length;
  const repairCount = defects.filter(d => d.status === 'IN_REPAIR').length;
  const verifiedCount = defects.filter(d => d.status === 'VERIFIED').length;

  // Punch list clearance
  const critOpen = defects.filter(d => d.status === 'OPEN' && d.severity === 'Critical').length;
  const majorOpen = defects.filter(d => ['OPEN', 'IN_REPAIR'].includes(d.status) && d.severity === 'Major').length;
  const eligible = critOpen === 0 && majorOpen === 0;

  const handlePhoto = async (replaceIndex?: number) => {
    try {
      const path = await pickAndUploadPhoto(`defects/${project!.id}`);
      if (!path) return;
      setPhotos(prev => {
        if (replaceIndex == null || replaceIndex < 0 || replaceIndex >= prev.length) {
          return [...prev, path];
        }
        return prev.map((photo, index) => (index === replaceIndex ? path : photo));
      });
      toast(replaceIndex == null ? 'Foto cacat ditambahkan' : 'Foto cacat diganti', 'ok');
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, photoIndex) => photoIndex !== index));
    toast('Foto dihapus', 'warning');
  };

  const handleRepairConfirm = async (defectId: string) => {
    try {
      const result = await transitionDefect(defectId, 'RESOLVED', profile!.role, profile!.id);
      if (!result.success) throw new Error(result.error ?? 'Transisi gagal');
      toast(`Cacat dikonfirmasi perbaikan — status: RESOLVED`, 'ok');
      refresh();
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const handleSubmit = async () => {
    const error = validateDefect({ boqRef, location: loc, description: desc, severity, hasPhoto: photos.length > 0 });
    if (error) { toast(error, 'critical'); return; }

    setSubmitting(true);
    try {
      const { data: defectEntry, error: dbError } = await supabase.from('defects').insert({
        project_id: project!.id,
        boq_ref: boqRef,
        location: sanitizeText(loc),
        description: sanitizeText(desc),
        severity,
        photo_path: photos[0] ?? null,
        reported_by: profile!.id,
      }).select('id').single();
      if (dbError || !defectEntry) throw dbError ?? new Error('Defect insert failed');

      if (photos.length > 0) {
        const { error: photoError } = await supabase.from('defect_photos').insert(
          photos.map((path) => ({
            defect_id: defectEntry.id,
            photo_kind: 'report',
            storage_path: path,
            captured_at: new Date().toISOString(),
          })),
        );
        if (photoError) throw photoError;
      }

      await supabase.from('activity_log').insert({
        project_id: project!.id,
        user_id: profile!.id,
        type: 'cacat',
        label: `Cacat baru: ${sanitizeText(desc).slice(0, 50)} (${severity})`,
        flag: 'WARNING',
      });

      setShowForm(false);
      setBoqRef(''); setLoc(''); setDesc(''); setSeverity(null); setPhotos([]);
      await refresh();
      toast('Cacat baru dicatat — status: OPEN', 'ok');
    } catch (err: any) {
      console.warn('Defect submit failed:', err?.message ?? err);
      toast(err?.message ?? 'Gagal menyimpan cacat', 'critical');
    } finally {
      setSubmitting(false);
    }
  };

  const handleHandover = async () => {
    toast('Permintaan serah terima dikirim ke Prinsipal untuk persetujuan akhir', 'ok');
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.sectionHead}>Punch List & Cacat</Text>

        <View style={styles.statRow}>
          <StatTile value={openCount} label="Open" color={COLORS.critical} />
          <StatTile value={repairCount} label="In Repair" color={COLORS.warning} />
          <StatTile value={verifiedCount} label="Verified" color={COLORS.ok} />
        </View>

        {defects.map(d => (
          <Card key={d.id} borderColor={STATUS_COLORS[d.status]}>
            <View style={styles.defectHeader}>
              <View>
                <Text style={styles.defectId}>{d.id.slice(0, 8)}</Text>
                <Text style={styles.defectBoq}>{d.boq_ref}</Text>
              </View>
              <Badge flag={d.status === 'OPEN' ? 'CRITICAL' : d.status === 'IN_REPAIR' ? 'WARNING' : d.status === 'RESOLVED' ? 'INFO' : 'OK'} label={d.status} />
            </View>
            <Text style={styles.hint}>{d.location}</Text>
            <Text style={styles.defectDesc}>{d.description}</Text>
            <View style={styles.defectFooter}>
              <Badge flag={d.severity === 'Critical' ? 'CRITICAL' : d.severity === 'Major' ? 'WARNING' : 'INFO'} label={d.severity} />
              <Text style={styles.hint}>{new Date(d.reported_at).toLocaleDateString('id-ID')}</Text>
            </View>
            {d.status === 'IN_REPAIR' && (
              <>
                <View style={styles.divider} />
                <Text style={styles.hint}>Subkontraktor sudah memperbaiki? Tandai selesai dikerjakan.</Text>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => handleRepairConfirm(d.id)}>
                  <Text style={styles.ghostBtnText}>Tandai Selesai Dikerjakan</Text>
                </TouchableOpacity>
              </>
            )}
          </Card>
        ))}

        <TouchableOpacity style={styles.accentBtn} onPress={() => setShowForm(!showForm)}>
          <Text style={styles.accentBtnText}>+ Catat Cacat Baru</Text>
        </TouchableOpacity>

        {showForm && (
          <Card title="Cacat Baru" style={{ marginTop: 12 }}>
            <Text style={styles.label}>Item BoQ <Text style={styles.req}>*</Text></Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={boqRef} onValueChange={setBoqRef}>
                <Picker.Item label="-- Pilih --" value="" />
                {boqItems.map(b => (
                  <Picker.Item key={b.id} label={`${b.code} — ${b.label}`} value={`${b.code} — ${b.label}`} />
                ))}
              </Picker>
            </View>

            <Text style={styles.label}>Lokasi Spesifik <Text style={styles.req}>*</Text></Text>
            <TextInput style={styles.input} value={loc} onChangeText={setLoc} placeholder="Lt.2, Kamar Tidur Utama, Dinding Selatan" />

            <Text style={styles.label}>Deskripsi <Text style={styles.req}>*</Text></Text>
            <TextInput style={[styles.input, styles.textarea]} value={desc} onChangeText={setDesc} multiline placeholder="Plesteran retak rambut sepanjang 2m" />

            <Text style={styles.label}>Keparahan <Text style={styles.req}>*</Text></Text>
            <View style={styles.sevRow}>
              {SEVERITY_OPTIONS.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.sevChip, severity === s && { borderColor: SEV_COLORS[s], backgroundColor: `${SEV_COLORS[s]}15` }]}
                  onPress={() => setSeverity(s)}
                >
                  <Text style={[styles.sevText, severity === s && { color: SEV_COLORS[s] }]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Foto Bukti <Text style={styles.req}>*</Text></Text>
            <PhotoGalleryField
              photoPaths={photos}
              onAdd={() => handlePhoto()}
              onReplace={handlePhoto}
              onRemove={removePhoto}
              emptyLabel="Tambah Foto Cacat"
              helperText="Tambahkan beberapa foto jika cacat perlu dilihat dari beberapa sudut."
            />

            <TouchableOpacity style={[styles.btn, { marginTop: 16 }]} onPress={handleSubmit} disabled={submitting}>
              <Text style={styles.btnText}>{submitting ? 'Menyimpan...' : 'Simpan Cacat'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.ghostBtn, { marginTop: 8 }]} onPress={() => setShowForm(false)}>
              <Text style={styles.ghostBtnText}>Batal</Text>
            </TouchableOpacity>
          </Card>
        )}

        <Text style={styles.sectionHead}>Status Serah Terima</Text>
        <Card borderColor={eligible ? COLORS.ok : COLORS.critical}>
          <Text style={styles.cardTitle}>Status Punch List — Serah Terima</Text>
          <View style={[styles.eligibleBox, { backgroundColor: eligible ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.08)' }]}>
            <Text style={[styles.eligibleLabel, { color: eligible ? COLORS.ok : COLORS.critical }]}>
              {eligible ? 'ELIGIBLE — Siap Serah Terima' : 'BELUM ELIGIBLE'}
            </Text>
            <Text style={styles.hint}>
              {eligible
                ? 'Semua Critical dan Major telah diselesaikan.'
                : 'Selesaikan semua cacat Critical dan Major sebelum serah terima.'}
            </Text>
          </View>
          {eligible && (
            <TouchableOpacity style={styles.accentBtn} onPress={handleHandover}>
              <Text style={styles.accentBtnText}>Ajukan Serah Terima ke Prinsipal</Text>
            </TouchableOpacity>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex:         { flex: 1, backgroundColor: COLORS.bg },
  scroll:       { flex: 1 },
  content:      { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  sectionHead:  { fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 1, textTransform: 'uppercase', color: COLORS.textSec, marginBottom: SPACE.sm + 2, marginTop: SPACE.base },
  statRow:      { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },
  defectHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  defectId:     { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  defectBoq:    { fontSize: TYPE.sm, fontFamily: FONTS.semibold, marginTop: 2 },
  defectDesc:   { fontSize: TYPE.sm, marginBottom: SPACE.sm },
  defectFooter: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  hint:         { fontSize: TYPE.xs, color: COLORS.textSec, marginBottom: SPACE.xs },
  divider:      { height: 1, backgroundColor: 'rgba(148,148,148,0.2)', marginVertical: SPACE.sm + 2 },
  label:        { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: 6, marginTop: SPACE.md },
  req:          { color: COLORS.critical },
  input:        { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, color: COLORS.text },
  textarea:     { minHeight: 80, textAlignVertical: 'top' },
  pickerWrap:   { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface, overflow: 'hidden' },
  sevRow:       { flexDirection: 'row', gap: SPACE.sm },
  sevChip:      { flex: 1, padding: 10, borderWidth: 2, borderColor: COLORS.border, borderRadius: RADIUS, alignItems: 'center' },
  sevText:      { fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase', color: COLORS.textSec },
  btn:          { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center' },
  btnText:      { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  ghostBtn:     { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: 10, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, textTransform: 'uppercase' },
  accentBtn:    { backgroundColor: COLORS.accent, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center' },
  accentBtnText:{ color: COLORS.primary, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  cardTitle:    { fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase', marginBottom: SPACE.sm },
  eligibleBox:  { padding: SPACE.md, borderRadius: RADIUS, marginBottom: SPACE.sm + 2 },
  eligibleLabel:{ fontSize: TYPE.sm, fontFamily: FONTS.bold, letterSpacing: 0.5 },
});
