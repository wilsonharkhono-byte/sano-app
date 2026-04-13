// Audit Trace Screen — editable pivot view over import_staging_rows.
//
// Accessible from BaselineScreen header during REVIEW phase. Lets the
// estimator verify "what the parser read" from 3 angles (material, BoQ,
// AHS block) and fix mismatches before publish. Every edit writes back
// to the same staging rows the rest of BaselineScreen sees, so the
// review queue summary updates instantly when audit edits land.

import React, { useMemo, useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../components/Card';
import Badge from '../components/Badge';
import { useToast } from '../components/Toast';
import {
  updateStagingRowAudit,
  insertAuditAhsRow,
  deleteStagingRow,
  type ParsedAhsRow,
} from '../../tools/baseline';
import {
  extractBoqRows,
  extractAhsRows,
  extractMaterialRows,
  pivotByMaterial,
  pivotByBoq,
  pivotByAhsBlock,
  perUnitCost,
  formatRupiah,
  formatQuantity,
  type AuditBoqRow,
  type AuditAhsRow,
  type AuditMaterialRow,
  type MaterialUsage,
  type BoqBreakdown,
  type AhsBlockView,
  type AhsLineTypeStr,
} from '../../tools/auditPivot';
import type { ImportStagingRow } from '../../tools/types';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

type AuditTab = 'material' | 'boq' | 'ahs';

interface Props {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  sessionName: string;
  stagingRows: ImportStagingRow[];
  onRowsChange: (next: ImportStagingRow[]) => void;
}

// ─── Field edit helper ─────────────────────────────────────────────────

type EditableField =
  // boq
  | 'boq.code' | 'boq.label' | 'boq.unit' | 'boq.planned'
  // ahs
  | 'ahs.coefficient' | 'ahs.unit_price' | 'ahs.waste_factor'
  | 'ahs.material_name' | 'ahs.material_code' | 'ahs.unit' | 'ahs.tier'
  // material
  | 'mat.code' | 'mat.name' | 'mat.unit' | 'mat.reference_unit_price' | 'mat.category';

function coerceNumber(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function applyAuditEdit(
  row: ImportStagingRow,
  field: EditableField,
  value: string,
): { parsed: Record<string, unknown>; raw: Record<string, unknown> } {
  const parsed = { ...((row.parsed_data ?? {}) as Record<string, unknown>) };
  const raw = { ...((row.raw_data ?? {}) as Record<string, unknown>) };

  switch (field) {
    case 'boq.code': parsed.code = value.trim(); break;
    case 'boq.label': parsed.label = value; break;
    case 'boq.unit': parsed.unit = value.trim(); break;
    case 'boq.planned': parsed.planned = coerceNumber(value); break;

    case 'ahs.coefficient': {
      const n = coerceNumber(value);
      parsed.usage_rate = n;
      raw.coefficient = n;
      break;
    }
    case 'ahs.unit_price': raw.unitPrice = coerceNumber(value); break;
    case 'ahs.waste_factor': {
      const n = coerceNumber(value);
      parsed.waste_factor = n;
      raw.wasteFactor = n;
      break;
    }
    case 'ahs.material_name': parsed.material_name = value; break;
    case 'ahs.material_code': parsed.material_code = value.trim() || null; break;
    case 'ahs.unit': parsed.unit = value.trim(); break;
    case 'ahs.tier': parsed.tier = coerceNumber(value); break;

    case 'mat.code': parsed.code = value.trim(); break;
    case 'mat.name': parsed.name = value; break;
    case 'mat.unit': parsed.unit = value.trim(); break;
    case 'mat.reference_unit_price': parsed.reference_unit_price = coerceNumber(value); break;
    case 'mat.category': parsed.category = value; break;
  }

  return { parsed, raw };
}

// ─── Inline editable field component ───────────────────────────────────

interface EditableProps {
  value: string | number;
  onCommit: (next: string) => Promise<void>;
  numeric?: boolean;
  placeholder?: string;
  width?: number;
  align?: 'left' | 'right';
}

function EditableCell({ value, onCommit, numeric, placeholder, width, align = 'left' }: EditableProps) {
  const [draft, setDraft] = useState<string>(String(value ?? ''));
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (!focused) setDraft(String(value ?? ''));
  }, [value, focused]);

  const commit = async () => {
    if (draft === String(value ?? '')) {
      setFocused(false);
      return;
    }
    setSaving(true);
    try {
      await onCommit(draft);
    } finally {
      setSaving(false);
      setFocused(false);
    }
  };

  return (
    <View style={{ width }}>
      <TextInput
        style={[
          styles.cellInput,
          focused && styles.cellInputFocused,
          align === 'right' && { textAlign: 'right' },
        ]}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={commit}
        onChangeText={setDraft}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textSec}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        editable={!saving}
      />
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────

export default function AuditTraceScreen({
  visible,
  onClose,
  sessionId,
  sessionName,
  stagingRows,
  onRowsChange,
}: Props) {
  const { show: toast } = useToast();

  const [tab, setTab] = useState<AuditTab>('material');
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Pivot views — memoized so edits recompute automatically
  const boqRows = useMemo(() => extractBoqRows(stagingRows), [stagingRows]);
  const ahsRows = useMemo(() => extractAhsRows(stagingRows), [stagingRows]);
  const materialRows = useMemo(() => extractMaterialRows(stagingRows), [stagingRows]);

  const materialPivot = useMemo(
    () => pivotByMaterial(boqRows, ahsRows, materialRows),
    [boqRows, ahsRows, materialRows],
  );
  const boqPivot = useMemo(() => pivotByBoq(boqRows, ahsRows), [boqRows, ahsRows]);
  const ahsPivot = useMemo(() => pivotByAhsBlock(ahsRows), [ahsRows]);

  const updateOneRow = useCallback(
    (rowId: string, patch: Partial<ImportStagingRow>) => {
      const next = stagingRows.map(r => (r.id === rowId ? { ...r, ...patch } : r));
      onRowsChange(next);
    },
    [stagingRows, onRowsChange],
  );

  const removeRow = useCallback(
    (rowId: string) => {
      onRowsChange(stagingRows.filter(r => r.id !== rowId));
    },
    [stagingRows, onRowsChange],
  );

  const appendRow = useCallback(
    (row: ImportStagingRow) => {
      onRowsChange([...stagingRows, row]);
    },
    [stagingRows, onRowsChange],
  );

  const commitEdit = useCallback(
    async (rowId: string, field: EditableField, value: string) => {
      const target = stagingRows.find(r => r.id === rowId);
      if (!target) return;
      const { parsed, raw } = applyAuditEdit(target, field, value);
      const result = await updateStagingRowAudit(rowId, parsed, raw);
      if (!result.success) {
        toast(`Gagal simpan: ${result.error ?? 'unknown'}`, 'critical');
        return;
      }
      updateOneRow(rowId, {
        parsed_data: parsed,
        raw_data: raw,
        review_status: 'MODIFIED',
      });
    },
    [stagingRows, toast, updateOneRow],
  );

  const handleDeleteAhs = useCallback(
    (ahs: AuditAhsRow) => {
      const confirmMsg = `Hapus baris AHS "${ahs.materialName}" dari staging?`;
      const perform = async () => {
        const result = await deleteStagingRow(ahs.stagingId);
        if (!result.success) {
          toast(`Gagal hapus: ${result.error ?? 'unknown'}`, 'critical');
          return;
        }
        removeRow(ahs.stagingId);
        toast('Baris dihapus', 'ok');
      };
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.confirm(confirmMsg)) void perform();
        return;
      }
      Alert.alert('Hapus baris?', confirmMsg, [
        { text: 'Batal', style: 'cancel' },
        { text: 'Hapus', style: 'destructive', onPress: () => void perform() },
      ]);
    },
    [removeRow, toast],
  );

  const handleAddAhs = useCallback(
    async (boqCode: string, lineType: AhsLineTypeStr, blockTitle: string | null) => {
      const maxRow = stagingRows.reduce((m, r) => Math.max(m, r.row_number), 0);
      const parsed: ParsedAhsRow = {
        boq_code: boqCode,
        material_code: null,
        material_name: 'Item baru',
        material_spec: null,
        tier: 2,
        usage_rate: 1,
        unit: 'pcs',
        waste_factor: 0,
      };
      const raw = {
        ahsBlockTitle: blockTitle,
        ahsTitleRow: null,
        ahsJumlahRow: null,
        lineType,
        coefficient: 1,
        unitPrice: 0,
        subtotal: 0,
        wasteFactor: 0,
        sourceRow: null,
        linkMethod: 'manual',
        linkedBoqCodes: [boqCode],
      };
      const result = await insertAuditAhsRow(sessionId, maxRow + 1, parsed, raw);
      if (!result.success || !result.row) {
        toast(`Gagal tambah baris: ${result.error ?? 'unknown'}`, 'critical');
        return;
      }
      appendRow(result.row);
      toast('Baris AHS ditambahkan', 'ok');
    },
    [stagingRows, sessionId, toast, appendRow],
  );

  // Reset selection when switching tabs
  const switchTab = (next: AuditTab) => {
    setTab(next);
    setSelectedKey(null);
    setSearch('');
  };

  const close = () => {
    setSelectedKey(null);
    setSearch('');
    onClose();
  };

  // ─── Filtered lists ─────────────────────────────────────────────────

  const filteredMaterialPivot = useMemo(() => {
    if (!search.trim()) return materialPivot;
    const q = search.toLowerCase();
    return materialPivot.filter(
      m =>
        m.displayName.toLowerCase().includes(q)
        || (m.material?.code ?? '').toLowerCase().includes(q),
    );
  }, [materialPivot, search]);

  const filteredBoqPivot = useMemo(() => {
    if (!search.trim()) return boqPivot;
    const q = search.toLowerCase();
    return boqPivot.filter(
      b =>
        b.boq.code.toLowerCase().includes(q)
        || b.boq.label.toLowerCase().includes(q),
    );
  }, [boqPivot, search]);

  const filteredAhsPivot = useMemo(() => {
    if (!search.trim()) return ahsPivot;
    const q = search.toLowerCase();
    return ahsPivot.filter(
      a =>
        a.title.toLowerCase().includes(q)
        || a.linkedBoqCodes.some(c => c.toLowerCase().includes(q)),
    );
  }, [ahsPivot, search]);

  // ─── Detail selections ──────────────────────────────────────────────

  const selectedMaterial = useMemo(
    () => (tab === 'material' && selectedKey
      ? materialPivot.find(m => m.materialKey === selectedKey) ?? null
      : null),
    [tab, selectedKey, materialPivot],
  );

  const selectedBoq = useMemo(
    () => (tab === 'boq' && selectedKey
      ? boqPivot.find(b => b.boq.stagingId === selectedKey) ?? null
      : null),
    [tab, selectedKey, boqPivot],
  );

  const selectedBlock = useMemo(
    () => (tab === 'ahs' && selectedKey
      ? ahsPivot.find(a => a.blockKey === selectedKey) ?? null
      : null),
    [tab, selectedKey, ahsPivot],
  );

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.flex}>
        <View style={styles.header}>
          <TouchableOpacity onPress={close} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={COLORS.primary} />
            <Text style={styles.closeText}>Tutup</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Audit & Edit Parser</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{sessionName}</Text>
          </View>
        </View>

        {/* Tab bar */}
        <View style={styles.tabRow}>
          {([
            { key: 'material', label: 'Material' },
            { key: 'boq', label: 'BoQ Item' },
            { key: 'ahs', label: 'AHS Block' },
          ] as Array<{ key: AuditTab; label: string }>).map(t => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabActive]}
              onPress={() => switchTab(t.key)}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Search bar */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={COLORS.textSec} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={
              tab === 'material' ? 'Cari material...'
                : tab === 'boq' ? 'Cari kode/uraian BoQ...'
                  : 'Cari judul block / kode BoQ...'
            }
            placeholderTextColor={COLORS.textSec}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={COLORS.textSec} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {/* Material tab */}
          {tab === 'material' && !selectedMaterial && (
            <MaterialList
              items={filteredMaterialPivot}
              onSelect={k => setSelectedKey(k)}
            />
          )}
          {tab === 'material' && selectedMaterial && (
            <MaterialDetail
              usage={selectedMaterial}
              onBack={() => setSelectedKey(null)}
              onEdit={commitEdit}
              onDeleteAhs={handleDeleteAhs}
            />
          )}

          {/* BoQ tab */}
          {tab === 'boq' && !selectedBoq && (
            <BoqList items={filteredBoqPivot} onSelect={k => setSelectedKey(k)} />
          )}
          {tab === 'boq' && selectedBoq && (
            <BoqDetail
              breakdown={selectedBoq}
              onBack={() => setSelectedKey(null)}
              onEdit={commitEdit}
              onDeleteAhs={handleDeleteAhs}
              onAddAhs={handleAddAhs}
            />
          )}

          {/* AHS block tab */}
          {tab === 'ahs' && !selectedBlock && (
            <AhsBlockList items={filteredAhsPivot} onSelect={k => setSelectedKey(k)} />
          )}
          {tab === 'ahs' && selectedBlock && (
            <AhsBlockDetail
              block={selectedBlock}
              onBack={() => setSelectedKey(null)}
              onEdit={commitEdit}
              onDeleteAhs={handleDeleteAhs}
            />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function StatusBadge({ status, needsReview }: { status: string; needsReview: boolean }) {
  const flag =
    status === 'MODIFIED' ? 'INFO'
      : status === 'APPROVED' ? 'OK'
        : status === 'REJECTED' ? 'CRITICAL'
          : needsReview ? 'WARNING' : 'INFO';
  const label =
    status === 'MODIFIED' ? 'DIUBAH'
      : status === 'APPROVED' ? 'OK'
        : status === 'REJECTED' ? 'DITOLAK'
          : needsReview ? 'PERLU REVIEW' : 'PENDING';
  return <Badge flag={flag} label={label} />;
}

// ─── Material tab views ────────────────────────────────────────────────

function MaterialList({
  items, onSelect,
}: { items: MaterialUsage[]; onSelect: (key: string) => void }) {
  if (items.length === 0) {
    return (
      <Card>
        <Text style={styles.hint}>Tidak ada material yang cocok.</Text>
      </Card>
    );
  }
  return (
    <>
      <Text style={styles.sectionHead}>Daftar Material ({items.length})</Text>
      {items.map(m => (
        <TouchableOpacity key={m.materialKey} onPress={() => onSelect(m.materialKey)} activeOpacity={0.7}>
          <Card borderColor={m.hasOrphan ? COLORS.warning : COLORS.border}>
            <View style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{m.displayName}</Text>
                <Text style={styles.hint}>
                  {m.lines.length} AHS line · {m.material?.code ?? 'no-code'} · satuan {m.displayUnit}
                </Text>
                {m.hasOrphan && (
                  <Text style={[styles.hint, { color: COLORS.warning }]}>
                    Ada baris AHS yang belum ter-link ke BoQ item.
                  </Text>
                )}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.listTotal}>{formatRupiah(m.grandCost)}</Text>
                <Text style={styles.hint}>{formatQuantity(m.grandQty)} {m.displayUnit}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textSec} />
            </View>
          </Card>
        </TouchableOpacity>
      ))}
    </>
  );
}

function MaterialDetail({
  usage, onBack, onEdit, onDeleteAhs,
}: {
  usage: MaterialUsage;
  onBack: () => void;
  onEdit: (rowId: string, field: EditableField, value: string) => Promise<void>;
  onDeleteAhs: (ahs: AuditAhsRow) => void;
}) {
  return (
    <>
      <TouchableOpacity onPress={onBack} style={styles.backRow}>
        <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
        <Text style={styles.backText}>Kembali ke daftar material</Text>
      </TouchableOpacity>

      <Card borderColor={COLORS.primary}>
        <Text style={styles.detailTitle}>{usage.displayName}</Text>
        <Text style={styles.hint}>
          Code: {usage.material?.code ?? '—'} · Satuan: {usage.displayUnit}
        </Text>
        {usage.material && (
          <View style={styles.formRow}>
            <View style={styles.formCol}>
              <Text style={styles.formLabel}>Nama Material (catalog)</Text>
              <EditableCell
                value={usage.material.name}
                onCommit={v => onEdit(usage.material!.stagingId, 'mat.name', v)}
              />
            </View>
            <View style={styles.formCol}>
              <Text style={styles.formLabel}>Satuan</Text>
              <EditableCell
                value={usage.material.unit}
                onCommit={v => onEdit(usage.material!.stagingId, 'mat.unit', v)}
              />
            </View>
            <View style={styles.formCol}>
              <Text style={styles.formLabel}>Ref Harga</Text>
              <EditableCell
                value={usage.material.refUnitPrice}
                numeric
                align="right"
                onCommit={v => onEdit(usage.material!.stagingId, 'mat.reference_unit_price', v)}
              />
            </View>
          </View>
        )}

        <View style={styles.totalsRow}>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Total Kebutuhan</Text>
            <Text style={styles.totalValue}>{formatQuantity(usage.grandQty)} {usage.displayUnit}</Text>
          </View>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Total Biaya</Text>
            <Text style={[styles.totalValue, { color: COLORS.primary }]}>
              {formatRupiah(usage.grandCost)}
            </Text>
          </View>
        </View>
      </Card>

      <Text style={styles.sectionHead}>AHS Line yang memakai material ini</Text>
      {usage.lines.map(line => (
        <Card key={line.ahs.stagingId} borderColor={line.ahs.reviewStatus === 'MODIFIED' ? COLORS.info : COLORS.border}>
          <View style={styles.lineHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineBoq}>
                {line.boq?.code ?? '???'} · {line.boq?.label ?? 'BoQ tidak ditemukan'}
              </Text>
              <Text style={styles.hint}>
                Block: {line.ahs.blockTitle ?? '—'}
                {line.ahs.sourceRow != null ? ` · row Analisa ${line.ahs.sourceRow}` : ''}
              </Text>
            </View>
            <StatusBadge status={line.ahs.reviewStatus} needsReview={line.ahs.needsReview} />
          </View>

          <View style={styles.formRow}>
            <View style={styles.formCol}>
              <Text style={styles.formLabel}>Koefisien</Text>
              <EditableCell
                value={line.ahs.coefficient}
                numeric align="right"
                onCommit={v => onEdit(line.ahs.stagingId, 'ahs.coefficient', v)}
              />
            </View>
            <View style={styles.formCol}>
              <Text style={styles.formLabel}>Waste</Text>
              <EditableCell
                value={line.ahs.wasteFactor}
                numeric align="right"
                onCommit={v => onEdit(line.ahs.stagingId, 'ahs.waste_factor', v)}
              />
            </View>
            <View style={styles.formCol}>
              <Text style={styles.formLabel}>Harga Satuan</Text>
              <EditableCell
                value={line.ahs.unitPrice}
                numeric align="right"
                onCommit={v => onEdit(line.ahs.stagingId, 'ahs.unit_price', v)}
              />
            </View>
          </View>

          <View style={styles.lineFooter}>
            <View>
              <Text style={styles.hint}>Qty × {formatQuantity(line.boq?.planned ?? 0)} {line.boq?.unit ?? ''}</Text>
              <Text style={styles.lineMath}>
                {formatQuantity(line.perUnitQty)} {line.ahs.unit} × {formatQuantity(line.boq?.planned ?? 0)} = {formatQuantity(line.totalQty)}
              </Text>
            </View>
            <Text style={styles.lineTotal}>{formatRupiah(line.totalCost)}</Text>
          </View>

          <TouchableOpacity style={styles.deleteBtn} onPress={() => onDeleteAhs(line.ahs)}>
            <Ionicons name="trash-outline" size={14} color={COLORS.critical} />
            <Text style={styles.deleteText}>Hapus baris</Text>
          </TouchableOpacity>
        </Card>
      ))}
    </>
  );
}

// ─── BoQ tab views ─────────────────────────────────────────────────────

function BoqList({
  items, onSelect,
}: { items: BoqBreakdown[]; onSelect: (key: string) => void }) {
  if (items.length === 0) {
    return <Card><Text style={styles.hint}>Tidak ada BoQ item yang cocok.</Text></Card>;
  }
  return (
    <>
      <Text style={styles.sectionHead}>Daftar BoQ ({items.length})</Text>
      {items.map(b => (
        <TouchableOpacity key={b.boq.stagingId} onPress={() => onSelect(b.boq.stagingId)} activeOpacity={0.7}>
          <Card borderColor={b.boq.needsReview ? COLORS.warning : COLORS.border}>
            <View style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{b.boq.code} — {b.boq.label}</Text>
                <Text style={styles.hint}>
                  {b.boq.chapter ?? '—'} · {formatQuantity(b.boq.planned)} {b.boq.unit} · {b.lines.length} AHS line
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.listTotal}>{formatRupiah(b.grandTotal)}</Text>
                <Text style={styles.hint}>{formatRupiah(b.perUnitTotal)}/{b.boq.unit}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textSec} />
            </View>
          </Card>
        </TouchableOpacity>
      ))}
    </>
  );
}

function BoqDetail({
  breakdown, onBack, onEdit, onDeleteAhs, onAddAhs,
}: {
  breakdown: BoqBreakdown;
  onBack: () => void;
  onEdit: (rowId: string, field: EditableField, value: string) => Promise<void>;
  onDeleteAhs: (ahs: AuditAhsRow) => void;
  onAddAhs: (boqCode: string, lineType: AhsLineTypeStr, title: string | null) => Promise<void>;
}) {
  const [addingType, setAddingType] = useState<AhsLineTypeStr | null>(null);
  const [adding, setAdding] = useState(false);

  const commitAdd = async (type: AhsLineTypeStr) => {
    setAdding(true);
    try {
      await onAddAhs(breakdown.boq.code, type, breakdown.lines[0]?.ahs.blockTitle ?? null);
    } finally {
      setAdding(false);
      setAddingType(null);
    }
  };

  const sections: Array<{ type: AhsLineTypeStr; label: string }> = [
    { type: 'material', label: 'Material' },
    { type: 'labor', label: 'Upah' },
    { type: 'equipment', label: 'Peralatan' },
    { type: 'subkon', label: 'Subkon' },
  ];

  return (
    <>
      <TouchableOpacity onPress={onBack} style={styles.backRow}>
        <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
        <Text style={styles.backText}>Kembali ke daftar BoQ</Text>
      </TouchableOpacity>

      <Card borderColor={COLORS.primary}>
        <Text style={styles.detailTitle}>{breakdown.boq.code}</Text>
        <View style={styles.formRow}>
          <View style={[styles.formCol, { flex: 2 }]}>
            <Text style={styles.formLabel}>Uraian</Text>
            <EditableCell
              value={breakdown.boq.label}
              onCommit={v => onEdit(breakdown.boq.stagingId, 'boq.label', v)}
            />
          </View>
        </View>
        <View style={styles.formRow}>
          <View style={styles.formCol}>
            <Text style={styles.formLabel}>Kode</Text>
            <EditableCell
              value={breakdown.boq.code}
              onCommit={v => onEdit(breakdown.boq.stagingId, 'boq.code', v)}
            />
          </View>
          <View style={styles.formCol}>
            <Text style={styles.formLabel}>Satuan</Text>
            <EditableCell
              value={breakdown.boq.unit}
              onCommit={v => onEdit(breakdown.boq.stagingId, 'boq.unit', v)}
            />
          </View>
          <View style={styles.formCol}>
            <Text style={styles.formLabel}>Volume</Text>
            <EditableCell
              value={breakdown.boq.planned}
              numeric align="right"
              onCommit={v => onEdit(breakdown.boq.stagingId, 'boq.planned', v)}
            />
          </View>
        </View>
        <Text style={styles.hint}>
          Chapter: {breakdown.boq.chapter ?? '—'}
          {breakdown.boq.sourceSheet ? ` · ${breakdown.boq.sourceSheet}` : ''}
          {breakdown.boq.sourceRow != null ? ` row ${breakdown.boq.sourceRow}` : ''}
        </Text>

        <View style={styles.totalsRow}>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Harga / {breakdown.boq.unit}</Text>
            <Text style={styles.totalValue}>{formatRupiah(breakdown.perUnitTotal)}</Text>
          </View>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={[styles.totalValue, { color: COLORS.primary }]}>
              {formatRupiah(breakdown.grandTotal)}
            </Text>
          </View>
        </View>

        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownCell}>M: {formatRupiah(breakdown.material.total)}</Text>
          <Text style={styles.breakdownCell}>U: {formatRupiah(breakdown.labor.total)}</Text>
          <Text style={styles.breakdownCell}>A: {formatRupiah(breakdown.equipment.total)}</Text>
          <Text style={styles.breakdownCell}>S: {formatRupiah(breakdown.subkon.total)}</Text>
        </View>
      </Card>

      {sections.map(section => {
        const lines = breakdown.lines.filter(l => l.ahs.lineType === section.type);
        return (
          <View key={section.type}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHead}>{section.label} ({lines.length})</Text>
              <TouchableOpacity
                style={styles.addSmallBtn}
                onPress={() => commitAdd(section.type)}
                disabled={adding}
              >
                {adding && addingType === section.type
                  ? <ActivityIndicator size="small" color={COLORS.primary} />
                  : <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />}
                <Text style={styles.addSmallText}>Tambah</Text>
              </TouchableOpacity>
            </View>

            {lines.length === 0 && (
              <Card><Text style={styles.hint}>Belum ada baris.</Text></Card>
            )}

            {lines.map(line => (
              <Card
                key={line.ahs.stagingId}
                borderColor={line.ahs.reviewStatus === 'MODIFIED' ? COLORS.info : COLORS.border}
              >
                <View style={styles.lineHeader}>
                  <View style={{ flex: 1 }}>
                    <EditableCell
                      value={line.ahs.materialName}
                      onCommit={v => onEdit(line.ahs.stagingId, 'ahs.material_name', v)}
                    />
                    <Text style={styles.hint}>
                      {line.ahs.blockTitle ?? '—'}
                      {line.ahs.sourceRow != null ? ` · row ${line.ahs.sourceRow}` : ''}
                    </Text>
                  </View>
                  <StatusBadge status={line.ahs.reviewStatus} needsReview={line.ahs.needsReview} />
                </View>

                <View style={styles.formRow}>
                  <View style={styles.formCol}>
                    <Text style={styles.formLabel}>Koefisien</Text>
                    <EditableCell
                      value={line.ahs.coefficient}
                      numeric align="right"
                      onCommit={v => onEdit(line.ahs.stagingId, 'ahs.coefficient', v)}
                    />
                  </View>
                  <View style={styles.formCol}>
                    <Text style={styles.formLabel}>Satuan</Text>
                    <EditableCell
                      value={line.ahs.unit}
                      onCommit={v => onEdit(line.ahs.stagingId, 'ahs.unit', v)}
                    />
                  </View>
                  <View style={styles.formCol}>
                    <Text style={styles.formLabel}>Waste</Text>
                    <EditableCell
                      value={line.ahs.wasteFactor}
                      numeric align="right"
                      onCommit={v => onEdit(line.ahs.stagingId, 'ahs.waste_factor', v)}
                    />
                  </View>
                  <View style={styles.formCol}>
                    <Text style={styles.formLabel}>Harga</Text>
                    <EditableCell
                      value={line.ahs.unitPrice}
                      numeric align="right"
                      onCommit={v => onEdit(line.ahs.stagingId, 'ahs.unit_price', v)}
                    />
                  </View>
                </View>

                <View style={styles.lineFooter}>
                  <Text style={styles.hint}>per {breakdown.boq.unit}</Text>
                  <Text style={styles.lineTotal}>{formatRupiah(line.perUnitCost)}</Text>
                </View>

                <TouchableOpacity style={styles.deleteBtn} onPress={() => onDeleteAhs(line.ahs)}>
                  <Ionicons name="trash-outline" size={14} color={COLORS.critical} />
                  <Text style={styles.deleteText}>Hapus baris</Text>
                </TouchableOpacity>
              </Card>
            ))}
          </View>
        );
      })}
    </>
  );
}

// ─── AHS Block tab views ───────────────────────────────────────────────

function AhsBlockList({
  items, onSelect,
}: { items: AhsBlockView[]; onSelect: (key: string) => void }) {
  if (items.length === 0) {
    return <Card><Text style={styles.hint}>Tidak ada AHS block yang cocok.</Text></Card>;
  }
  return (
    <>
      <Text style={styles.sectionHead}>AHS Block ({items.length})</Text>
      {items.map(b => (
        <TouchableOpacity key={b.blockKey} onPress={() => onSelect(b.blockKey)} activeOpacity={0.7}>
          <Card>
            <View style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{b.title}</Text>
                <Text style={styles.hint}>
                  {b.components.length} komponen
                  {b.linkedBoqCodes.length > 0 ? ` · BoQ: ${b.linkedBoqCodes.slice(0, 3).join(', ')}${b.linkedBoqCodes.length > 3 ? ` +${b.linkedBoqCodes.length - 3}` : ''}` : ' · Belum ter-link'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.listTotal}>{formatRupiah(b.totals.grand)}</Text>
                <Text style={styles.hint}>per unit</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textSec} />
            </View>
          </Card>
        </TouchableOpacity>
      ))}
    </>
  );
}

function AhsBlockDetail({
  block, onBack, onEdit, onDeleteAhs,
}: {
  block: AhsBlockView;
  onBack: () => void;
  onEdit: (rowId: string, field: EditableField, value: string) => Promise<void>;
  onDeleteAhs: (ahs: AuditAhsRow) => void;
}) {
  return (
    <>
      <TouchableOpacity onPress={onBack} style={styles.backRow}>
        <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
        <Text style={styles.backText}>Kembali ke daftar block</Text>
      </TouchableOpacity>

      <Card borderColor={COLORS.primary}>
        <Text style={styles.detailTitle}>{block.title}</Text>
        <Text style={styles.hint}>
          {block.titleRow != null ? `Baris judul: row ${block.titleRow} · ` : ''}
          BoQ linked: {block.linkedBoqCodes.length > 0 ? block.linkedBoqCodes.join(', ') : '—'}
        </Text>

        <View style={styles.totalsRow}>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Total/Unit</Text>
            <Text style={[styles.totalValue, { color: COLORS.primary }]}>
              {formatRupiah(block.totals.grand)}
            </Text>
          </View>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownCell}>M: {formatRupiah(block.totals.material)}</Text>
          <Text style={styles.breakdownCell}>U: {formatRupiah(block.totals.labor)}</Text>
          <Text style={styles.breakdownCell}>A: {formatRupiah(block.totals.equipment)}</Text>
          <Text style={styles.breakdownCell}>S: {formatRupiah(block.totals.subkon)}</Text>
        </View>
      </Card>

      <Text style={styles.sectionHead}>Komponen</Text>
      {block.components.map(c => (
        <Card
          key={c.ahs.stagingId}
          borderColor={c.ahs.reviewStatus === 'MODIFIED' ? COLORS.info : COLORS.border}
        >
          <View style={styles.lineHeader}>
            <View style={{ flex: 1 }}>
              <EditableCell
                value={c.ahs.materialName}
                onCommit={v => onEdit(c.ahs.stagingId, 'ahs.material_name', v)}
              />
              <Text style={styles.hint}>
                {c.ahs.lineType.toUpperCase()}
                {c.ahs.sourceRow != null ? ` · row ${c.ahs.sourceRow}` : ''}
              </Text>
            </View>
            <StatusBadge status={c.ahs.reviewStatus} needsReview={c.ahs.needsReview} />
          </View>
          <View style={styles.formRow}>
            <View style={styles.formCol}>
              <Text style={styles.formLabel}>Koefisien</Text>
              <EditableCell
                value={c.ahs.coefficient}
                numeric align="right"
                onCommit={v => onEdit(c.ahs.stagingId, 'ahs.coefficient', v)}
              />
            </View>
            <View style={styles.formCol}>
              <Text style={styles.formLabel}>Satuan</Text>
              <EditableCell
                value={c.ahs.unit}
                onCommit={v => onEdit(c.ahs.stagingId, 'ahs.unit', v)}
              />
            </View>
            <View style={styles.formCol}>
              <Text style={styles.formLabel}>Waste</Text>
              <EditableCell
                value={c.ahs.wasteFactor}
                numeric align="right"
                onCommit={v => onEdit(c.ahs.stagingId, 'ahs.waste_factor', v)}
              />
            </View>
            <View style={styles.formCol}>
              <Text style={styles.formLabel}>Harga</Text>
              <EditableCell
                value={c.ahs.unitPrice}
                numeric align="right"
                onCommit={v => onEdit(c.ahs.stagingId, 'ahs.unit_price', v)}
              />
            </View>
          </View>
          <View style={styles.lineFooter}>
            <Text style={styles.hint}>per unit BoQ</Text>
            <Text style={styles.lineTotal}>{formatRupiah(c.perUnitCost)}</Text>
          </View>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => onDeleteAhs(c.ahs)}>
            <Ionicons name="trash-outline" size={14} color={COLORS.critical} />
            <Text style={styles.deleteText}>Hapus baris</Text>
          </TouchableOpacity>
        </Card>
      ))}
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    paddingHorizontal: SPACE.base, paddingVertical: SPACE.sm + 4,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  closeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingRight: 8 },
  closeText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  title: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text },
  subtitle: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 1 },

  tabRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: SPACE.base, paddingTop: SPACE.sm, paddingBottom: 4,
    backgroundColor: COLORS.surface,
  },
  tab: {
    flex: 1, paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text, textTransform: 'uppercase' },
  tabTextActive: { color: COLORS.textInverse },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: SPACE.base, marginVertical: SPACE.sm,
    paddingHorizontal: SPACE.md, paddingVertical: 8,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    backgroundColor: COLORS.surface,
  },
  searchInput: { flex: 1, fontSize: TYPE.sm, color: COLORS.text, padding: 0 },

  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },

  sectionHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.bold,
    letterSpacing: 1, textTransform: 'uppercase',
    color: COLORS.textSec, marginBottom: SPACE.sm, marginTop: SPACE.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: SPACE.md, marginBottom: SPACE.sm,
  },
  addSmallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.primary,
  },
  addSmallText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary },

  hint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 2 },
  backRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, marginBottom: 4,
  },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },

  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listTitle: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  listTotal: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.text },

  detailTitle: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text, marginBottom: 2 },

  formRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  formCol: { flex: 1 },
  formLabel: {
    fontSize: 10, fontFamily: FONTS.semibold, color: COLORS.textSec,
    textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 3,
  },
  cellInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 7,
    fontSize: TYPE.sm, color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  cellInputFocused: { borderColor: COLORS.primary, backgroundColor: '#fff' },

  totalsRow: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  totalBox: {
    flex: 1,
    padding: SPACE.sm + 2,
    borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  totalLabel: {
    fontSize: 10, fontFamily: FONTS.semibold, color: COLORS.textSec,
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  totalValue: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text, marginTop: 2 },

  breakdownRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  breakdownCell: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.medium },

  lineHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineBoq: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  lineFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)',
  },
  lineMath: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.text, marginTop: 2 },
  lineTotal: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.primary },

  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    marginTop: 8, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(198,40,40,0.3)', borderRadius: 6,
    backgroundColor: 'rgba(198,40,40,0.04)',
  },
  deleteText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.critical },
});
