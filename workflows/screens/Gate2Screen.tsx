import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Modal, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import Badge from '../components/Badge';
import DateSelectField, { getTodayIsoDate } from '../components/DateSelectField';
import MaterialNamingAssist from '../components/MaterialNamingAssist';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { supabase } from '../../tools/supabase';
import { getNextPurchaseOrderNumber, getPurchaseOrderDisplayNumber } from '../../tools/purchaseOrders';
import { computeGate2, summarizeAhsBaselinePrices, type Gate2Result, type Gate2Input } from '../gates/gate2';
import { buildMaterialScopeIndex, deriveAutomaticScopeTag, normalizeBoqRefToScopeTag } from '../../tools/procurementScope';
import { sanitizeText, isPositiveNumber } from '../../tools/validation';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, FLAG_COLORS, FLAG_BG } from '../theme';
import type {
  AhsLine,
  PurchaseOrder,
  PurchaseOrderLine,
  PriceHistory,
  VendorScorecard,
  ProjectMaterialMasterLine,
  ApprovalTask,
  FlagLevel,
} from '../../tools/types';

// ── Shared types ─────────────────────────────────────────────────────

interface POWithLines extends PurchaseOrder {
  lines: PurchaseOrderLine[];
  gate2?: Gate2Result[];
}

interface PendingApproval extends ApprovalTask {
  po?: POWithLines;
  gate2Result?: Gate2Result;
  lineIndex?: number;
}

interface MaterialOption {
  id: string;
  name: string;
  unit: string;
  code?: string | null;
  category?: string | null;
}

interface DraftPOLine {
  id: string;
  material_id: string;
  material_name: string;
  quantity: string;
  unit: string;
  unit_price: string;
}

type DraftBoqMode = 'single' | 'multi' | 'general';

const GENERAL_BOQ_REF = 'STOK UMUM';
const MULTI_BOQ_PREFIX = 'MULTI-BOQ';

let draftLineCounter = 0;
function nextDraftLineId() {
  draftLineCounter += 1;
  return `po_line_${draftLineCounter}_${Date.now()}`;
}

// ── Main Screen ──────────────────────────────────────────────────────

export default function Gate2Screen({ onBack, showBackButton = true }: { onBack: () => void; showBackButton?: boolean }) {
  const { project, profile, purchaseOrders, boqItems, refresh } = useProject();
  const { show: toast } = useToast();

  const role = profile?.role ?? 'supervisor';
  const canManagePOs = role === 'admin' || role === 'estimator';

  // Shared state
  const [poList, setPoList] = useState<POWithLines[]>([]);
  const [loading, setLoading] = useState(false);
  const [materialOptions, setMaterialOptions] = useState<MaterialOption[]>([]);
  const [materialMasterLines, setMaterialMasterLines] = useState<ProjectMaterialMasterLine[]>([]);
  const [principalId, setPrincipalId] = useState<string | null>(null);

  // Admin: PO entry state
  const [selectedPO, setSelectedPO] = useState<POWithLines | null>(null);
  const [lineEdits, setLineEdits] = useState<Record<string, { price: string; vendor: string; justification: string }>>({});
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [draftSupplier, setDraftSupplier] = useState('');
  const [draftOrderedDate, setDraftOrderedDate] = useState(getTodayIsoDate());
  const [draftBoqId, setDraftBoqId] = useState('');
  const [draftBoqMode, setDraftBoqMode] = useState<DraftBoqMode>('multi');
  const [draftBoqSummary, setDraftBoqSummary] = useState('');
  const [draftLines, setDraftLines] = useState<DraftPOLine[]>([
    { id: nextDraftLineId(), material_id: '', material_name: '', quantity: '', unit: '', unit_price: '' },
  ]);
  const [materialPickerLineId, setMaterialPickerLineId] = useState<string | null>(null);
  const [materialSearch, setMaterialSearch] = useState('');
  const [boqPickerVisible, setBoqPickerVisible] = useState(false);
  const [boqSearch, setBoqSearch] = useState('');

  // Principal: approval queue
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);

  // Load PO lines and run Gate 2 checks
  const loadData = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const poIds = purchaseOrders.map(po => po.id);
      const [linesRes, priceRes, scorecardRes, materialRes, assignmentRes, profileRes, masterHeaderRes] = await Promise.all([
        poIds.length > 0
          ? supabase.from('purchase_order_lines').select('*').in('po_id', poIds)
          : Promise.resolve({ data: [] as PurchaseOrderLine[] }),
        supabase.from('price_history').select('*').eq('project_id', project.id),
        supabase.from('vendor_scorecards').select('*').eq('project_id', project.id),
        supabase.from('material_catalog').select('id, name, unit, code, category').order('name'),
        supabase.from('project_assignments').select('user_id').eq('project_id', project.id),
        supabase.from('profiles').select('id, role'),
        supabase
          .from('project_material_master')
          .select('id, ahs_version_id')
          .eq('project_id', project.id)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      const assignmentIds = ((assignmentRes.data as any[]) ?? []).map(row => row.user_id);
      const projectProfiles = ((profileRes.data as any[]) ?? []).filter(row => assignmentIds.includes(row.id));
      setPrincipalId(projectProfiles.find(row => row.role === 'principal')?.id ?? null);
      setMaterialOptions((materialRes.data as MaterialOption[]) ?? []);

      const masterId = masterHeaderRes.data?.[0]?.id ?? null;
      const ahsVersionId = masterHeaderRes.data?.[0]?.ahs_version_id ?? null;
      const [masterLinesRes, ahsLinesRes] = await Promise.all([
        masterId
          ? supabase.from('project_material_master_lines').select('*').eq('master_id', masterId)
          : Promise.resolve({ data: [] as ProjectMaterialMasterLine[] }),
        ahsVersionId
          ? supabase.from('ahs_lines').select('material_id, unit_price, line_type').eq('ahs_version_id', ahsVersionId)
          : Promise.resolve({ data: [] as Array<Pick<AhsLine, 'material_id' | 'unit_price' | 'line_type'>> }),
      ]);

      const lines = (linesRes.data as PurchaseOrderLine[]) ?? [];
      const masterLines = (masterLinesRes.data as ProjectMaterialMasterLine[]) ?? [];
      const priceHist = (priceRes.data as PriceHistory[]) ?? [];
      const scorecards = (scorecardRes.data as VendorScorecard[]) ?? [];
      const ahsBaselinePriceMap = summarizeAhsBaselinePrices(
        ((ahsLinesRes.data as Array<Pick<AhsLine, 'material_id' | 'unit_price' | 'line_type'>>) ?? []),
      );
      setMaterialMasterLines(masterLines);

      const linesByPO: Record<string, PurchaseOrderLine[]> = {};
      lines.forEach(l => {
        if (!linesByPO[l.po_id]) linesByPO[l.po_id] = [];
        linesByPO[l.po_id].push(l);
      });

      const enriched: POWithLines[] = purchaseOrders
        .filter(po => po.status !== 'CANCELLED' && po.status !== 'CLOSED')
        .map(po => {
          const poLines = linesByPO[po.id] ?? [];
          const gate2Results = poLines.map(line => {
            const blLine = (masterLines ?? []).find(m => m.material_id === line.material_id) ?? null;
            const baselinePrice = line.material_id ? ahsBaselinePriceMap.get(line.material_id) ?? null : null;

            const input: Gate2Input = {
              line,
              vendor: po.supplier,
              baselineLine: blLine,
              baselinePrice,
              priceHistory: priceHist.filter(h => h.material_id === line.material_id),
              vendorScorecard: scorecards.find(s => normalizeVendorKey(s.vendor) === normalizeVendorKey(po.supplier)) ?? null,
            };
            return computeGate2(input);
          });
          return { ...po, lines: poLines, gate2: gate2Results };
        });

      setPoList(enriched);

      // Load approval tasks for principal
      if (role === 'principal') {
        const { data: tasks } = await supabase
          .from('approval_tasks')
          .select('*')
          .eq('project_id', project.id)
          .eq('entity_type', 'po_line')
          .is('action', null);

        const pendingApprovals: PendingApproval[] = (tasks ?? []).map(t => {
          const po = enriched.find(p => p.lines.some(l => l.id === t.entity_id));
          const lineIdx = po?.lines.findIndex(l => l.id === t.entity_id) ?? -1;
          return {
            ...t,
            po,
            gate2Result: lineIdx >= 0 ? po?.gate2?.[lineIdx] : undefined,
            lineIndex: lineIdx >= 0 ? lineIdx : undefined,
          };
        });
        setApprovals(pendingApprovals);
      }
    } catch (err: any) {
      console.warn('Gate2 load error:', err.message);
      setMaterialMasterLines([]);
    } finally {
      setLoading(false);
    }
  }, [project, purchaseOrders, role]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Admin: save prices & run validation ────────────────────────────

  const handleSavePrices = async (po: POWithLines) => {
    if (!project || !profile) return;
    try {
      for (const line of po.lines) {
        const edit = lineEdits[line.id];
        if (!edit?.price) continue;
        if (!isPositiveNumber(edit.price)) {
          toast(`Harga tidak valid untuk ${line.material_name}`, 'critical');
          return;
        }

        const unitPrice = parseFloat(edit.price);

        // Update PO line price
        await supabase.from('purchase_order_lines').update({ unit_price: unitPrice }).eq('id', line.id);

        // Record price history
        await supabase.from('price_history').insert({
          project_id: project.id,
          material_id: line.material_id ?? null,
          vendor: edit.vendor || po.supplier,
          unit_price: unitPrice,
          recorded_at: new Date().toISOString(),
        });

        // Store justification if provided
        if (edit.justification) {
          await supabase.from('activity_log').insert({
            project_id: project.id,
            user_id: profile.id,
            type: 'permintaan',
            label: `Gate 2 justifikasi: ${line.material_name} @ Rp${unitPrice.toLocaleString('id-ID')} — ${sanitizeText(edit.justification)}`,
            flag: 'INFO',
          });
        }
      }

      toast('Harga disimpan — validasi Gate 2 dijalankan', 'ok');
      setLineEdits({});
      loadData();
    } catch (err: any) {
      toast(err.message, 'critical');
    }
  };

  const updateDraftLine = (lineId: string, patch: Partial<DraftPOLine>) => {
    setDraftLines(prev => prev.map(line => line.id === lineId ? { ...line, ...patch } : line));
  };

  const activeMaterialDraftLine = useMemo(
    () => draftLines.find(line => line.id === materialPickerLineId) ?? null,
    [draftLines, materialPickerLineId],
  );

  const filteredMaterialOptions = useMemo(() => {
    const query = materialSearch.trim().toLowerCase();
    if (!query) return materialOptions;
    return materialOptions.filter(option =>
      [option.name, option.code ?? '', option.category ?? '', option.unit]
        .some(value => value.toLowerCase().includes(query)),
    );
  }, [materialOptions, materialSearch]);

  const filteredBoqItems = useMemo(() => {
    const query = boqSearch.trim().toLowerCase();
    if (!query) return boqItems;
    return boqItems.filter(item =>
      [item.code, item.label]
        .some(value => value.toLowerCase().includes(query)),
    );
  }, [boqItems, boqSearch]);

  const selectedBoqItem = boqItems.find(item => item.id === draftBoqId) ?? null;
  const materialScopeIndex = useMemo(
    () => buildMaterialScopeIndex(materialMasterLines, boqItems),
    [materialMasterLines, boqItems],
  );
  const draftScopePreviewByLine = useMemo(() => {
    const preview = new Map<string, string>();
    for (const line of draftLines) {
      preview.set(line.id, deriveAutomaticScopeTag({
        boqMode: draftBoqMode,
        selectedBoqItem,
        draftBoqSummary,
        materialId: line.material_id || null,
        materialScopeIndex,
      }));
    }
    return preview;
  }, [draftBoqMode, draftBoqSummary, draftLines, materialScopeIndex, selectedBoqItem]);

  const resolveLineScopeTag = useCallback((po: POWithLines, line: PurchaseOrderLine): string => {
    if (line.scope_tag) return line.scope_tag;

    const matchedBoqItem = po.boq_ref
      ? boqItems.find(item => item.code === po.boq_ref) ?? null
      : null;

    return deriveAutomaticScopeTag({
      boqMode: po.boq_ref === GENERAL_BOQ_REF ? 'general' : matchedBoqItem ? 'single' : 'multi',
      selectedBoqItem: matchedBoqItem,
      materialId: line.material_id,
      materialScopeIndex,
      fallbackBoqRef: po.boq_ref,
    });
  }, [boqItems, materialScopeIndex]);

  const closeMaterialPicker = () => {
    setMaterialPickerLineId(null);
    setMaterialSearch('');
  };

  const openMaterialPicker = (lineId: string) => {
    setMaterialPickerLineId(lineId);
    setMaterialSearch('');
  };

  const selectCatalogMaterial = (lineId: string, material: MaterialOption) => {
    updateDraftLine(lineId, {
      material_id: material.id,
      material_name: material.name,
      unit: material.unit,
    });
    closeMaterialPicker();
  };

  const clearCatalogMaterial = (lineId: string) => {
    updateDraftLine(lineId, { material_id: '', material_name: '', unit: '' });
    closeMaterialPicker();
  };

  const changeDraftBoqMode = (mode: DraftBoqMode) => {
    setDraftBoqMode(mode);
    if (mode !== 'single') setDraftBoqId('');
    if (mode !== 'multi') setDraftBoqSummary('');
  };

  const addDraftLine = () => {
    setDraftLines(prev => [
      ...prev,
      { id: nextDraftLineId(), material_id: '', material_name: '', quantity: '', unit: '', unit_price: '' },
    ]);
  };

  const removeDraftLine = (lineId: string) => {
    setDraftLines(prev => prev.length > 1 ? prev.filter(line => line.id !== lineId) : prev);
  };

  const resetCreateForm = () => {
    setDraftSupplier('');
    setDraftOrderedDate(getTodayIsoDate());
    setDraftBoqId('');
    setDraftBoqMode('multi');
    setDraftBoqSummary('');
    setDraftLines([{ id: nextDraftLineId(), material_id: '', material_name: '', quantity: '', unit: '', unit_price: '' }]);
    setMaterialPickerLineId(null);
    setMaterialSearch('');
    setBoqPickerVisible(false);
    setBoqSearch('');
    setShowCreateForm(false);
  };

  const handleCreatePO = async () => {
    if (!project || !profile) return;
    const populatedLines = draftLines.filter(line =>
      Boolean(
        line.material_id ||
        line.material_name.trim() ||
        line.quantity.trim() ||
        line.unit.trim() ||
        line.unit_price.trim(),
      ),
    );

    if (!draftSupplier.trim()) {
      toast('Masukkan supplier PO', 'critical');
      return;
    }
    if (populatedLines.length === 0) {
      toast('Tambahkan minimal 1 line material', 'critical');
      return;
    }

    let boqRef = GENERAL_BOQ_REF;
    if (draftBoqMode === 'single') {
      const boqItem = boqItems.find(item => item.id === draftBoqId);
      if (!boqItem) {
        toast('Pilih item BoQ untuk order ini', 'critical');
        return;
      }
      boqRef = boqItem.code;
    } else if (draftBoqMode === 'multi') {
      if (!draftBoqSummary.trim()) {
        toast('Isi ringkasan cakupan BoQ untuk pembelian multi-item', 'critical');
        return;
      }
      boqRef = `${MULTI_BOQ_PREFIX} · ${sanitizeText(draftBoqSummary)}`;
    }

    for (const [index, line] of populatedLines.entries()) {
      if (!line.material_name.trim()) {
        toast(`Line #${index + 1}: pilih material atau isi nama material`, 'critical');
        return;
      }
      if (!isPositiveNumber(line.quantity)) {
        toast(`Line #${index + 1}: qty wajib diisi`, 'critical');
        return;
      }
      if (!line.unit.trim()) {
        toast(`Line #${index + 1}: unit wajib diisi`, 'critical');
        return;
      }
      if (!isPositiveNumber(line.unit_price)) {
        toast(`Line #${index + 1}: harga wajib diisi`, 'critical');
        return;
      }
    }

    try {
      const poNumber = getNextPurchaseOrderNumber(project.code, purchaseOrders);
      const totalQuantity = populatedLines.reduce((sum, line) => sum + parseFloat(line.quantity), 0);
      const headerMaterialName = populatedLines.length === 1 ? populatedLines[0].material_name : `${populatedLines.length} item material`;
      const headerUnit = populatedLines.every(line => line.unit === populatedLines[0].unit) ? populatedLines[0].unit : 'mixed';
      const headerPrice = populatedLines.length === 1
        ? parseFloat(populatedLines[0].unit_price)
        : null;

      const { data: poHeader, error: poError } = await supabase
        .from('purchase_orders')
        .insert({
          project_id: project.id,
          po_number: poNumber,
          boq_ref: boqRef,
          supplier: sanitizeText(draftSupplier),
          material_name: headerMaterialName,
          quantity: totalQuantity,
          unit: headerUnit,
          unit_price: headerPrice,
          ordered_date: draftOrderedDate,
          status: 'OPEN',
        })
        .select('id')
        .single();
      if (poError || !poHeader) throw poError ?? new Error('PO header gagal dibuat');

      const lineRecords = populatedLines.map(line => ({
        po_id: poHeader.id,
        material_id: line.material_id || null,
        material_name: sanitizeText(line.material_name),
        quantity: parseFloat(line.quantity),
        unit: line.unit,
        unit_price: parseFloat(line.unit_price),
        scope_tag: draftScopePreviewByLine.get(line.id) ?? null,
      }));
      const { error: lineError } = await supabase.from('purchase_order_lines').insert(lineRecords);
      if (lineError) throw lineError;

      await supabase.from('price_history').insert(
        lineRecords.map(line => ({
          project_id: project.id,
          material_id: line.material_id,
          vendor: sanitizeText(draftSupplier),
          unit_price: line.unit_price,
          recorded_at: new Date().toISOString(),
        })),
      );

      await supabase.from('activity_log').insert({
        project_id: project.id,
        user_id: profile.id,
        type: 'permintaan',
        label: `${poNumber} dibuat: ${sanitizeText(draftSupplier)} — ${headerMaterialName}`,
        flag: 'INFO',
      });

      await refresh();
      await loadData();
      toast('PO berhasil dibuat', 'ok');
      resetCreateForm();
    } catch (err: any) {
      toast(err.message ?? 'Gagal membuat PO', 'critical');
    }
  };

  // ── Admin: escalate to principal ───────────────────────────────────

  const handleEscalate = async (po: POWithLines, lineIdx: number) => {
    if (!project || !profile) return;
    if (!principalId) {
      toast('Belum ada user principal yang ter-assign di proyek ini', 'critical');
      return;
    }
    const line = po.lines[lineIdx];
    try {
      await supabase.from('approval_tasks').insert({
        project_id: project.id,
        entity_type: 'po_line',
        entity_id: line.id,
        assigned_to: principalId,
        created_at: new Date().toISOString(),
      });
      toast(`Eskalasi ke Principal: ${line.material_name}`, 'ok');
    } catch (err: any) {
      toast(err.message, 'critical');
    }
  };

  // ── Principal: approval action ─────────────────────────────────────

  const handleApprovalAction = async (taskId: string, action: 'APPROVE' | 'REJECT' | 'HOLD' | 'OVERRIDE', reason: string) => {
    try {
      await supabase.from('approval_tasks').update({
        action,
        reason: reason || null,
        acted_at: new Date().toISOString(),
      }).eq('id', taskId);
      toast(`${action} — disimpan`, 'ok');
      setApprovals(prev => prev.filter(a => a.id !== taskId));
    } catch (err: any) {
      toast(err.message, 'critical');
    }
  };

  // ── Render helpers ────────────────────────────────────────────────

  const flagColor = (f: FlagLevel) => FLAG_COLORS[f] ?? COLORS.textSec;
  const flagBg = (f: FlagLevel) => FLAG_BG[f] ?? 'rgba(0,0,0,0.04)';

  const renderCheckRow = (label: string, result: { flag: FlagLevel; msg: string }) => (
    <View style={styles.checkRow} key={label}>
      <View style={[styles.checkDot, { backgroundColor: flagColor(result.flag) }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.checkLabel}>{label}</Text>
        <Text style={[styles.checkMsg, { color: flagColor(result.flag) }]}>{result.msg}</Text>
      </View>
    </View>
  );

  // ── MANAGER VIEW (Admin / Estimator) ─────────────────────────────

  const renderManager = () => (
    <>
      <Text style={styles.sectionHead}>Gate 2 — Procurement & Validasi Harga</Text>
      <Text style={styles.hint}>Buat PO baru, cari material dengan cepat, isi harga wajib per line, lalu validasi terhadap baseline, riwayat harga, dan scorecard vendor.</Text>

      {selectedPO ? (
        <>
          <TouchableOpacity style={styles.backRow} onPress={() => setSelectedPO(null)}>
            <Ionicons name="arrow-back" size={16} color={COLORS.primary} />
            <Text style={styles.backRowText}>Kembali ke Daftar PO</Text>
          </TouchableOpacity>

          <Card
            title={getPurchaseOrderDisplayNumber(selectedPO)}
            subtitle={`${selectedPO.supplier} · ${selectedPO.lines.length} line item`}
          >
            {selectedPO.lines.map((line, idx) => {
              const g2 = selectedPO.gate2?.[idx];
              const edit = lineEdits[line.id] ?? { price: line.unit_price?.toString() ?? '', vendor: selectedPO.supplier, justification: '' };
              const scopeTag = resolveLineScopeTag(selectedPO, line);
              return (
                <View key={line.id} style={styles.lineBlock}>
                  <View style={styles.lineHeader}>
                    <Text style={styles.lineName}>{line.material_name}</Text>
                    {g2 && <Badge flag={g2.overall.flag} />}
                  </View>
                  <Text style={styles.lineDetail}>{line.quantity} {line.unit}</Text>
                  <View style={styles.scopeTagChip}>
                    <Ionicons name="layers-outline" size={12} color={COLORS.primary} />
                    <Text style={styles.scopeTagText}>{scopeTag}</Text>
                  </View>

                  <Text style={styles.fieldLabel}>Harga Satuan (Rp)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={edit.price}
                    onChangeText={v => setLineEdits(prev => ({ ...prev, [line.id]: { ...edit, price: v } }))}
                    placeholder="0"
                  />

                  <Text style={styles.fieldLabel}>Vendor</Text>
                  <TextInput
                    style={styles.input}
                    value={edit.vendor}
                    onChangeText={v => setLineEdits(prev => ({ ...prev, [line.id]: { ...edit, vendor: v } }))}
                    placeholder={selectedPO.supplier}
                  />

                  {/* Gate 2 check results */}
                  {g2 && (
                    <View style={[styles.checksBox, { backgroundColor: flagBg(g2.overall.flag) }]}>
                      {renderCheckRow('Baseline', g2.checks.baseline)}
                      {renderCheckRow('Riwayat Harga', g2.checks.historical)}
                      {renderCheckRow('Vendor', g2.checks.vendor)}
                    </View>
                  )}

                  {/* Justification field for WARNING+ */}
                  {g2 && (g2.overall.flag === 'WARNING' || g2.overall.flag === 'HIGH' || g2.overall.flag === 'CRITICAL') && (
                    <>
                      <Text style={styles.fieldLabel}>Justifikasi <Text style={{ color: COLORS.critical }}>*</Text></Text>
                      <TextInput
                        style={[styles.input, styles.textarea]}
                        value={edit.justification}
                        onChangeText={v => setLineEdits(prev => ({ ...prev, [line.id]: { ...edit, justification: v } }))}
                        placeholder="Alasan deviasi harga..."
                        multiline
                      />
                    </>
                  )}

                  {/* Escalate button for HIGH/CRITICAL */}
                  {g2?.requiresPrincipal && (
                    <TouchableOpacity style={styles.escalateBtn} onPress={() => handleEscalate(selectedPO, idx)}>
                      <Ionicons name="arrow-up-circle" size={16} color="#fff" />
                      <Text style={styles.escalateBtnText}>Eskalasi ke Principal</Text>
                    </TouchableOpacity>
                  )}

                  {idx < selectedPO.lines.length - 1 && <View style={styles.divider} />}
                </View>
              );
            })}

            <TouchableOpacity style={styles.saveBtn} onPress={() => handleSavePrices(selectedPO)}>
              <Text style={styles.saveBtnText}>Simpan Harga & Validasi</Text>
            </TouchableOpacity>
          </Card>
        </>
      ) : showCreateForm ? (
        <>
          <TouchableOpacity style={styles.backRow} onPress={resetCreateForm}>
            <Ionicons name="arrow-back" size={16} color={COLORS.primary} />
            <Text style={styles.backRowText}>Kembali ke Daftar PO</Text>
          </TouchableOpacity>

          <Card title="Buat Purchase Order" subtitle="Admin atau Estimator dapat membuat daftar PO baru untuk proyek aktif.">
            <Text style={styles.fieldLabel}>Supplier <Text style={{ color: COLORS.critical }}>*</Text></Text>
            <TextInput
              style={styles.input}
              value={draftSupplier}
              onChangeText={setDraftSupplier}
              placeholder="Nama supplier"
            />

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Tanggal PO <Text style={{ color: COLORS.critical }}>*</Text></Text>
                <DateSelectField
                  value={draftOrderedDate}
                  onChange={setDraftOrderedDate}
                  placeholder="Pilih tanggal PO"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Cakupan BoQ</Text>
                <View style={styles.modeRow}>
                  {([
                    { key: 'single', label: '1 Item' },
                    { key: 'multi', label: 'Beberapa' },
                    { key: 'general', label: 'Stok Umum' },
                  ] as const).map(option => (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.modeChip, draftBoqMode === option.key && styles.modeChipActive]}
                      onPress={() => changeDraftBoqMode(option.key)}
                    >
                      <Text style={[styles.modeChipText, draftBoqMode === option.key && styles.modeChipTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            {draftBoqMode === 'single' && (
              <>
                <Text style={styles.fieldLabel}>Item BoQ <Text style={{ color: COLORS.critical }}>*</Text></Text>
                <TouchableOpacity
                  style={styles.selectorBtn}
                  onPress={() => {
                    setBoqSearch('');
                    setBoqPickerVisible(true);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.selectorText, !selectedBoqItem && styles.selectorPlaceholder]}>
                      {selectedBoqItem ? `${selectedBoqItem.code} — ${selectedBoqItem.label}` : 'Cari item BoQ'}
                    </Text>
                    <Text style={styles.selectorMeta}>Gunakan bila PO memang spesifik untuk satu item pekerjaan.</Text>
                  </View>
                  <Ionicons name="search-outline" size={16} color={COLORS.textSec} />
                </TouchableOpacity>
              </>
            )}

            {draftBoqMode === 'multi' && (
              <>
                <Text style={styles.fieldLabel}>Ringkasan Cakupan BoQ <Text style={{ color: COLORS.critical }}>*</Text></Text>
                <TextInput
                  style={[styles.input, styles.textarea]}
                  value={draftBoqSummary}
                  onChangeText={setDraftBoqSummary}
                  placeholder="Contoh: pasangan bata area lt 1-3 / beberapa item dinding"
                  multiline
                />
                <Text style={styles.inlineHint}>Pilih mode ini saat satu PO melayani beberapa item BoQ sekaligus. Scope tag line tetap diisi otomatis dari baseline material jika datanya tersedia.</Text>
              </>
            )}

            {draftBoqMode === 'general' && (
              <Text style={styles.inlineHint}>Gunakan untuk pembelian stok umum yang belum dialokasikan ke satu item BoQ tertentu. Semua line akan ditandai otomatis sebagai stok umum.</Text>
            )}

            <Text style={styles.sectionHead}>Line Items PO</Text>
            {draftLines.map((line, index) => (
              <View key={line.id} style={styles.lineBlock}>
                <View style={styles.lineHeader}>
                  <Text style={styles.lineName}>Line #{index + 1}</Text>
                  {draftLines.length > 1 ? (
                    <TouchableOpacity onPress={() => removeDraftLine(line.id)}>
                      <Text style={styles.removeLineText}>Hapus</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <Text style={styles.fieldLabel}>Material <Text style={{ color: COLORS.critical }}>*</Text></Text>
                <TouchableOpacity style={styles.selectorBtn} onPress={() => openMaterialPicker(line.id)}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.selectorText, !line.material_id && styles.selectorPlaceholder]}>
                      {line.material_id
                        ? `${line.material_name} (${line.unit})`
                        : 'Cari material dari katalog'}
                    </Text>
                    <Text style={styles.selectorMeta}>
                      {line.material_id
                        ? 'Unit mengikuti master material dan dikunci.'
                        : 'Cari cepat dari katalog. Jika belum ada, isi manual di bawah.'}
                    </Text>
                  </View>
                  <Ionicons name="search-outline" size={16} color={COLORS.textSec} />
                </TouchableOpacity>

                {!line.material_id ? (
                  <>
                    <Text style={styles.fieldLabel}>Nama Material <Text style={{ color: COLORS.critical }}>*</Text></Text>
                    <TextInput
                      style={styles.input}
                      value={line.material_name}
                      onChangeText={(value) => updateDraftLine(line.id, { material_name: value })}
                      placeholder="Nama material custom"
                    />
                    <MaterialNamingAssist
                      materialName={line.material_name}
                      materialId={line.material_id || null}
                      currentUnit={line.unit}
                      catalog={materialOptions}
                      projectId={project?.id}
                      projectName={project?.name}
                      projectCode={project?.code}
                      userId={profile?.id}
                      userRole={profile?.role}
                      onSelectCatalogMaterial={(material) => selectCatalogMaterial(line.id, material)}
                      onApplyAiSuggestion={(suggestion) => updateDraftLine(line.id, {
                        material_name: suggestion.suggested_name,
                        unit: line.unit || suggestion.suggested_unit || '',
                      })}
                    />
                  </>
                ) : null}

                <View style={styles.row3}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Qty <Text style={{ color: COLORS.critical }}>*</Text></Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="numeric"
                      value={line.quantity}
                      onChangeText={(value) => updateDraftLine(line.id, { quantity: value })}
                      placeholder="0"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Unit <Text style={{ color: COLORS.critical }}>*</Text></Text>
                    <TextInput
                      style={[styles.input, line.material_id && styles.inputDisabled]}
                      value={line.unit}
                      onChangeText={(value) => updateDraftLine(line.id, { unit: value })}
                      placeholder="pcs / m2 / kg"
                      editable={!line.material_id}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Harga <Text style={{ color: COLORS.critical }}>*</Text></Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="numeric"
                      value={line.unit_price}
                      onChangeText={(value) => updateDraftLine(line.id, { unit_price: value })}
                      placeholder="Rp / unit"
                    />
                  </View>
                </View>

                <View style={styles.autoScopeRow}>
                  <Ionicons name="layers-outline" size={14} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.autoScopeLabel}>Scope otomatis</Text>
                    <Text style={styles.autoScopeValue}>{draftScopePreviewByLine.get(line.id) ?? 'BELUM TERPETAKAN'}</Text>
                  </View>
                </View>
              </View>
            ))}

            <TouchableOpacity style={styles.ghostBtn} onPress={addDraftLine}>
              <Text style={styles.ghostBtnText}>Tambah Line Material</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.saveBtn} onPress={handleCreatePO}>
              <Text style={styles.saveBtnText}>Buat PO</Text>
            </TouchableOpacity>
          </Card>
        </>
      ) : (
        <>
          <View style={styles.topActionRow}>
            <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreateForm(true)}>
              <Ionicons name="add-circle" size={16} color="#fff" />
              <Text style={styles.createBtnText}>Buat PO Baru</Text>
            </TouchableOpacity>
          </View>

          {poList.length === 0 && !loading && (
            <Card><Text style={styles.hint}>Belum ada PO aktif untuk project ini.</Text></Card>
          )}
          {poList.map(po => {
            const worstFlag = po.gate2?.reduce<FlagLevel>((w, g) => {
              const order = ['OK', 'INFO', 'WARNING', 'HIGH', 'CRITICAL'] as FlagLevel[];
              return order.indexOf(g.overall.flag) > order.indexOf(w) ? g.overall.flag : w;
            }, 'OK') ?? 'INFO';
            const scopeTags = Array.from(
              new Set(
                po.lines
                  .map(line => resolveLineScopeTag(po, line))
                  .filter(Boolean),
              ),
            );

            return (
              <TouchableOpacity key={po.id} onPress={() => setSelectedPO(po)}>
                <Card borderColor={flagColor(worstFlag)}>
                  <View style={styles.poRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.poSupplier}>{po.supplier}</Text>
                      <Text style={styles.poNumber}>{getPurchaseOrderDisplayNumber(po)}</Text>
                      <Text style={styles.hint}>{po.material_name} — {po.lines.length} line</Text>
                      <Text style={styles.hint}>
                        {scopeTags.length <= 1
                          ? `Scope: ${scopeTags[0] ?? normalizeBoqRefToScopeTag(po.boq_ref) ?? 'BELUM TERPETAKAN'}`
                          : `${scopeTags.length} scope otomatis`}
                      </Text>
                      <Text style={styles.hint}>{new Date(po.ordered_date).toLocaleDateString('id-ID')}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Badge flag={worstFlag} />
                      <Badge flag={po.status === 'OPEN' ? 'WARNING' : 'OK'} label={po.status} />
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })}
        </>
      )}
    </>
  );

  // ── PRINCIPAL VIEW ────────────────────────────────────────────────

  const renderPrincipal = () => (
    <>
      <Text style={styles.sectionHead}>Gate 2 — Persetujuan Harga</Text>
      <Text style={styles.hint}>Item dengan flag HIGH atau CRITICAL memerlukan keputusan Anda.</Text>

      {approvals.length === 0 && !loading && (
        <Card>
          <View style={styles.emptyApproval}>
            <Ionicons name="checkmark-circle" size={32} color={COLORS.ok} />
            <Text style={[styles.hint, { textAlign: 'center', marginTop: 8 }]}>Tidak ada item yang menunggu persetujuan.</Text>
          </View>
        </Card>
      )}

      {approvals.map(task => {
        const line = task.po?.lines[task.lineIndex ?? 0];
        const g2 = task.gate2Result;
        return (
          <Card key={task.id} borderColor={g2 ? flagColor(g2.overall.flag) : COLORS.border}>
            <View style={styles.lineHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineName}>{line?.material_name ?? 'Unknown'}</Text>
                <Text style={styles.hint}>
                  {getPurchaseOrderDisplayNumber(task.po ?? {})} · {task.po?.supplier} — {task.po?.material_name}
                </Text>
                <Text style={styles.lineDetail}>
                  {line?.quantity} {line?.unit} @ {line?.unit_price ? `Rp${line.unit_price.toLocaleString('id-ID')}` : '-'}
                </Text>
                {line && task.po ? (
                  <View style={styles.scopeTagChip}>
                    <Ionicons name="layers-outline" size={12} color={COLORS.primary} />
                    <Text style={styles.scopeTagText}>{resolveLineScopeTag(task.po, line)}</Text>
                  </View>
                ) : null}
              </View>
              {g2 && <Badge flag={g2.overall.flag} />}
            </View>

            {g2 && (
              <View style={[styles.checksBox, { backgroundColor: flagBg(g2.overall.flag) }]}>
                {renderCheckRow('Baseline', g2.checks.baseline)}
                {renderCheckRow('Riwayat Harga', g2.checks.historical)}
                {renderCheckRow('Vendor', g2.checks.vendor)}
              </View>
            )}

            <ApprovalActions taskId={task.id} onAction={handleApprovalAction} />
          </Card>
        );
      })}

      {/* Also show summary of all PO validations */}
      <Text style={[styles.sectionHead, { marginTop: 20 }]}>Ringkasan Validasi Harga</Text>
      {poList.map(po => {
        const flags = po.gate2?.map(g => g.overall.flag) ?? [];
        const hasCritical = flags.includes('CRITICAL');
        const hasHigh = flags.includes('HIGH');
        const borderColor = hasCritical ? COLORS.critical : hasHigh ? COLORS.high : COLORS.ok;
        return (
          <Card key={po.id} borderColor={borderColor}>
            <View style={styles.poRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.poSupplier}>{po.supplier}</Text>
                <Text style={styles.poNumber}>{getPurchaseOrderDisplayNumber(po)}</Text>
                <Text style={styles.hint}>{po.lines.length} line — {flags.filter(f => f === 'OK').length} OK, {flags.filter(f => f === 'WARNING' || f === 'HIGH' || f === 'CRITICAL').length} perlu perhatian</Text>
              </View>
              <Badge flag={hasCritical ? 'CRITICAL' : hasHigh ? 'HIGH' : 'OK'} />
            </View>
          </Card>
        );
      })}
    </>
  );

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {showBackButton && (
          <TouchableOpacity style={styles.backRow} onPress={onBack}>
            <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
            <Text style={styles.backRowText}>Kembali ke Laporan</Text>
          </TouchableOpacity>
        )}

        {loading && <Text style={styles.hint}>Memuat data harga...</Text>}

        {canManagePOs && renderManager()}
        {role === 'principal' && renderPrincipal()}

        {/* Supervisor sees read-only summary */}
        {role === 'supervisor' && (
          <>
            <Text style={styles.sectionHead}>Gate 2 — Status Harga</Text>
            <Card>
              <Text style={styles.hint}>Validasi harga dilakukan oleh Admin dan Estimator. Anda dapat melihat status PO di halaman Beranda.</Text>
            </Card>
          </>
        )}
      </ScrollView>

      <Modal visible={!!materialPickerLineId} transparent animationType="slide" onRequestClose={closeMaterialPicker}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Pilih Material</Text>
                <Text style={styles.modalSubtitle}>
                  {activeMaterialDraftLine ? `Line untuk ${activeMaterialDraftLine.quantity || 'qty belum diisi'} ${activeMaterialDraftLine.unit || ''}` : 'Cari dari katalog material'}
                </Text>
              </View>
              <TouchableOpacity style={styles.modalCloseBtn} onPress={closeMaterialPicker}>
                <Ionicons name="close" size={18} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={COLORS.textSec} />
              <TextInput
                style={styles.searchInput}
                value={materialSearch}
                onChangeText={setMaterialSearch}
                placeholder="Cari nama, kode, kategori..."
                placeholderTextColor={COLORS.textSec}
              />
            </View>

            <FlatList
              data={filteredMaterialOptions}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              style={styles.optionList}
              ListEmptyComponent={<Text style={styles.modalEmpty}>Tidak ada material yang cocok.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => materialPickerLineId && selectCatalogMaterial(materialPickerLineId, item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{item.name}</Text>
                    <Text style={styles.optionMeta}>
                      {[item.code, item.category, item.unit].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textSec} />
                </TouchableOpacity>
              )}
              ListFooterComponent={(
                <TouchableOpacity
                  style={[styles.optionRow, styles.optionRowLast]}
                  onPress={() => materialPickerLineId && clearCatalogMaterial(materialPickerLineId)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>Material belum ada di katalog</Text>
                    <Text style={styles.optionMeta}>Lanjutkan dengan input nama material dan unit manual.</Text>
                  </View>
                  <Ionicons name="create-outline" size={16} color={COLORS.primary} />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={boqPickerVisible} transparent animationType="slide" onRequestClose={() => setBoqPickerVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Pilih Item BoQ</Text>
                <Text style={styles.modalSubtitle}>Gunakan hanya jika satu PO benar-benar terkait ke satu item pekerjaan.</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setBoqPickerVisible(false)}>
                <Ionicons name="close" size={18} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={COLORS.textSec} />
              <TextInput
                style={styles.searchInput}
                value={boqSearch}
                onChangeText={setBoqSearch}
                placeholder="Cari kode atau nama pekerjaan..."
                placeholderTextColor={COLORS.textSec}
              />
            </View>

            <FlatList
              data={filteredBoqItems}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              style={styles.optionList}
              ListEmptyComponent={<Text style={styles.modalEmpty}>Tidak ada item BoQ yang cocok.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => {
                    setDraftBoqId(item.id);
                    setBoqPickerVisible(false);
                    setBoqSearch('');
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{item.code}</Text>
                    <Text style={styles.optionMeta}>{item.label}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textSec} />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Approval Actions Sub-component ──────────────────────────────────

function ApprovalActions({ taskId, onAction }: {
  taskId: string;
  onAction: (id: string, action: 'APPROVE' | 'REJECT' | 'HOLD' | 'OVERRIDE', reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [expanded, setExpanded] = useState(false);

  const act = (action: 'APPROVE' | 'REJECT' | 'HOLD' | 'OVERRIDE') => {
    if ((action === 'REJECT' || action === 'OVERRIDE') && !reason.trim()) {
      Alert.alert('Alasan Diperlukan', 'Masukkan alasan untuk tindakan ini.');
      return;
    }
    onAction(taskId, action, reason);
  };

  return (
    <View style={styles.approvalBox}>
      {!expanded ? (
        <TouchableOpacity style={styles.expandBtn} onPress={() => setExpanded(true)}>
          <Text style={styles.expandBtnText}>Beri Keputusan</Text>
        </TouchableOpacity>
      ) : (
        <>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={reason}
            onChangeText={setReason}
            placeholder="Catatan / alasan (wajib untuk Reject & Override)..."
            multiline
          />
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.ok }]} onPress={() => act('APPROVE')}>
              <Text style={styles.actionBtnText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.warning }]} onPress={() => act('HOLD')}>
              <Text style={styles.actionBtnText}>Hold</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.critical }]} onPress={() => act('REJECT')}>
              <Text style={styles.actionBtnText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.high }]} onPress={() => act('OVERRIDE')}>
              <Text style={styles.actionBtnText}>Override</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeVendorKey(value: string): string {
  return value.trim().toLowerCase();
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  sectionHead: { fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 1, textTransform: 'uppercase', color: COLORS.textSec, marginBottom: SPACE.sm + 2, marginTop: SPACE.md },
  hint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: SPACE.xs, marginBottom: SPACE.sm },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  backRowText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  poRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  poSupplier: { fontSize: TYPE.sm, fontFamily: FONTS.bold },
  poNumber: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.primary, marginTop: 2 },
  lineBlock: { marginTop: SPACE.md },
  lineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineName: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, flex: 1, marginRight: SPACE.sm },
  lineDetail: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 2 },
  scopeTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: SPACE.xs + 2,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    borderRadius: 999,
    backgroundColor: 'rgba(20,18,16,0.06)',
  },
  scopeTagText: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.primary },
  fieldLabel: { fontSize: TYPE.xs, fontFamily: FONTS.medium, marginTop: SPACE.sm + 2, marginBottom: SPACE.xs },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, color: COLORS.text },
  inputDisabled: { backgroundColor: COLORS.surfaceAlt, color: COLORS.textSec },
  textarea: { minHeight: 60, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 10 },
  row3: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  modeChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  modeChipActive: { borderColor: COLORS.primary, backgroundColor: 'rgba(20,18,16,0.08)' },
  modeChipText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec, textTransform: 'uppercase' },
  modeChipTextActive: { color: COLORS.primary },
  autoScopeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: SPACE.sm + 2,
    padding: SPACE.sm,
    borderRadius: RADIUS,
    backgroundColor: 'rgba(20,18,16,0.04)',
  },
  autoScopeLabel: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase', letterSpacing: 0.5 },
  autoScopeValue: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, marginTop: 2 },
  selectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: 12,
  },
  selectorText: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  selectorPlaceholder: { color: COLORS.textSec, fontFamily: FONTS.medium },
  selectorMeta: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 2 },
  inlineHint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 6 },
  checksBox: { borderRadius: RADIUS, padding: 10, marginTop: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  checkDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  checkLabel: { fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5, color: COLORS.textSec },
  checkMsg: { fontSize: TYPE.xs, marginTop: 1 },
  divider: { height: 1, backgroundColor: 'rgba(148,148,148,0.15)', marginTop: SPACE.md },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center', marginTop: SPACE.base },
  saveBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  ghostBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: 14, alignItems: 'center', marginTop: 12, backgroundColor: COLORS.surface, minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { color: COLORS.textSec, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  topActionRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: SPACE.sm + 2 },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: 14 },
  createBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase' },
  removeLineText: { color: COLORS.critical, fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase' },
  escalateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.high, borderRadius: RADIUS, padding: 10, marginTop: SPACE.sm + 2 },
  escalateBtnText: { color: COLORS.textInverse, fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  emptyApproval: { alignItems: 'center', paddingVertical: 20 },
  approvalBox: { marginTop: 12 },
  expandBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: 12, alignItems: 'center' },
  expandBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  actionRow: { flexDirection: 'row', gap: 6, marginTop: SPACE.sm + 2 },
  actionBtn: { flex: 1, borderRadius: RADIUS, padding: 10, alignItems: 'center' },
  actionBtnText: { color: COLORS.textInverse, fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,18,16,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '82%',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  modalSubtitle: { fontSize: 12, color: COLORS.textSec, marginTop: 3 },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceAlt,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
  },
  optionList: { flexGrow: 0 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,148,148,0.15)',
  },
  optionRowLast: { borderBottomWidth: 0 },
  optionTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  optionMeta: { fontSize: 12, color: COLORS.textSec, marginTop: 2 },
  modalEmpty: { fontSize: 13, color: COLORS.textSec, textAlign: 'center', paddingVertical: 24 },
});
