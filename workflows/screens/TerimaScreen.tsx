import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Header from '../components/Header';
import Card from '../components/Card';
import SelectSheet from '../components/SelectSheet';
import FlagPanel from '../components/FlagPanel';
import PhotoSlot from '../components/PhotoSlot';
import Badge from '../components/Badge';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { computeGate3Flag } from '../gates/gate3';
import { sanitizeText } from '../../tools/validation';
import { pickAndUploadPhoto } from '../../tools/storage';
import { requestGps } from '../../tools/gps';
import { getPurchaseOrderDisplayNumber } from '../../tools/purchaseOrders';
import { supplierToBase, displayQty } from '../../tools/materialUnitConversion';
import { buildUnambiguousCatalogNameMap, normalizeCatalogName } from '../../tools/catalogNameIndex';
import { buildReceiptLinesPayload, type ReceiveLineDraft } from '../../tools/receiptLinesPayload';
import { generateClientReceiptId } from '../../tools/receiptIdempotency';
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

interface CatalogRow {
  id: string;
  name: string;
  unit: string;
  supplier_unit: string | null;
  base_qty_per_supplier_unit: number | null;
}

// A purchase_order_lines row for the selected PO (base-unit qty/unit as stored).
interface PoLine {
  id: string;
  material_id: string | null;
  material_name: string;
  quantity: number;
  unit: string;
}

// One receivable line resolved for the UI: the PO line (or a synthesized header
// line for legacy header-only POs) plus its catalog-derived factor/input unit.
interface EffectiveLine {
  key: string;                 // stable React key + lineQtys index
  po_line_id: string | null;   // real PO line id, or null for the header synthesis
  material_id: string | null;  // resolved catalog id for the payload/join
  material_name: string;
  quantity: number;            // ordered qty (base)
  baseUnit: string;            // stored/base unit
  factor: number | null;       // base per supplier unit; null ⇒ 1:1
  inputUnit: string;           // unit the supervisor types in (supplier or base)
  catalog: CatalogRow | null;  // for per-line display formatting
}

export default function TerimaScreen() {
  const { purchaseOrders, project, profile, refresh } = useProject();
  const { show: toast } = useToast();

  const [poId, setPoId] = useState('');
  // Per-line received quantities, keyed by EffectiveLine.key. The supervisor
  // types SUPPLIER units per line (batang for rebar); each is converted to base
  // (kg) before submit. Replaces the old single header-level qty (line-grain,
  // migration 070).
  const [lineQtys, setLineQtys] = useState<Record<string, string>>({});
  const [vehicleRef, setVehicleRef] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [photos, setPhotos] = useState<Record<string, string | null>>({
    surat_jalan: null, material_site: null, vehicle: null, tiket_timbang: null,
  });
  const [vehicleGps, setVehicleGps] = useState<{ lat: number; lon: number } | null>(null);

  // Idempotency key for this receive-form session (migration 062). Generated
  // ONCE on the first submit tap and reused across retries (a timeout-then-
  // resubmit must carry the SAME id so the server dedups instead of double-
  // booking). Cleared in resetForm, so a confirmed success or a PO switch
  // starts the next delivery with a fresh id. Stays null on runtimes with no
  // CSPRNG (native Hermes) → server sees NULL → legacy non-idempotent path.
  const clientReceiptIdRef = useRef<string | null>(null);

  // Receipt history for selected PO
  const [receiptHistory, setReceiptHistory] = useState<ReceiptRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // Per-PO-line received totals (base units), summed from receipt_lines.po_line_id
  // (migration 070). Legacy lines with NULL po_line_id aren't attributed to any
  // line — the per-line hint is best-effort; the header totals stay exact.
  const [receivedByLine, setReceivedByLine] = useState<Map<string, number>>(new Map());

  // Inbound MTN — approved transfers targeting this project
  const [inboundMtns, setInboundMtns] = useState<InboundMTN[]>([]);

  // Catalog lookup by EXACT material name (PO headers carry no material_id).
  // Carries the catalog `id` so receipts can link to the catalog row (the
  // received-vs-planned join key, migration 055). Rebar receives in batang;
  // anything unmatched stays as-is. The catalog is known to carry duplicate
  // names during the transition — a name matching 2+ rows maps to `null`
  // (ambiguous → no id link, no rebar factor), never an arbitrary duplicate.
  // Same contract as migration 055's own receipt_lines.material_id backfill
  // (055:56-73, "catalog has known duplicate names — never guess").
  const [catalogByName, setCatalogByName] = useState<Map<string, CatalogRow | null>>(new Map());
  // By-id lookup for line-grain: a PO line already carries material_id, so we
  // resolve its factor by id (exact) and only fall back to the name map for
  // lines with NULL material_id (migration 070). id lookups never hit the
  // duplicate-name ambiguity that forces the name map to null.
  const [catalogById, setCatalogById] = useState<Map<string, CatalogRow>>(new Map());

  useEffect(() => {
    supabase
      .from('material_catalog')
      .select('id, name, unit, supplier_unit, base_qty_per_supplier_unit')
      .then(({ data }) => {
        const rows = (data as CatalogRow[]) ?? [];
        setCatalogByName(buildUnambiguousCatalogNameMap(rows));
        setCatalogById(new Map(rows.map(r => [r.id, r])));
      });
  }, []);

  // Purchase-order lines for the selected PO — the unit of receiving now (each
  // line settled separately with its own material identity). Supervisors have
  // SELECT on purchase_order_lines for POs in their assigned project
  // (002:962-971 po_lines_assigned_select).
  const [poLines, setPoLines] = useState<PoLine[]>([]);
  useEffect(() => {
    if (!poId) { setPoLines([]); return; }
    supabase
      .from('purchase_order_lines')
      .select('id, material_id, material_name, quantity, unit')
      .eq('po_id', poId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setPoLines((data as PoLine[]) ?? []));
  }, [poId]);

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

  // HEADER-level catalog match (by the PO header name) — used ONLY for the
  // header summary metrics + history formatting. Per-line receiving resolves
  // its own catalog per line below. `?? null` collapses BOTH "no match" and
  // "ambiguous name" (buildUnambiguousCatalogNameMap → null) to unlinked.
  const poCatalog = selectedPO ? catalogByName.get(normalizeCatalogName(selectedPO.material_name)) ?? null : null;
  /** Format a BASE-unit (kg) PO quantity for display — batang for rebar. */
  const formatPoQty = (qtyBase: number) => {
    const d = displayQty(qtyBase, poCatalog ?? { unit: selectedPO?.unit ?? '' });
    return d.converted
      ? `${d.qty.toLocaleString('id-ID')} ${d.unit} (≈ ${d.baseQty.toLocaleString('id-ID')} ${d.baseUnit})`
      : `${d.qty.toLocaleString('id-ID')} ${d.unit}`;
  };

  // The receivable lines for the selected PO. Normally the PO's own
  // purchase_order_lines; if a (legacy) PO has none, synthesize ONE line from
  // the header so receiving still works (po_line_id null → stored NULL). Each
  // line resolves its factor by material_id (exact) and only falls back to the
  // unambiguous name map when material_id is NULL.
  const effectiveLines: EffectiveLine[] = useMemo(() => {
    if (!selectedPO) return [];
    const rawLines: Array<Omit<EffectiveLine, 'factor' | 'inputUnit' | 'catalog'>> =
      poLines.length > 0
        ? poLines.map(l => ({
            key: l.id,
            po_line_id: l.id,
            material_id: l.material_id,
            material_name: l.material_name,
            quantity: l.quantity,
            baseUnit: l.unit,
          }))
        : [{
            key: '__header__',
            po_line_id: null,
            material_id: null,
            material_name: selectedPO.material_name,
            quantity: selectedPO.quantity,
            baseUnit: selectedPO.unit,
          }];
    return rawLines.map(l => {
      const catalog = l.material_id
        ? catalogById.get(l.material_id) ?? null
        : catalogByName.get(normalizeCatalogName(l.material_name)) ?? null;
      const factor = catalog?.base_qty_per_supplier_unit ?? null;
      const inputUnit = factor != null ? (catalog?.supplier_unit || 'batang') : l.baseUnit;
      return {
        ...l,
        // Prefer the PO line's own id; else the name-map-resolved id so the
        // envelope/balance join can still credit a free-text line.
        material_id: l.material_id ?? catalog?.id ?? null,
        catalog,
        factor,
        inputUnit,
      };
    });
  }, [selectedPO, poLines, catalogById, catalogByName]);

  // Total BASE qty across all typed lines — feeds the gate check + optimistic
  // status (gate semantics unchanged: it compares this receipt's whole against
  // the whole PO; per-line-vs-PO refinement is a known separate issue).
  const totalBaseQty = useMemo(() => {
    return effectiveLines.reduce((sum, l) => {
      const raw = parseFloat(lineQtys[l.key] ?? '');
      if (!Number.isFinite(raw) || raw <= 0) return sum;
      return sum + supplierToBase(raw, l.factor);
    }, 0);
  }, [effectiveLines, lineQtys]);

  const isReadymix = selectedPO?.material_name.toLowerCase().includes('readymix') ?? false;
  const requiredPhotos = isReadymix ? 4 : 3;

  const capturedCount = Object.entries(photos).filter(([key, val]) => {
    if (key === 'tiket_timbang' && !isReadymix) return false;
    return val !== null;
  }).length;

  // Load receipt history when PO changes
  const loadReceiptHistory = useCallback(async (poIdVal: string) => {
    if (!poIdVal) { setReceiptHistory([]); setReceivedByLine(new Map()); return; }
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
        .select('id, vehicle_ref, created_at, receipt_lines(quantity_actual, po_line_id)')
        .eq('po_id', poIdVal)
        .order('created_at', { ascending: false });

      const combined: ReceiptRecord[] = [];
      const byLine = new Map<string, number>();

      // Old receipts
      for (const r of (oldReceipts ?? [])) {
        combined.push({ id: r.id, quantity_actual: r.quantity_actual, vehicle_ref: null, created_at: r.created_at });
      }

      // New receipts — sum lines (and accumulate per PO line for the per-line hint)
      for (const r of (newReceipts ?? [])) {
        const lines = ((r as any).receipt_lines ?? []) as Array<{ quantity_actual: number | null; po_line_id: string | null }>;
        const totalQty = lines.reduce((s, l) => s + (l.quantity_actual ?? 0), 0);
        for (const l of lines) {
          if (l.po_line_id) byLine.set(l.po_line_id, (byLine.get(l.po_line_id) ?? 0) + (l.quantity_actual ?? 0));
        }
        combined.push({ id: r.id, quantity_actual: totalQty, vehicle_ref: r.vehicle_ref, created_at: r.created_at });
      }

      // Sort descending
      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setReceiptHistory(combined);
      setReceivedByLine(byLine);
    } catch {
      setReceiptHistory([]);
      setReceivedByLine(new Map());
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
    if (!selectedPO || totalBaseQty <= 0) return null;
    // Gate 3 evaluates this receipt's TOTAL base qty (sum of all lines) against
    // the whole PO — same per-receipt-vs-whole semantics as before line-grain.
    return computeGate3Flag(selectedPO, totalBaseQty, null, {
      total_received: totalReceived,
      total_planned: selectedPO.quantity,
      unit: selectedPO.unit,
    });
  }, [selectedPO, totalBaseQty, totalReceived]);

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
    setLineQtys({}); setVehicleRef(''); setNotes('');
    setPhotos({ surat_jalan: null, material_site: null, vehicle: null, tiket_timbang: null });
    setVehicleGps(null);
    // End the idempotency session: the next receipt is a distinct delivery and
    // must get its own key. NOT cleared on submit error, so a retry reuses it.
    clientReceiptIdRef.current = null;
  };

  const handleSubmit = async (isFinal: boolean) => {
    if (!poId) { toast('Pilih PO', 'critical'); return; }

    // Convert every typed line to base units, dropping zero/blank/invalid lines.
    // A multi-line PO can mix a rebar line (batang→kg) with a 1:1 line here.
    const drafts: ReceiveLineDraft[] = effectiveLines.map(l => ({
      po_line_id: l.po_line_id,
      material_id: l.material_id,
      material_name: l.material_name,
      qtyInput: lineQtys[l.key] ?? '',
      factor: l.factor,
      baseUnit: l.baseUnit,
    }));
    const linePayload = buildReceiptLinesPayload(drafts);
    if (linePayload.length === 0) {
      toast('Masukkan jumlah untuk minimal satu baris', 'critical'); return;
    }
    if (capturedCount < requiredPhotos) {
      toast(`Ambil semua ${requiredPhotos} foto`, 'critical'); return;
    }
    if (!vehicleGps) {
      toast('Foto kendaraan harus memiliki GPS', 'critical'); return;
    }

    setSubmitting(true);
    try {
      // Build the receipt-photo array (filters out tiket_timbang for non-readymix).
      const photoRecords = Object.entries(photos)
        .filter(([key, val]) => val !== null && (key !== 'tiket_timbang' || isReadymix))
        .map(([key, val]) => ({
          photo_type: key,
          storage_path: val!,
          gps_lat: key === 'vehicle' ? vehicleGps?.lat ?? null : null,
          gps_lon: key === 'vehicle' ? vehicleGps?.lon ?? null : null,
        }));

      // Mint the idempotency key once per session (migration 062): a retry after
      // a timeout reuses the ref, so submit_receipt_lines returns the already-
      // created receipt instead of double-booking. Null on runtimes without a
      // CSPRNG → server falls back to its legacy non-idempotent path.
      if (!clientReceiptIdRef.current) {
        clientReceiptIdRef.current = generateClientReceiptId();
      }

      const receivedBase = linePayload.reduce((s, l) => s + l.quantity, 0);

      // Atomic line-grain receive (migration 070): receipt + N lines (each with
      // its po_line_id + material_id) + photos + server-authoritative PO status
      // + activity_log in ONE transaction. Status is computed server-side.
      const { data: receiptId, error: rcptErr } = await supabase.rpc('submit_receipt_lines', {
        p_po_id: poId,
        p_project_id: project!.id,
        p_received_by: profile!.id,
        p_vehicle_ref: vehicleRef ? sanitizeText(vehicleRef) : null,
        p_gate3_flag: gateResult?.flag ?? 'OK',
        p_gate3_details: gateResult,
        p_notes: notes ? sanitizeText(notes) : null,
        p_lines: linePayload,
        p_photos: photoRecords,
        p_client_receipt_id: clientReceiptIdRef.current,
        p_activity_label: `${selectedPO!.material_name} — ${linePayload.length} baris (${receivedBase.toLocaleString('id-ID')} ${selectedPO!.unit}) diterima (${isFinal ? 'Final' : 'Parsial'})`,
      });
      if (rcptErr || !receiptId) throw rcptErr || new Error('Receipt insert failed');

      resetForm();
      await loadReceiptHistory(poId);
      await refresh();
      toast(`${isFinal ? 'Penerimaan final' : 'Penerimaan parsial'} dicatat — ${linePayload.length} baris`, 'ok');
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
          <SelectSheet
            title="Pilih PO"
            placeholder="-- Pilih PO --"
            accessibilityLabel="Pilih purchase order"
            value={poId}
            onChange={v => { setPoId(v); resetForm(); }}
            options={purchaseOrders.map(po => ({
              value: po.id,
              code: getPurchaseOrderDisplayNumber(po),
              label: po.material_name,
              meta: `${po.quantity} ${po.unit}`,
            }))}
          />

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
                    <Text style={styles.poMetricValue}>{formatPoQty(selectedPO.quantity)}</Text>
                    <Text style={styles.hint}>Dipesan</Text>
                  </View>
                  <View style={styles.poMetric}>
                    <Text style={[styles.poMetricValue, { color: COLORS.ok }]}>{formatPoQty(totalReceived)}</Text>
                    <Text style={styles.hint}>Diterima</Text>
                  </View>
                  <View style={styles.poMetric}>
                    <Text style={[styles.poMetricValue, { color: remainingQty > 0 ? COLORS.warning : COLORS.ok }]}>{formatPoQty(remainingQty)}</Text>
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
                        <Text style={styles.historyQty}>{formatPoQty(r.quantity_actual)}</Text>
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
                  <Text style={styles.label}>Jumlah Diterima per Baris <Text style={styles.req}>*</Text></Text>
                  <Text style={styles.hint}>Isi jumlah untuk baris yang datang; kosongkan sisanya. Minimal satu baris.</Text>
                  {effectiveLines.map((l) => {
                    const received = l.po_line_id ? (receivedByLine.get(l.po_line_id) ?? 0) : totalReceived;
                    const lineRemaining = Math.max(0, l.quantity - received);
                    const remD = displayQty(lineRemaining, l.catalog ?? { unit: l.baseUnit });
                    const remStr = remD.converted
                      ? `${remD.qty.toLocaleString('id-ID')} ${remD.unit} (≈ ${remD.baseQty.toLocaleString('id-ID')} ${remD.baseUnit})`
                      : `${remD.qty.toLocaleString('id-ID')} ${remD.unit}`;
                    const raw = parseFloat(lineQtys[l.key] ?? '');
                    const showConv = l.factor != null && Number.isFinite(raw) && raw > 0;
                    return (
                      <View key={l.key} style={styles.lineBox}>
                        <Text style={styles.lineName}>{l.material_name}</Text>
                        <View style={styles.row2}>
                          <TextInput
                            style={[styles.input, { flex: 1 }]}
                            keyboardType="numeric"
                            value={lineQtys[l.key] ?? ''}
                            onChangeText={t => setLineQtys(prev => ({ ...prev, [l.key]: t }))}
                            placeholder="0"
                            accessibilityLabel={`Jumlah diterima untuk ${l.material_name}`}
                          />
                          <TextInput style={[styles.input, styles.disabled, { flex: 1 }]} value={l.inputUnit} editable={false} />
                        </View>
                        {showConv && (
                          <Text style={styles.fieldHint}>
                            ≈ {supplierToBase(raw, l.factor).toFixed(1)} {l.baseUnit} · 1 {l.inputUnit} = {l.factor} {l.baseUnit}
                          </Text>
                        )}
                        <Text style={styles.fieldHint}>Sisa: {remStr}</Text>
                      </View>
                    );
                  })}
                  <Text style={styles.fieldHint}>Sisa total PO: {formatPoQty(Math.max(0, remainingQty))}</Text>

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
  hint:       { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2, lineHeight: 17 },
  fieldHint:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs, lineHeight: 17 },
  row2:       { flexDirection: 'row', gap: SPACE.sm },
  photoGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.sm },

  // Per-line receive input (line-grain, migration 070)
  lineBox:  { backgroundColor: 'rgba(20,18,16,0.03)', borderRadius: RADIUS, padding: SPACE.md, marginTop: SPACE.sm },
  lineName: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, marginBottom: SPACE.xs },

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
