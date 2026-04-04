import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Header from '../components/Header';
import Card from '../components/Card';
import Badge from '../components/Badge';
import PhotoSlot from '../components/PhotoSlot';
import DateSelectField, { getTodayIsoDate } from '../components/DateSelectField';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { isPositiveNumber, isNonEmpty, sanitizeText } from '../../tools/validation';
import { pickAndUploadPhoto } from '../../tools/storage';
import { signOut, updateProfile } from '../../tools/auth';
import { supabase } from '../../tools/supabase';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

export default function LainnyaScreen() {
  const { project, profile, refresh } = useProject();
  const { show: toast } = useToast();

  // Attendance
  const [attDate, setAttDate] = useState(getTodayIsoDate());
  const [attCount, setAttCount] = useState('');
  const [attStart, setAttStart] = useState('07:00');
  const [attEnd, setAttEnd] = useState('17:00');
  const [attNotes, setAttNotes] = useState('');

  // MTN
  const [mtnMat, setMtnMat] = useState('');
  const [mtnQty, setMtnQty] = useState('');
  const [mtnDest, setMtnDest] = useState('');
  const [mtnReason, setMtnReason] = useState('');
  const [mtnPhoto, setMtnPhoto] = useState<string | null>(null);

  // Micro-VO
  const [mvoLoc, setMvoLoc] = useState('');
  const [mvoDesc, setMvoDesc] = useState('');
  const [mvoReq, setMvoReq] = useState('');
  const [mvoMat, setMvoMat] = useState('');
  const [mvoCost, setMvoCost] = useState('');
  const [mvoPhoto, setMvoPhoto] = useState<string | null>(null);

  // Settings
  const [settingsName, setSettingsName] = useState(profile?.full_name ?? '');
  const [settingsPhone, setSettingsPhone] = useState(profile?.phone ?? '');

  const handleAttendance = async () => {
    if (!isPositiveNumber(attCount)) { toast('Masukkan jumlah pekerja', 'critical'); return; }
    try {
      const { error } = await supabase.from('attendance').insert({
        project_id: project!.id,
        recorded_by: profile!.id,
        date: attDate,
        worker_count: parseInt(attCount),
        start_time: attStart,
        end_time: attEnd,
        notes: attNotes ? sanitizeText(attNotes) : null,
      });
      if (error) throw error;
      await supabase.from('activity_log').insert({
        project_id: project!.id, user_id: profile!.id,
        type: 'attendance', label: `Kehadiran ${attCount} pekerja dicatat`, flag: 'OK',
      });
      toast(`Kehadiran ${attCount} pekerja dicatat`, 'ok');
      setAttCount(''); setAttNotes('');
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const handleMTN = async () => {
    if (!mtnMat || !isPositiveNumber(mtnQty) || !isNonEmpty(mtnDest) || !mtnPhoto) {
      toast('Lengkapi semua field MTN', 'critical'); return;
    }
    try {
      const { error } = await supabase.from('mtn_requests').insert({
        project_id: project!.id,
        requested_by: profile!.id,
        material_name: mtnMat,
        quantity: parseFloat(mtnQty),
        destination_project: sanitizeText(mtnDest),
        reason: sanitizeText(mtnReason),
        photo_path: mtnPhoto,
      });
      if (error) throw error;
      await supabase.from('activity_log').insert({
        project_id: project!.id, user_id: profile!.id,
        type: 'mtn', label: `MTN ${mtnMat} ${mtnQty} ke ${mtnDest}`, flag: 'INFO',
      });
      toast('MTN dikirim ke Estimator untuk persetujuan', 'ok');
      setMtnMat(''); setMtnQty(''); setMtnDest(''); setMtnReason(''); setMtnPhoto(null);
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const handleMicroVO = async () => {
    if (!isNonEmpty(mvoLoc) || !isNonEmpty(mvoDesc) || !isNonEmpty(mvoReq)) {
      toast('Lengkapi field wajib Micro-VO', 'critical'); return;
    }
    try {
      const { error } = await supabase.from('micro_vos').insert({
        project_id: project!.id,
        requested_by: profile!.id,
        location: sanitizeText(mvoLoc),
        description: sanitizeText(mvoDesc),
        requested_by_name: sanitizeText(mvoReq),
        est_material: mvoMat ? sanitizeText(mvoMat) : null,
        est_cost: mvoCost ? parseFloat(mvoCost) : null,
        photo_path: mvoPhoto,
      });
      if (error) throw error;
      await supabase.from('activity_log').insert({
        project_id: project!.id, user_id: profile!.id,
        type: 'micro_vo', label: `Micro-VO: ${sanitizeText(mvoDesc).slice(0, 40)}`, flag: 'INFO',
      });
      toast('Micro-VO dicatat — Estimator akan review bulanan', 'ok');
      setMvoLoc(''); setMvoDesc(''); setMvoReq(''); setMvoMat(''); setMvoCost(''); setMvoPhoto(null);
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const handleSaveSettings = async () => {
    try {
      await updateProfile({
        full_name: settingsName || profile!.full_name,
        phone: settingsPhone || null,
      });
      toast('Pengaturan disimpan', 'ok');
      refresh();
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Yakin ingin keluar?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const handlePhotoMTN = async () => {
    try {
      const path = await pickAndUploadPhoto(`mtn/${project!.id}`);
      if (path) { setMtnPhoto(path); toast('Foto diambil', 'ok'); }
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  const handlePhotoMVO = async () => {
    try {
      const path = await pickAndUploadPhoto(`mvo/${project!.id}`);
      if (path) { setMvoPhoto(path); toast('Foto diambil', 'ok'); }
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Attendance */}
        <Text style={styles.sectionHead}>Kehadiran Harian</Text>
        <Card title="Absensi Pekerja">
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Tanggal</Text>
              <DateSelectField value={attDate} onChange={setAttDate} placeholder="Pilih tanggal" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Jumlah Pekerja</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={attCount} onChangeText={setAttCount} placeholder="0" />
            </View>
          </View>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Jam Mulai</Text>
              <TextInput style={styles.input} value={attStart} onChangeText={setAttStart} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Jam Selesai</Text>
              <TextInput style={styles.input} value={attEnd} onChangeText={setAttEnd} />
            </View>
          </View>
          <Text style={styles.label}>Catatan</Text>
          <TextInput style={[styles.input, styles.textarea]} value={attNotes} onChangeText={setAttNotes} multiline placeholder="Contoh: 3 tukang besi, 5 tukang bata..." />
          <TouchableOpacity style={[styles.btn, { marginTop: 12 }]} onPress={handleAttendance}>
            <Text style={styles.btnText}>Simpan Kehadiran</Text>
          </TouchableOpacity>
        </Card>

        {/* MTN */}
        <Text style={styles.sectionHead}>MTN — Nota Transfer Material</Text>
        <Card title="Transfer Material Antar Proyek" subtitle="Material berlebih dipindah ke proyek lain atas persetujuan Estimator.">
          <Text style={styles.label}>Material <Text style={styles.req}>*</Text></Text>
          <TextInput style={styles.input} value={mtnMat} onChangeText={setMtnMat} placeholder="Nama material" />
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Jumlah <Text style={styles.req}>*</Text></Text>
              <TextInput style={styles.input} keyboardType="numeric" value={mtnQty} onChangeText={setMtnQty} placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Proyek Tujuan <Text style={styles.req}>*</Text></Text>
              <TextInput style={styles.input} value={mtnDest} onChangeText={setMtnDest} placeholder="Nama proyek" />
            </View>
          </View>
          <Text style={styles.label}>Alasan <Text style={styles.req}>*</Text></Text>
          <TextInput style={[styles.input, styles.textarea]} value={mtnReason} onChangeText={setMtnReason} multiline placeholder="Alasan transfer..." />
          <Text style={styles.label}>Foto Material <Text style={styles.req}>*</Text></Text>
          <PhotoSlot label="Foto Material yang Dipindah" captured={!!mtnPhoto} onPress={handlePhotoMTN} />
          <TouchableOpacity style={[styles.ghostBtn, { marginTop: 12 }]} onPress={handleMTN}>
            <Text style={styles.ghostBtnText}>Kirim MTN</Text>
          </TouchableOpacity>
        </Card>

        {/* Micro-VO */}
        <Text style={styles.sectionHead}>Micro-VO — Perubahan Kecil Lapangan</Text>
        <Card title="Catat Perubahan Klien" subtitle="Perubahan kecil saat kunjungan klien — perlu dicatat untuk kalkulasi margin.">
          <Text style={styles.label}>Lokasi Perubahan <Text style={styles.req}>*</Text></Text>
          <TextInput style={styles.input} value={mvoLoc} onChangeText={setMvoLoc} placeholder="Contoh: Kamar Mandi Utama Lt.2" />
          <Text style={styles.label}>Apa yang Berubah <Text style={styles.req}>*</Text></Text>
          <TextInput style={[styles.input, styles.textarea]} value={mvoDesc} onChangeText={setMvoDesc} multiline placeholder="Keramik diganti ukuran 80x80..." />
          <Text style={styles.label}>Diminta Oleh <Text style={styles.req}>*</Text></Text>
          <TextInput style={styles.input} value={mvoReq} onChangeText={setMvoReq} placeholder="Nama klien / PM" />
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Est. Material</Text>
              <TextInput style={styles.input} value={mvoMat} onChangeText={setMvoMat} placeholder="keramik +12 dus" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Est. Biaya (Rp)</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={mvoCost} onChangeText={setMvoCost} placeholder="0" />
            </View>
          </View>
          <Text style={styles.label}>Foto Bukti</Text>
          <PhotoSlot label="Foto Perubahan" captured={!!mvoPhoto} onPress={handlePhotoMVO} />
          <TouchableOpacity style={[styles.ghostBtn, { marginTop: 12 }]} onPress={handleMicroVO}>
            <Text style={styles.ghostBtnText}>Catat Micro-VO</Text>
          </TouchableOpacity>
        </Card>

        {/* Settings */}
        <Text style={styles.sectionHead}>Pengaturan</Text>
        <Card title="Profil Supervisor">
          <Text style={styles.label}>Nama</Text>
          <TextInput style={styles.input} value={settingsName} onChangeText={setSettingsName} />
          <Text style={styles.label}>Proyek Aktif</Text>
          <TextInput style={[styles.input, styles.disabled]} value={project?.name ?? '—'} editable={false} />
          <Text style={styles.fieldHint}>Proyek diassign oleh Estimator</Text>
          <Text style={styles.label}>No. WhatsApp</Text>
          <TextInput style={styles.input} value={settingsPhone} onChangeText={setSettingsPhone} placeholder="+62 812 ..." keyboardType="phone-pad" />
          <TouchableOpacity style={[styles.btn, { marginTop: 12 }]} onPress={handleSaveSettings}>
            <Text style={styles.btnText}>Simpan</Text>
          </TouchableOpacity>
        </Card>

        <Card>
          <Text style={styles.version}>SANO Operations v4.0</Text>
          <TouchableOpacity style={styles.dangerBtn} onPress={handleLogout}>
            <Text style={styles.dangerBtnText}>Logout</Text>
          </TouchableOpacity>
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
  label:        { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: 6, marginTop: SPACE.sm + 2 },
  req:          { color: COLORS.critical },
  input:        { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, color: COLORS.text },
  disabled:     { backgroundColor: COLORS.surfaceAlt, color: COLORS.textSec },
  textarea:     { minHeight: 80, textAlignVertical: 'top' },
  fieldHint:    { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: SPACE.xs },
  row2:         { flexDirection: 'row', gap: 10 },
  btn:          { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center' },
  btnText:      { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  ghostBtn:     { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, textTransform: 'uppercase' },
  dangerBtn:    { backgroundColor: COLORS.critical, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  dangerBtnText:{ color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  version:      { fontSize: TYPE.xs, color: COLORS.textSec, textAlign: 'center', marginBottom: SPACE.sm },
});
