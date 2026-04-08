import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import Header from '../components/Header';
import Card from '../components/Card';
import FlagPanel from '../components/FlagPanel';
import PhotoSlot from '../components/PhotoSlot';
import Badge from '../components/Badge';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { computeGate3Flag } from '../gates/gate3';
import { sanitizeText, isPositiveNumber } from '../../tools/validation';
import { pickAndUploadPhoto } from '../../tools/storage';
import { requestGps } from '../../tools/gps';
import { getPurchaseOrderDisplayNumber } from '../../tools/purchaseOrders';
import { supabase } from '../../tools/supabase';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
import type { GateResult, PurchaseOrder } from '../../tools/types';

interface ReceiptRecord {
  id: string;
  quantity_actual: number;
  vehicle_ref: string | null;
  created_at: string;
}

interface InboundMTN {
  id: string;
  material_name: string;
  quantity: number;
  unit: string | null;
  destination_project: string;
  reason: string | null;
  status: string;
  created_at: string;
}

export default function TerimaScreen() {
  const { purchaseOrders, project, profile, refresh } = useProject();
  const { show: toast } = useToast();

  const [poId, setPoId] = useState('');
  const [qtyActual, setQtyActual] = useState('');
  const [vehicleRef, setVehicleRef] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [photos, setPhotos] = useState<Record<string, string | null>>({
    surat_jalan: null, material_site: null, vehicle: null, tiket_timbang: null,
  });
  const [vehicleGps, setVehicleGps] = useState<{ lat: number; lon: number } | null>(null);

  // Receipt history for selected PO
  const [receiptHistory, setReceiptHistory] = useState<ReceiptRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Inbound MTN — approved transfers targeting this project
  const [inboundMtns, setInboundMtns] = useState<InboundMTN[]>([]);

  useEffect(() => {
    if (!project) return;
    supabase
      .from('mtn_requests')
      .select('id, material_name, quantity, unit, destination_project, reason, status, created_at')
      .eq('destination_project_id', project.id)
      .in('status', ['APPROVED', 'RECEIVED'])
      .order('created_at', { ascending: false })
      .then(({ data }) => setInboundMtns((data as InboundMTN[]) ?? []));
  }, [project]);

  const selectedPO = useMemo(() => purchaseOrders.find(p => p.id === poId), [purchaseOrders, poId]);
  const isReadymix = selectedPO?.material_name.toLowerCase().includes('readymix') ?? false;
  const requiredPhotos = isReadymix ? 4 : 3;

  const capturedCount = Object.entries(photos).filter(([key, val]) => {
    if (key === 'tiket_timbang' && !isReadymix) return false;
    return val !== null;
  }).length;

  // Load receipt history when PO changes
  const loadReceiptHistory = useCallback(async (poIdVal: string) => {
    if (!poIdVal) { setReceiptHistory([]); return; }
    setLoadingHistory(true);
    try {
      // Query from old material_receipts (backward compat) and new receipts table
      const { data: oldReceipts } = await supabase
        .from('material_receipts')
        .select('id, quantity_actual, notes, created_at')
        .eq('po_id', poIdVal)
        .order('created_at', { ascending: false });

      const { data: newReceipts } = await supabase
        .from('receipts')
        .select('id, vehicle_ref, created_at, receipt_lines(quantity_actual)')
        .eq('po_id', poIdVal)
        .order('created_at', { ascending: false });

      const combined: ReceiptRecord[] = [];

      // Old receipts
      for (const r of (oldReceipts ?? [])) {
        combined.push({ id: r.id, quantity_actual: r.quantity_actual, vehicle_ref: null, created_at: r.created_at });
      }

      // New receipts — sum lines
      for (const r of (newReceipts ?? [])) {
        const totalQty = ((r as any).receipt_lines ?? []).reduce((s: number, l: any) => s + (l.quantity_actual ?? 0), 0);
        combined.push({ id: r.id, quantity_actual: totalQty, vehicle_ref: r.vehicle_ref, created_at: r.created_at });
      }

      // Sort descending
      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setReceiptHistory(combined);
    } catch {
      setReceiptHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => { loadReceiptHistory(poId); }, [poId, loadReceiptHistory]);

  const totalReceived = receiptHistory.reduce((s, r) => s + r.quantity_actual, 0);
  const remainingQty = selectedPO ? selectedPO.quantity - totalReceived : 0;
  const poProgress = selectedPO && selectedPO.quantity > 0 ? Math.min(100, (totalReceived / selectedPO.quantity) * 100) : 0;

  // Derive PO status label
  const poStatusLabel = !selectedPO ? '' :
    totalReceived === 0 ? 'OPEN' :
    totalReceived >= selectedPO.quantity ? 'FULLY RECEIVED' :
    'PARTIAL';

  const gateResult: GateResult | null = useMemo(() => {
    if (!selectedPO || !qtyActual) return null;
    const q = parseFloat(qtyActual);
    if (isNaN(q) || q <= 0) return null;
    return computeGate3Flag(selectedPO, q, null, {
      total_received: totalReceived,
      total_planned: selectedPO.quantity,
      unit: selectedPO.unit,
    });
  }, [selectedPO, qtyActual, totalReceived]);

  const handlePhoto = async (type: string) => {
    try {
      const folder = `receipts/${project!.id}/${type}`;
      const path = await pickAndUploadPhoto(folder);
      if (path) {
        setPhotos(prev => ({ ...prev, [type]: path }));
        if (type === 'vehicle') {
          const gps = await requestGps();
          setVehicleGps(gps);
          toast(gps ? 'Foto + GPS OK' : 'Foto diambil — GPS tidak tersedia', gps ? 'ok' : 'warning');
        } else {
          toast('Foto diambil', 'ok');
        }
      }
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  const resetForm = () => {
    setQtyActual(''); setVehicleRef(''); setNotes('');
    setPhotos({ surat_jalan: null, material_site: null, vehicle: null, tiket_timbang: null });
    setVehicleGps(null);
  };

  const handleSubmit = async (isFinal: boolean) => {
    if (!poId || !isPositiveNumber(qtyActual)) {
      toast('Pilih PO dan masukkan jumlah', 'critical'); return;
    }
    if (capturedCount < requiredPhotos) {
      toast(`Ambil semua ${requiredPhotos} foto`, 'critical'); return;
    }
    if (!vehicleGps) {
      toast('Foto kendaraan harus memiliki GPS', 'critical'); return;
    }

    setSubmitting(true);
    try {
      // 1. Create receipt header
      const { data: receipt, error: rcptErr } = await supabase
        .from('receipts')
        .insert({
          po_id: poId,
          project_id: project!.id,
          received_by: profile!.id,
          vehicle_ref: vehicleRef ? sanitizeText(vehicleRef) : null,
          gate3_flag: gateResult?.flag ?? 'OK',
          gate3_details: gateResult,
          notes: notes ? sanitizeText(notes) : null,
        })
        .select('id')
        .single();

      if (rcptErr || !receipt) throw rcptErr || new Error('Receipt insert failed');

      // 2. Create receipt line
      await supabase.from('receipt_lines').insert({
        receipt_id: receipt.id,
        material_name: selectedPO!.material_name,
        quantity_actual: parseFloat(qtyActual),
        unit: selectedPO!.unit,
      });

      // 3. Insert receipt photos
      const photoInserts = Object.entries(photos)
        .filter(([key, val]) => val !== null && (key !== 'tiket_timbang' || isReadymix))
        .map(([key, val]) => ({
          receipt_id: receipt.id,
          photo_type: key,
          storage_path: val!,
          gps_lat: key === 'vehicle' ? vehicleGps?.lat : null,
          gps_lon: key === 'vehicle' ? vehicleGps?.lon : null,
        }));

      if (photoInserts.length > 0) {
        await supabase.from('receipt_photos').insert(photoInserts);
      }

      // 4. Update PO status (will move to backend trigger later)
      const newTotal = totalReceived + parseFloat(qtyActual);
      let newPoStatus: string;
      if (isFinal || newTotal >= selectedPO!.quantity) {
        newPoStatus = 'FULLY_RECEIVED';
      } else {
        newPoStatus = 'PARTIAL_RECEIVED';
      }
      await supabase.from('purchase_orders').update({ status: newPoStatus }).eq('id', poId);

      // 5. Activity log
      await supabase.from('activity_log').insert({
        project_id: project!.id,
        user_id: profile!.id,
        type: 'terima',
        label: `${selectedPO!.material_name} ${qtyActual} ${selectedPO!.unit} diterima (${isFinal ? 'Final' : 'Parsial'})`,
        flag: gateResult?.flag ?? 'OK',
      });

      resetForm();
      await loadReceiptHistory(poId);
      await refresh();
      toast(`${isFinal ? 'Penerimaan final' : 'Penerimaan parsial'} dicatat — ${qtyActual} ${selectedPO!.unit}`, 'ok');
    } catch (err: any) {
      console.warn('Receipt submit failed:', err?.message ?? err);
      toast(err?.message ?? 'Gagal menyimpan penerimaan', 'critical');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.sectionHead}>Gate 3 — Penerimaan Material</Text>

        {/* Inbound MTN */}
        {inboundMtns.length > 0 && (
          <Card title={`${inboundMtns.length} MTN Masuk`} borderColor={COLORS.info} subtitle="Transfer material dari proyek lain yang disetujui — catat penerimaan di sini.">
            {inboundMtns.map(m => (
              <View key={m.id} style={styles.mtnRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mtnTitle}>{m.material_name}</Text>
                  <Text style={styles.hint}>{m.quantity}{m.unit ? ` ${m.unit}` : ''} · {new Date(m.created_at).toLocaleDateString('id-ID')}</Text>
                  {m.reason ? <Text style={styles.hint}>{m.reason}</Text> : null}
                </View>
                <Badge flag={m.status === 'RECEIVED' ? 'OK' : 'INFO'} label={m.status} />
              </View>
            ))}
          </Card>
        )}

        {/* PO summary */}
        <Card title={`${purchaseOrders.length} PO Aktif`} borderColor={purchaseOrders.length > 0 ? COLORS.warning : COLORS.ok}>
          <Text style={styles.hint}>Pilih PO untuk melakukan penerimaan parsial atau final.</Text>
        </Card>

        {/* PO selector */}
        <Card title="Penerimaan Baru">
          <Text style={styles.label}>Pilih PO <Text style={styles.req}>*</Text></Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={poId} onValueChange={v => { setPoId(v); resetForm(); }} style={{ color: COLORS.text }}>
              <Picker.Item label="-- Pilih PO --" value="" />
              {purchaseOrders.map(po => (
                <Picker.Item
                  key={po.id}
                  label={`${getPurchaseOrderDisplayNumber(po)} · ${po.material_name} ${po.quantity} ${po.unit}`}
                  value={po.id}
                />
              ))}
            </Picker>
          </View>

          {selectedPO && (
            <>
              {/* PO detail with receipt progress */}
              <View style={styles.poCard}>
                <Text style={styles.poCode}>{getPurchaseOrderDisplayNumber(selectedPO)}</Text>
                <Text style={styles.poTitle}>{selectedPO.material_name}</Text>
                <Text style={styles.poSub}>
                  {selectedPO.supplier} — {selectedPO.boq_ref}
                </Text>

                <View style={styles.poMetrics}>
                  <View style={styles.poMetric}>
                    <Text style={styles.poMetricValue}>{selectedPO.quantity}</Text>
                    <Text style={styles.hint}>Dipesan</Text>
                  </View>
                  <View style={styles.poMetric}>
                    <Text style={[styles.poMetricValue, { color: COLORS.ok }]}>{totalReceived.toFixed(1)}</Text>
                    <Text style={styles.hint}>Diterima</Text>
                  </View>
                  <View style={styles.poMetric}>
                    <Text style={[styles.poMetricValue, { color: remainingQty > 0 ? COLORS.warning : COLORS.ok }]}>{remainingQty.toFixed(1)}</Text>
                    <Text style={styles.hint}>Sisa</Text>
                  </View>
                </View>

                <View style={styles.progressBarWrap}>
                  <View style={[styles.progressBarFill, { width: `${poProgress}%` }]} />
                </View>

                <View style={styles.poStatusRow}>
                  <Badge flag={poStatusLabel === 'FULLY RECEIVED' ? 'OK' : poStatusLabel === 'PARTIAL' ? 'WARNING' : 'INFO'} label={poStatusLabel} />
                  <Text style={styles.hint}>{selectedPO.unit}</Text>
                </View>
              </View>

              {/* Receipt history */}
              {receiptHistory.length > 0 && (
                <>
                  <Text style={styles.label}>Riwayat Penerimaan</Text>
                  {receiptHistory.map((r, idx) => (
                    <View key={r.id} style={styles.historyRow}>
                      <Text style={styles.historyNum}>#{idx + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyQty}>{r.quantity_actual} {selectedPO.unit}</Text>
                        {r.vehicle_ref && <Text style={styles.hint}>{r.vehicle_ref}</Text>}
                      </View>
                      <Text style={styles.hint}>{new Date(r.created_at).toLocaleDateString('id-ID')}</Text>
                    </View>
                  ))}
                </>
              )}

              {/* New receipt form */}
              {remainingQty > 0 && (
                <>
                  <Text style={styles.label}>Jumlah Diterima <Text style={styles.req}>*</Text></Text>
                  <View style={styles.row2}>
                    <TextInput style={[styles.input, { flex: 1 }]} keyboardType="numeric" value={qtyActual} onChangeText={setQtyActual} placeholder="0" />
                    <TextInput style={[styles.input, styles.disabled, { flex: 1 }]} value={selectedPO.unit} editable={false} />
                  </View>
                  <Text style={styles.fieldHint}>Sisa yang harus diterima: {remainingQty.toFixed(1)} {selectedPO.unit}</Text>

                  <Text style={styles.label}>Referensi Kendaraan</Text>
                  <TextInput style={styles.input} value={vehicleRef} onChangeText={setVehicleRef} placeholder="Plat nomor / ID shipment" />

                  <Text style={styles.label}>Foto Bukti <Text style={styles.req}>*</Text></Text>
                  <Text style={styles.hint}>{requiredPhotos} foto wajib.</Text>
                  <View style={styles.photoGrid}>
                    <PhotoSlot label="1. Surat Jalan" captured={!!photos.surat_jalan} photoPath={photos.surat_jalan} helperText="Ketuk foto untuk ganti." onPress={() => handlePhoto('surat_jalan')} />
                    <PhotoSlot label="2. Material" captured={!!photos.material_site} photoPath={photos.material_site} helperText="Ketuk foto untuk ganti." onPress={() => handlePhoto('material_site')} />
                    <PhotoSlot label="3. Kendaraan + GPS" captured={!!photos.vehicle} photoPath={photos.vehicle} helperText="Ketuk foto untuk ganti." onPress={() => handlePhoto('vehicle')} gpsLabel={vehicleGps ? `${vehicleGps.lat}, ${vehicleGps.lon}` : undefined} />
                    {isReadymix && <PhotoSlot label="4. Tiket Timbang" captured={!!photos.tiket_timbang} photoPath={photos.tiket_timbang} helperText="Ketuk foto untuk ganti." onPress={() => handlePhoto('tiket_timbang')} />}
                  </View>

                  <Text style={styles.label}>Catatan</Text>
                  <TextInput style={[styles.input, styles.textarea]} value={notes} onChangeText={setNotes} multiline placeholder="Catatan penerimaan..." />

                  <FlagPanel result={gateResult} gateLabel="Gate 3" />

                  {/* Two buttons: partial and final */}
                  <View style={styles.submitRow}>
                    <TouchableOpacity
                      style={[styles.btn, styles.partialBtn]}
                      onPress={() => handleSubmit(false)}
                      disabled={submitting}
                      accessibilityRole="button"
                      accessibilityLabel="Simpan penerimaan parsial"
                      accessibilityState={{ disabled: submitting, busy: submitting }}
                    >
                      <Text style={styles.btnText}>{submitting ? '...' : 'Simpan Parsial'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.btn}
                      onPress={() => handleSubmit(true)}
                      disabled={submitting}
                      accessibilityRole="button"
                      accessibilityLabel="Konfirmasi penerimaan final"
                      accessibilityState={{ disabled: submitting, busy: submitting }}
                    >
                      <Text style={styles.btnText}>{submitting ? '...' : 'Terima Final'}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {remainingQty <= 0 && (
                <View style={[styles.doneBox]}>
                  <Text style={[styles.doneText, { color: COLORS.ok }]}>PO ini sudah diterima sepenuhnya.</Text>
                </View>
              )}
            </>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },

  sectionHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 0.8,
    textTransform: 'uppercase', color: COLORS.textSec,
    marginBottom: SPACE.sm, marginTop: SPACE.base,
  },
  label: {
    fontSize: TYPE.sm, fontFamily: FONTS.semibold,
    color: COLORS.text, marginBottom: SPACE.xs, marginTop: SPACE.md,
  },
  req: { color: COLORS.critical },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingVertical: SPACE.md - 1, paddingHorizontal: SPACE.md,
    fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text,
  },
  disabled:   { backgroundColor: COLORS.surfaceAlt, color: COLORS.textSec },
  textarea:   { minHeight: 80, textAlignVertical: 'top', paddingTop: SPACE.md - 1 },
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface },
  hint:       { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2, lineHeight: 17 },
  fieldHint:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs, lineHeight: 17 },
  row2:       { flexDirection: 'row', gap: SPACE.sm },
  photoGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.sm },

  // PO detail card
  poCard:        { backgroundColor: 'rgba(20,18,16,0.03)', borderRadius: RADIUS, padding: SPACE.md, marginTop: SPACE.md },
  poCode:        { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.primary, letterSpacing: 0.5, marginBottom: 4 },
  poTitle:       { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text },
  poSub:         { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  poMetrics:     { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  poMetric:      { flex: 1, alignItems: 'center' },
  poMetricValue: { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text, letterSpacing: -0.3 },
  progressBarWrap: { backgroundColor: 'rgba(20,18,16,0.07)', borderRadius: 4, height: 6, overflow: 'hidden', marginTop: SPACE.sm },
  progressBarFill: { height: '100%', borderRadius: 4, backgroundColor: COLORS.accent },
  poStatusRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACE.sm },

  // Inbound MTN
  mtnRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub, gap: SPACE.sm },
  mtnTitle: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },

  // Receipt history
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  historyNum: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.textSec, width: 24 },
  historyQty: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },

  // Submit
  submitRow:  { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.base },
  btn:        { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.md + 2, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  partialBtn: { backgroundColor: COLORS.accentDark },
  btnText:    { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase', letterSpacing: 0.3 },

  // Done
  doneBox:  { padding: SPACE.base, borderRadius: RADIUS, backgroundColor: COLORS.okBg, marginTop: SPACE.md, alignItems: 'center' },
  doneText: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.ok },
});
