import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import FlagPanel from '../components/FlagPanel';
import DateSelectField, { getTodayIsoDate } from '../components/DateSelectField';
import MaterialNamingAssist from '../components/MaterialNamingAssist';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { computeWorkGroupGate1Flag, type EnvelopeUnitDisplay } from '../gates/gate1';
import { sanitizeText, isPositiveNumber } from '../../tools/validation';
import { supplierToBase } from '../../tools/materialUnitConversion';
import { applyCatalogMaterialToLine } from '../../tools/materialSelection';
import { supabase } from '../../tools/supabase';
import { getWorkGroupEnvelope } from '../../tools/envelopes';
import { evaluateTier4Untracked } from '../../tools/budgetGate';
import { buildWorkGroups } from '../../tools/boqWorkGroups';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, RADIUS_SM } from '../theme';
import type {
  GateResult,
  FlagLevel,
  MaterialEnvelopeStatus,
  EnvelopeBoqBreakdown,
  MaterialRequestAllocationBasis,
  WorkGroup,
} from '../../tools/types';

type RequestBasis = 'BOQ' | 'MATERIAL';

const ACTIVE_REQUEST_BASIS: RequestBasis = 'MATERIAL';

interface MaterialOption {
  id: string;
  name: string;
  unit: string;
  supplier_unit: string;
  /** Base units per ONE supplier_unit (kg per batang for rebar). null = 1:1. */
  base_qty_per_supplier_unit: number | null;
  tier: 1 | 2 | 3 | 4;
  code: string | null;
  category: string | null;
}

interface AllocationPreview {
  boqItemId: string | null;
  boqCode: string;
  boqLabel: string;
  allocatedQuantity: number;
  proportionPct: number;
  allocationBasis: MaterialRequestAllocationBasis;
}

interface RequestLine {
  id: string;
  materialId: string | null;
  materialName: string;
  isCustom: boolean;
  tier: 1 | 2 | 3 | 4;
  /** Typed in SUPPLIER units (batang for rebar); gates/persist convert to base. */
  quantity: string;
  unit: string;
  /** The material's base unit ('kg' for rebar) — what gates and storage use. */
  baseUnit: string;
  /** kg per batang for rebar; null = unit is already base (1:1). */
  base_qty_per_supplier_unit: number | null;
  specRef: string;
  boqItemId: string | null;
  /** Tier 1 work-group target (key from buildWorkGroups). */
  workGroupKey: string | null;
  lineResult: GateResult | null;
  allocationPreview: AllocationPreview[];
}

const FLAG_ORDER: FlagLevel[] = ['OK', 'INFO', 'WARNING', 'HIGH', 'CRITICAL'];

const URGENCY_OPTIONS = [
  { key: 'NORMAL', label: 'Normal', color: COLORS.ok },
  { key: 'URGENT', label: 'Urgent', color: COLORS.warning },
  { key: 'CRITICAL', label: 'Kritis', color: COLORS.critical },
] as const;

const TIER_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Tier 1 — Presisi',
  2: 'Tier 2 — Bulk',
  3: 'Tier 3 — Habis Pakai',
  4: 'Tier 4 — Consumable',
};

const TIER_COLORS: Record<1 | 2 | 3 | 4, string> = {
  1: COLORS.primary,
  2: COLORS.accent,
  3: COLORS.textSec,
  4: COLORS.textMuted,
};

let lineCounter = 0;
function nextLineId() {
  lineCounter += 1;
  return `line_${lineCounter}_${Date.now()}`;
}

function makeLine(overrides: Partial<RequestLine> = {}): RequestLine {
  return {
    id: nextLineId(),
    materialId: null,
    materialName: '',
    isCustom: false,
    tier: 3,
    quantity: '',
    unit: '',
    baseUnit: '',
    base_qty_per_supplier_unit: null,
    specRef: '',
    boqItemId: null,
    workGroupKey: null,
    lineResult: null,
    allocationPreview: [],
    ...overrides,
  };
}

function roundQty(value: number) {
  return Math.round(value * 100) / 100;
}

function buildTier2Allocations(
  breakdown: EnvelopeBoqBreakdown[],
  requestedQty: number,
): AllocationPreview[] {
  if (requestedQty <= 0 || breakdown.length === 0) return [];

  const totalPlanned = breakdown.reduce((sum, row) => sum + Number(row.planned_quantity ?? 0), 0);
  if (totalPlanned <= 0) return [];

  let allocatedSoFar = 0;

  return breakdown.map((row, index) => {
    const baseQty = requestedQty * (Number(row.planned_quantity ?? 0) / totalPlanned);
    const allocatedQuantity = index === breakdown.length - 1
      ? roundQty(requestedQty - allocatedSoFar)
      : roundQty(baseQty);

    allocatedSoFar = roundQty(allocatedSoFar + allocatedQuantity);

    return {
      boqItemId: row.boq_item_id,
      boqCode: row.boq_code,
      boqLabel: row.boq_label,
      allocatedQuantity,
      proportionPct: Number(row.pct_of_total ?? 0),
      allocationBasis: 'TIER2_ENVELOPE',
    };
  });
}

/**
 * Allocate a work-group order proportionally across the rows IN THE GROUP that
 * use this material. Reuses the project-wide breakdown, filtered to the group's
 * rows and renormalized so proportions sum to 100% within the group.
 */
function buildWorkGroupAllocations(
  breakdown: EnvelopeBoqBreakdown[],
  groupItemIds: string[],
  requestedQty: number,
): AllocationPreview[] {
  if (requestedQty <= 0) return [];
  const idSet = new Set(groupItemIds);
  const rows = breakdown.filter(r => idSet.has(r.boq_item_id));
  const totalPlanned = rows.reduce((sum, r) => sum + Number(r.planned_quantity ?? 0), 0);
  if (rows.length === 0 || totalPlanned <= 0) return [];

  let allocatedSoFar = 0;
  return rows.map((row, index) => {
    const share = Number(row.planned_quantity ?? 0) / totalPlanned;
    const allocatedQuantity = index === rows.length - 1
      ? roundQty(requestedQty - allocatedSoFar)
      : roundQty(requestedQty * share);
    allocatedSoFar = roundQty(allocatedSoFar + allocatedQuantity);
    return {
      boqItemId: row.boq_item_id,
      boqCode: row.boq_code,
      boqLabel: row.boq_label,
      allocatedQuantity,
      proportionPct: roundQty(share * 100),
      allocationBasis: 'WORKGROUP_ENVELOPE' as const,
    };
  });
}

/** "a / b batang (a / b kg)" when a rebar factor exists, else "a / b kg". */
function fmtEnvPairDisplay(a: number, b: number, baseUnit: string, display?: EnvelopeUnitDisplay | null): string {
  if (display?.factor && display.factor > 0) {
    const toBtg = (n: number) => (n / display.factor!).toLocaleString('id-ID', { maximumFractionDigits: 2 });
    return `${toBtg(a)} / ${toBtg(b)} ${display.supplierUnit} (${Math.round(a).toLocaleString('id-ID')} / ${Math.round(b).toLocaleString('id-ID')} ${baseUnit})`;
  }
  return `${Math.round(a).toLocaleString('id-ID')} / ${Math.round(b).toLocaleString('id-ID')} ${baseUnit}`;
}

function buildTier2Result(
  envelope: MaterialEnvelopeStatus | null,
  requestedQty: number,
  display?: EnvelopeUnitDisplay | null,
): GateResult {
  if (!envelope) {
    return {
      flag: 'INFO',
      check: '1a',
      msg: 'Envelope material belum tersedia di baseline. Tetap boleh diajukan, tetapi estimator harus review manual.',
    };
  }

  // Gate math burns on total_requested (running request demand), NOT total_ordered
  // (which now means SANO-PO qty). This keeps the client soft gate numerically in
  // step with the server gate compute_tier2_flag (033), which migration 068
  // re-points to total_requested. The DISPLAY below splits di-PO vs permintaan.
  // HANDOFF → Task 2.4 (069): re-derive as planned − PO − other requests when the
  // full PO-aware soft gate lands.
  const newTotal = Number(envelope.total_requested ?? 0) + requestedQty;
  const burnPct = Number(envelope.total_planned ?? 0) > 0
    ? (newTotal / Number(envelope.total_planned)) * 100
    : 0;

  if (burnPct > 120) {
    return {
      flag: 'CRITICAL',
      check: '1a',
      msg: `${envelope.material_name} akan melewati envelope hingga ${burnPct.toFixed(0)}%. Auto-hold dan perlu override prinsipal.`,
      extra: {
        flag: 'INFO',
        check: 'scope',
        msg: `${envelope.boq_item_count} item BoQ akan terkena alokasi bulk.`,
      },
    };
  }

  if (burnPct > 100) {
    return {
      flag: 'HIGH',
      check: '1a',
      msg: `${envelope.material_name} melampaui envelope: ${burnPct.toFixed(0)}% (${fmtEnvPairDisplay(newTotal, Number(envelope.total_planned ?? 0), envelope.unit, display)}).`,
      extra: {
        flag: 'INFO',
        check: 'scope',
        msg: `${envelope.boq_item_count} item BoQ akan dihitung proporsional.`,
      },
    };
  }

  if (burnPct > 80) {
    return {
      flag: 'WARNING',
      check: '1a',
      msg: `${envelope.material_name} mendekati batas envelope: ${burnPct.toFixed(0)}%.`,
      extra: {
        flag: 'INFO',
        check: 'scope',
        msg: `${envelope.boq_item_count} item BoQ akan menerima alokasi bulk.`,
      },
    };
  }

  return {
    flag: 'OK',
    check: '1a',
    msg: `${envelope.material_name} masih aman di ${burnPct.toFixed(0)}% envelope.`,
    extra: {
      flag: 'INFO',
      check: 'scope',
      msg: `${envelope.boq_item_count} item BoQ akan dihitung proporsional.`,
    },
  };
}

function buildTier3Result(requestedQty: number, unit: string): GateResult {
  return {
    flag: 'OK',
    check: '1a',
    msg: `Tier 3 dicatat sebagai stok umum: ${roundQty(requestedQty)} ${unit || 'unit'}.`,
  };
}

/** Tier 3 (Rupiah budget) and Tier 4 (untracked consumable) both post as a
 * single general-stock allocation — no BoQ item to deduct against. */
function buildGeneralStockAllocation(requestedQty: number): AllocationPreview[] {
  return [{
    boqItemId: null,
    boqCode: 'STOK',
    boqLabel: 'Stok Umum',
    allocatedQuantity: roundQty(requestedQty),
    proportionPct: 100,
    allocationBasis: 'GENERAL_STOCK' as const,
  }];
}

function describeAllocation(line: RequestLine, allocationCount: number) {
  if (line.tier === 1) return 'BoQ spesifik';
  if (line.tier === 2) return `${allocationCount} item BoQ (bulk)`;
  return 'Stok umum';
}

export default function PermintaanScreen() {
  const { boqItems, project, profile, refresh } = useProject();
  const { show: toast } = useToast();

  const [targetDate, setTargetDate] = useState(getTodayIsoDate());
  const [urgency, setUrgency] = useState<string>('NORMAL');
  const [commonNote, setCommonNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lines, setLines] = useState<RequestLine[]>([makeLine()]);
  const [materialOptions, setMaterialOptions] = useState<MaterialOption[]>([]);
  const [materialSearch, setMaterialSearch] = useState('');
  const [materialPickerVisible, setMaterialPickerVisible] = useState(false);
  const [materialPickerLineId, setMaterialPickerLineId] = useState<string | null>(null);
  const [envelopeCache, setEnvelopeCache] = useState<Map<string, MaterialEnvelopeStatus>>(new Map());
  const [breakdownCache, setBreakdownCache] = useState<Map<string, EnvelopeBoqBreakdown[]>>(new Map());
  const [workGroupEnvCache, setWorkGroupEnvCache] = useState<Map<string, MaterialEnvelopeStatus | null>>(new Map());

  // Work-groups: the bulk unit a supervisor orders against (Tier 1 target).
  const workGroups = useMemo<WorkGroup[]>(() => buildWorkGroups(boqItems), [boqItems]);
  const workGroupMap = useMemo(() => new Map(workGroups.map(g => [g.key, g])), [workGroups]);

  useEffect(() => {
    if (!project) return;
    supabase
      .from('material_catalog')
      .select('id, name, unit, supplier_unit, tier, code, category, base_qty_per_supplier_unit')
      .order('name')
      .then(({ data, error }) => {
        if (error) {
          console.warn('Material catalog load failed:', error.message);
          return;
        }
        const nextOptions = ((data ?? []) as MaterialOption[])
          .filter(item => !!item.name)
          .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
        setMaterialOptions(nextOptions);
      });
  }, [project]);

  const filteredMaterialOptions = useMemo(() => {
    const query = materialSearch.trim().toLowerCase();
    if (!query) return materialOptions;
    return materialOptions.filter(option =>
      option.name.toLowerCase().includes(query)
      || (option.code ?? '').toLowerCase().includes(query)
      || (option.category ?? '').toLowerCase().includes(query),
    );
  }, [materialOptions, materialSearch]);

  const cacheTier2Context = useCallback(async (materialIds: string[]) => {
    if (!project) return;
    const uniqueIds = Array.from(new Set(materialIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const missingEnvelopeIds = uniqueIds.filter(id => !envelopeCache.has(id));
    if (missingEnvelopeIds.length > 0) {
      const { data } = await supabase
        .from('v_material_envelope_status')
        .select('*')
        .eq('project_id', project.id)
        .in('material_id', missingEnvelopeIds);

      if (data) {
        setEnvelopeCache(prev => {
          const next = new Map(prev);
          for (const env of data) next.set(env.material_id, env as MaterialEnvelopeStatus);
          return next;
        });
      }
    }

    const missingBreakdownIds = uniqueIds.filter(id => !breakdownCache.has(id));
    if (missingBreakdownIds.length > 0) {
      const breakdownResponses = await Promise.all(
        missingBreakdownIds.map(async materialId => {
          const { data } = await supabase.rpc('get_envelope_boq_breakdown', {
            p_project_id: project.id,
            p_material_id: materialId,
          });
          return [materialId, (data ?? []) as EnvelopeBoqBreakdown[]] as const;
        }),
      );

      setBreakdownCache(prev => {
        const next = new Map(prev);
        for (const [materialId, rows] of breakdownResponses) next.set(materialId, rows);
        return next;
      });
    }
  }, [project, envelopeCache, breakdownCache]);

  // Warm the work-group envelope (planned vs ordered for the material across the
  // group's rows) + the project-wide breakdown (for proportional allocation).
  const cacheWorkGroupEnvelope = useCallback(async (workGroupKey: string, materialId: string) => {
    if (!project) return;
    const key = `${workGroupKey}::${materialId}`;
    if (workGroupEnvCache.has(key)) return;
    const group = workGroupMap.get(workGroupKey);
    if (!group) return;
    const env = await getWorkGroupEnvelope(project.id, materialId, group.itemIds);
    setWorkGroupEnvCache(prev => {
      const next = new Map(prev);
      next.set(key, env);
      return next;
    });
  }, [project, workGroupMap, workGroupEnvCache]);

  // Warm work-group envelope + breakdown for Tier-1 lines once both a group and
  // a catalog material are chosen. Without a materialId there is no baseline to
  // validate the bulk order against (the gate then returns a soft INFO).
  useEffect(() => {
    for (const line of lines) {
      if (line.tier === 1 && line.workGroupKey && line.materialId) {
        void cacheWorkGroupEnvelope(line.workGroupKey, line.materialId);
        void cacheTier2Context([line.materialId]);
      }
    }
  }, [lines, cacheWorkGroupEnvelope, cacheTier2Context]);

  const updateLine = (id: string, patch: Partial<RequestLine>) => {
    setLines(prev => prev.map(line => (
      line.id === id
        ? {
            ...line,
            ...patch,
            allocationPreview: patch.allocationPreview ?? line.allocationPreview,
          }
        : line
    )));
  };

  const addCatalogLine = () => {
    setLines(prev => [...prev, makeLine({ isCustom: false })]);
  };

  const addCustomLine = () => {
    setLines(prev => [...prev, makeLine({ isCustom: true, tier: 3 })]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 1) return;
    setLines(prev => prev.filter(line => line.id !== id));
  };

  const openMaterialPicker = (lineId: string) => {
    setMaterialPickerLineId(lineId);
    setMaterialSearch('');
    setMaterialPickerVisible(true);
  };

  const applyMaterialSelection = async (material: MaterialOption) => {
    if (!materialPickerLineId) return;

    updateLine(materialPickerLineId, applyCatalogMaterialToLine(material));

    if (material.tier === 2) {
      await cacheTier2Context([material.id]);
    }

    setMaterialPickerVisible(false);
    setMaterialSearch('');
    setMaterialPickerLineId(null);
  };

  const linesWithResults = useMemo<RequestLine[]>(() => {
    return lines.map(line => {
      const requestedQty = parseFloat(line.quantity);
      if (isNaN(requestedQty) || requestedQty <= 0) {
        return { ...line, lineResult: null, allocationPreview: [] };
      }

      // The supervisor types SUPPLIER units (batang for rebar). Every gate,
      // envelope and allocation below is BASE-unit (kg) math — convert once
      // here so the kg formulas stay byte-for-byte unchanged.
      const requestedBaseQty = supplierToBase(requestedQty, line.base_qty_per_supplier_unit);
      // Show the envelope check in batang (front-facing) while it computes in kg.
      const envDisplay: EnvelopeUnitDisplay | null = line.base_qty_per_supplier_unit
        ? { factor: line.base_qty_per_supplier_unit, supplierUnit: line.unit }
        : null;

      if (line.tier === 1) {
        if (!line.workGroupKey) {
          const lineResult: GateResult = {
            flag: 'WARNING',
            check: '1a',
            msg: 'Material Tier 1 harus memilih grup pekerjaan tujuan.',
          };
          return { ...line, lineResult, allocationPreview: [] };
        }

        const group = workGroupMap.get(line.workGroupKey);
        if (!group) {
          const lineResult: GateResult = {
            flag: 'WARNING',
            check: '1a',
            msg: 'Grup pekerjaan tujuan tidak ditemukan. Pilih ulang grup.',
          };
          return { ...line, lineResult, allocationPreview: [] };
        }

        const envelope = line.materialId
          ? workGroupEnvCache.get(`${line.workGroupKey}::${line.materialId}`) ?? null
          : null;
        const breakdown = line.materialId ? breakdownCache.get(line.materialId) ?? [] : [];

        return {
          ...line,
          lineResult: computeWorkGroupGate1Flag(envelope, requestedBaseQty, group.label, envDisplay),
          allocationPreview: buildWorkGroupAllocations(breakdown, group.itemIds, requestedBaseQty),
        };
      }

      if (line.tier === 2) {
        if (!line.materialId) {
          const lineResult: GateResult = {
            flag: 'WARNING',
            check: '1a',
            msg: 'Tier 2 bulk harus memilih material dari katalog agar envelope bisa dihitung.',
          };
          return {
            ...line,
            lineResult,
            allocationPreview: [],
          };
        }

        const envelope = envelopeCache.get(line.materialId) ?? null;
        return {
          ...line,
          lineResult: buildTier2Result(envelope, requestedBaseQty, envDisplay),
          allocationPreview: buildTier2Allocations(breakdownCache.get(line.materialId) ?? [], requestedBaseQty),
        };
      }

      if (line.tier === 4) {
        // Untracked consumable — never gated (mirrors tools/budgetGate.ts
        // evaluateTier4Untracked / the server's dispatch_line_flag tier=4 branch).
        return {
          ...line,
          lineResult: evaluateTier4Untracked(),
          allocationPreview: buildGeneralStockAllocation(requestedBaseQty),
        };
      }

      return {
        ...line,
        lineResult: buildTier3Result(requestedBaseQty, line.baseUnit || line.unit),
        allocationPreview: buildGeneralStockAllocation(requestedBaseQty),
      };
    });
  }, [lines, workGroupMap, envelopeCache, breakdownCache, workGroupEnvCache]);

  const overallFlag = useMemo<FlagLevel>(() => {
    let worst: FlagLevel = 'OK';
    for (const line of linesWithResults) {
      if (!line.lineResult) continue;
      const lineIndex = FLAG_ORDER.indexOf(line.lineResult.flag);
      if (lineIndex > FLAG_ORDER.indexOf(worst)) worst = line.lineResult.flag;
    }
    return worst;
  }, [linesWithResults]);

  const isAutoHold = overallFlag === 'CRITICAL';
  const hasValidLines = linesWithResults.some(line => isPositiveNumber(line.quantity));

  const statusLabel = isAutoHold
    ? 'Ditahan — Menunggu Override Prinsipal'
    : overallFlag === 'WARNING' || overallFlag === 'HIGH'
      ? 'Dalam Review'
      : 'Siap Dikirim';

  const shouldShowLines = lines.length > 0;

  const handleSubmit = async () => {
    if (!profile || !project) return;
    if (!targetDate) {
      toast('Pilih tanggal target pengiriman', 'critical');
      return;
    }
    if (!hasValidLines) {
      toast('Masukkan jumlah untuk minimal 1 material', 'critical');
      return;
    }
    if (isAutoHold) {
      toast('Permintaan ditahan — Prinsipal harus override', 'critical');
      return;
    }

    const validLines = linesWithResults.filter(line => isPositiveNumber(line.quantity));
    if (!validLines.length) return;

    for (const line of validLines) {
      if (!sanitizeText(line.materialName || '').trim()) {
        toast('Nama material belum lengkap', 'critical');
        return;
      }
      if (!sanitizeText(line.unit || '').trim()) {
        toast(`Satuan untuk ${line.materialName} belum diisi`, 'critical');
        return;
      }
      if (line.tier === 1 && !line.workGroupKey) {
        toast(`Tier 1 untuk ${line.materialName} wajib memilih grup pekerjaan`, 'critical');
        return;
      }
      if (line.tier === 1 && line.allocationPreview.length === 0) {
        toast(`Grup untuk ${line.materialName} belum punya baseline material — tidak bisa dialokasikan`, 'critical');
        return;
      }
      if (line.tier === 2 && !line.materialId) {
        toast(`Tier 2 untuk ${line.materialName} harus memilih material katalog`, 'critical');
        return;
      }
      if (line.tier === 2 && line.allocationPreview.length === 0) {
        toast(`Envelope ${line.materialName} belum punya breakdown baseline`, 'critical');
        return;
      }
    }

    setSubmitting(true);
    try {
      const { data: header, error: headerErr } = await supabase
        .from('material_request_headers')
        .insert({
          project_id: project.id,
          boq_item_id: null,
          request_basis: ACTIVE_REQUEST_BASIS,
          requested_by: profile.id,
          target_date: targetDate,
          urgency,
          common_note: commonNote ? sanitizeText(commonNote) : null,
          overall_flag: overallFlag,
          overall_status: isAutoHold ? 'AUTO_HOLD' : 'PENDING',
        })
        .select('id')
        .single();

      if (headerErr || !header) throw headerErr ?? new Error('Header insert failed');

      for (const line of validLines) {
        const { data: createdLine, error: lineErr } = await supabase
          .from('material_request_lines')
          .insert({
            request_header_id: header.id,
            material_id: line.materialId ?? null,
            custom_material_name: line.isCustom || !line.materialId ? sanitizeText(line.materialName) : null,
            tier: line.tier,
            material_spec_reference: line.specRef ? sanitizeText(line.specRef) : null,
            // BASE-unit canonical: triggers 048/049 compare quantity against
            // per-kg benchmarks/envelopes. Batang exists only in the UI.
            quantity: supplierToBase(parseFloat(line.quantity), line.base_qty_per_supplier_unit),
            unit: sanitizeText(line.base_qty_per_supplier_unit ? (line.baseUnit || line.unit) : line.unit),
            line_flag: line.lineResult?.flag ?? 'OK',
            line_check_details: line.lineResult,
            work_group_label: line.tier === 1 && line.workGroupKey
              ? workGroupMap.get(line.workGroupKey)?.label ?? null
              : null,
          })
          .select('id')
          .single();

        if (lineErr || !createdLine) throw lineErr ?? new Error('Line insert failed');

        const allocationRows = line.allocationPreview.map(preview => ({
          request_line_id: createdLine.id,
          boq_item_id: preview.boqItemId,
          allocated_quantity: preview.allocatedQuantity,
          proportion_pct: preview.proportionPct,
          allocation_basis: preview.allocationBasis,
        }));

        if (allocationRows.length > 0) {
          const { error: allocationErr } = await supabase
            .from('material_request_line_allocations')
            .insert(allocationRows);
          if (allocationErr) throw allocationErr;
        }
      }

      const materialSummary = validLines
        .map(line => {
          const kgNote = line.base_qty_per_supplier_unit
            ? ` (≈ ${supplierToBase(parseFloat(line.quantity), line.base_qty_per_supplier_unit).toFixed(1)} ${line.baseUnit || 'kg'})`
            : '';
          return `${line.materialName} ×${line.quantity} ${line.unit}${kgNote}`.trim();
        })
        .join(', ');

      await supabase.from('activity_log').insert({
        project_id: project.id,
        user_id: profile.id,
        type: 'permintaan',
        label: `Permintaan material: ${materialSummary}`,
        flag: overallFlag,
      });

      toast(
        `Permintaan material dikirim — ${validLines.length} line`,
        overallFlag === 'OK' ? 'ok' : 'warning',
      );

      setLines([makeLine()]);
      setCommonNote('');
      setUrgency('NORMAL');
      await refresh();
    } catch (err: any) {
      Alert.alert('Gagal mengirim', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHead}>Gate 1 — Permintaan Material</Text>
        <Text style={styles.fieldHint}>
          Pilih material dulu. Tier 1 wajib memilih satu item BoQ tujuan, Tier 2 otomatis dihitung sebagai bulk envelope, dan Tier 3 dicatat sebagai stok umum.
        </Text>

        {shouldShowLines && (
          <>
            <Text style={styles.sectionHead}>
              Material — {lines.length} item
            </Text>

            {linesWithResults.map((line, idx) => {
              const tierColor = TIER_COLORS[line.tier];
              const envelope = line.materialId ? envelopeCache.get(line.materialId) ?? null : null;
              // Bar tracks running request demand (permintaan berjalan) vs plan, so
              // it agrees with the Tier-2 gate result on the same card. The view's
              // own burn_pct is now PO-based (di-PO) and shown as its own figure.
              const plannedQty = Number(envelope?.total_planned ?? 0);
              const requestedQtyEnv = Number(envelope?.total_requested ?? 0);
              const orderedQtyEnv = Number(envelope?.total_ordered ?? 0);
              const burnPct = plannedQty > 0 ? (requestedQtyEnv / plannedQty) * 100 : 0;
              const barColor = burnPct > 100 ? COLORS.critical : burnPct > 80 ? COLORS.warning : COLORS.ok;

              return (
                <Card key={line.id}>
                  <View style={styles.lineHeader}>
                    <View style={[styles.tierPill, { backgroundColor: `${tierColor}18` }]}>
                      <Text style={[styles.tierText, { color: tierColor }]}>
                        {TIER_LABELS[line.tier]}
                      </Text>
                    </View>
                    <Text style={styles.lineNum}>#{idx + 1}</Text>
                    {lines.length > 1 && (
                      <TouchableOpacity
                        onPress={() => removeLine(line.id)}
                        style={styles.removeBtn}
                        accessibilityLabel={`Hapus material #${idx + 1}`}
                        accessibilityRole="button"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={20} color={COLORS.critical} />
                      </TouchableOpacity>
                    )}
                  </View>

                  <Text style={styles.fieldLabel}>
                    Material {line.isCustom ? '(manual)' : ''}
                  </Text>
                  {!line.isCustom ? (
                    <>
                      <TouchableOpacity
                        style={styles.selectorBtn}
                        onPress={() => openMaterialPicker(line.id)}
                        accessibilityLabel={`Pilih material untuk line ${idx + 1}`}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.selectorText, !line.materialId && styles.selectorPlaceholder]}>
                            {line.materialId
                              ? `${line.materialName} (${line.unit})`
                              : 'Cari material dari katalog'}
                          </Text>
                          <Text style={styles.selectorMeta}>
                            {line.materialId
                              ? `Tier ${line.tier} otomatis mengikuti master material.`
                              : 'Tier dan unit akan mengikuti katalog material.'}
                          </Text>
                        </View>
                        <Ionicons name="search-outline" size={16} color={COLORS.textSec} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => updateLine(line.id, { isCustom: true, materialId: null, materialName: '', tier: 3, unit: '', baseUnit: '', base_qty_per_supplier_unit: null, boqItemId: null })}>
                        <Text style={styles.linkText}>Tidak ada di katalog? Input manual</Text>
                      </TouchableOpacity>
                    </>
                  ) : line.isCustom ? (
                    <>
                      <TextInput
                        style={styles.input}
                        value={line.materialName}
                        onChangeText={value => updateLine(line.id, { materialName: value })}
                        placeholder="Nama material"
                        placeholderTextColor={COLORS.textMuted}
                      />
                      <MaterialNamingAssist
                        materialName={line.materialName}
                        materialId={line.materialId}
                        currentUnit={line.unit}
                        catalog={materialOptions}
                        projectId={project?.id}
                        projectName={project?.name}
                        projectCode={project?.code}
                        userId={profile?.id}
                        userRole={profile?.role}
                        onSelectCatalogMaterial={async (material) => {
                          updateLine(line.id, applyCatalogMaterialToLine(material));

                          if (material.tier === 2) {
                            await cacheTier2Context([material.id]);
                          }
                        }}
                        onApplyAiSuggestion={async (suggestion) => {
                          updateLine(line.id, {
                            materialName: suggestion.suggested_name,
                            unit: line.unit || suggestion.suggested_unit || '',
                          });
                        }}
                      />
                      <View style={styles.inlineTierRow}>
                        {[1, 2, 3].map(rawTier => {
                          const tier = rawTier as 1 | 2 | 3;
                          const isActive = line.tier === tier;
                          return (
                            <TouchableOpacity
                              key={tier}
                              style={[styles.inlineTierChip, isActive && styles.inlineTierChipActive]}
                              onPress={() => updateLine(line.id, { tier, boqItemId: tier === 1 ? line.boqItemId : null })}
                            >
                              <Text style={[styles.inlineTierText, isActive && styles.inlineTierTextActive]}>
                                Tier {tier}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <TouchableOpacity onPress={() => updateLine(line.id, { isCustom: false, tier: 3, materialName: '', unit: '', baseUnit: '', base_qty_per_supplier_unit: null, boqItemId: null })}>
                        <Text style={styles.linkText}>Gunakan katalog material</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TextInput
                      style={[styles.input, styles.inputDisabled]}
                      value={line.materialName}
                      editable={false}
                    />
                  )}

                  {line.tier === 1 && (
                    <>
                      <Text style={styles.fieldLabel}>
                        Grup Pekerjaan Tujuan <Text style={styles.req}>*</Text>
                      </Text>
                      <View style={styles.pickerWrap}>
                        <Picker
                          selectedValue={line.workGroupKey ?? ''}
                          onValueChange={value => updateLine(line.id, { workGroupKey: value || null })}
                          style={{ color: COLORS.text }}
                        >
                          <Picker.Item label="— Pilih grup pekerjaan —" value="" />
                          {workGroups.map(group => (
                            <Picker.Item
                              key={group.key}
                              label={`${group.label} (${group.itemCount} item)`}
                              value={group.key}
                            />
                          ))}
                        </Picker>
                      </View>
                      <Text style={styles.fieldHint}>
                        Permintaan Tier 1 dipesan untuk seluruh grup pekerjaan (mis. semua pondasi) dan dialokasikan ke tiap item BoQ di dalamnya.
                      </Text>
                    </>
                  )}

                  <View style={styles.row2}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>
                        Jumlah <Text style={styles.req}>*</Text>
                      </Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="numeric"
                        value={line.quantity}
                        onChangeText={value => updateLine(line.id, { quantity: value })}
                        placeholder="0"
                        placeholderTextColor={COLORS.textMuted}
                      />
                      {line.base_qty_per_supplier_unit != null && isPositiveNumber(line.quantity) && (
                        <Text style={styles.fieldHint}>
                          ≈ {supplierToBase(parseFloat(line.quantity), line.base_qty_per_supplier_unit).toFixed(1)} {line.baseUnit || 'kg'} · 1 {line.unit || 'batang'} = {line.base_qty_per_supplier_unit} {line.baseUnit || 'kg'}
                        </Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Satuan</Text>
                      <TextInput
                        style={[styles.input, !line.isCustom && styles.inputDisabled]}
                        value={line.unit}
                        onChangeText={value => updateLine(line.id, { unit: value })}
                        placeholder="pcs / m2 / kg"
                        editable={line.isCustom}
                        placeholderTextColor={COLORS.textMuted}
                      />
                    </View>
                  </View>

                  <Text style={styles.fieldLabel}>Referensi Spec</Text>
                  <TextInput
                    style={styles.input}
                    value={line.specRef}
                    onChangeText={value => updateLine(line.id, { specRef: value })}
                    placeholder="Opsional"
                    placeholderTextColor={COLORS.textMuted}
                  />

                  {line.tier === 2 && line.materialId && envelope && (
                    <View style={styles.envelopeBox}>
                      <Text style={styles.envelopeTitle}>
                        Envelope — {envelope.boq_item_count} item BoQ
                      </Text>
                      <View style={styles.envelopeBar}>
                        <View style={[styles.envelopeBarFill, { width: `${Math.min(burnPct, 100)}%`, backgroundColor: barColor }]} />
                      </View>
                      <View style={styles.row2}>
                        <Text style={styles.envelopeStat}>
                          Permintaan berjalan: {Math.round(requestedQtyEnv).toLocaleString('id-ID')} {envelope.unit}
                          {line.base_qty_per_supplier_unit != null &&
                            ` (≈ ${(requestedQtyEnv / line.base_qty_per_supplier_unit).toFixed(1)} ${line.unit})`}
                        </Text>
                        <Text style={styles.envelopeStat}>
                          Rencana: {Math.round(plannedQty).toLocaleString('id-ID')} {envelope.unit}
                          {line.base_qty_per_supplier_unit != null &&
                            ` (≈ ${(plannedQty / line.base_qty_per_supplier_unit).toFixed(1)} ${line.unit})`}
                        </Text>
                      </View>
                      <Text style={styles.envelopeStat}>
                        Sudah di-PO: {Math.round(orderedQtyEnv).toLocaleString('id-ID')} {envelope.unit}
                        {line.base_qty_per_supplier_unit != null &&
                          ` (≈ ${(orderedQtyEnv / line.base_qty_per_supplier_unit).toFixed(1)} ${line.unit})`}
                      </Text>
                      <Text style={[styles.envelopePct, { color: barColor }]}>
                        {burnPct.toFixed(0)}% dari rencana (permintaan)
                      </Text>
                    </View>
                  )}

                  {line.allocationPreview.length > 0 && (
                    <View style={styles.allocationBox}>
                      <Text style={styles.allocationTitle}>
                        {line.tier === 2 ? 'Alokasi Otomatis' : line.tier === 1 ? 'BoQ Terkunci' : 'Alokasi Stok'}
                      </Text>
                      {line.allocationPreview.slice(0, 3).map(preview => (
                        <View key={`${line.id}-${preview.boqItemId ?? preview.boqCode}-${preview.allocationBasis}`} style={styles.allocationRow}>
                          <Text style={styles.allocationLabel}>
                            {preview.boqCode === 'STOK'
                              ? preview.boqLabel
                              : `${preview.boqCode} — ${preview.boqLabel}`}
                          </Text>
                          <Text style={styles.allocationQty}>
                            {/* Allocations are BASE-unit (kg) values — label them so. */}
                            {roundQty(preview.allocatedQuantity).toLocaleString('id-ID')} {line.baseUnit || line.unit}
                          </Text>
                        </View>
                      ))}
                      {line.allocationPreview.length > 3 && (
                        <Text style={styles.fieldHint}>+{line.allocationPreview.length - 3} item BoQ lain mengikuti proporsi baseline.</Text>
                      )}
                    </View>
                  )}

                  {line.tier === 3 && (
                    <Text style={styles.fieldHint}>
                      Tier 3 tidak mengurangi satu BoQ spesifik. Material dicatat sebagai stok umum.
                    </Text>
                  )}

                  {line.tier === 4 && (
                    <Text style={styles.fieldHint}>
                      Tier 4 consumable — tidak dilacak anggaran, dicatat sebagai stok umum.
                    </Text>
                  )}

                  {line.lineResult && (
                    <FlagPanel result={line.lineResult} gateLabel="Gate 1" />
                  )}
                </Card>
              );
            })}

            <View style={styles.addActionRow}>
              <TouchableOpacity
                style={styles.addLineBtn}
                onPress={addCatalogLine}
                accessibilityRole="button"
              >
                <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
                <Text style={styles.addLineText}>
                  Tambah Material Katalog
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addSecondaryBtn}
                onPress={addCustomLine}
                accessibilityRole="button"
              >
                <Text style={styles.addSecondaryText}>Tambah Manual</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {hasValidLines && (
          <Card title="Detail Permintaan">
            <Text style={styles.fieldLabel}>
              Target Pengiriman <Text style={styles.req}>*</Text>
            </Text>
            <DateSelectField
              value={targetDate}
              onChange={setTargetDate}
              placeholder="Pilih tanggal target"
              accessibilityLabel="Tanggal target pengiriman"
              helperText="Pilih tanggal target pengiriman dari dropdown."
            />

            <Text style={[styles.fieldLabel, { marginTop: SPACE.md }]}>Urgensi</Text>
            <View style={styles.urgencyRow} accessibilityRole="radiogroup">
              {URGENCY_OPTIONS.map(option => {
                const isSelected = urgency === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.urgencyChip,
                      isSelected
                        ? { backgroundColor: option.color, borderColor: option.color }
                        : { backgroundColor: COLORS.surfaceAlt, borderColor: COLORS.border },
                    ]}
                    onPress={() => setUrgency(option.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                  >
                    <Text style={[
                      styles.urgencyText,
                      { color: isSelected ? COLORS.textInverse : COLORS.textSec },
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { marginTop: SPACE.md }]}>Catatan</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={commonNote}
              onChangeText={setCommonNote}
              multiline
              placeholder="Catatan untuk seluruh permintaan ini..."
              placeholderTextColor={COLORS.textMuted}
            />

            <View style={[
              styles.statusBox,
              { backgroundColor: isAutoHold ? COLORS.criticalBg : COLORS.okBg },
            ]}>
              <Text style={[styles.statusLabel, { color: isAutoHold ? COLORS.critical : COLORS.ok }]}>
                {statusLabel}
              </Text>
              <Text style={styles.statusSub}>
                {linesWithResults.filter(line => isPositiveNumber(line.quantity)).length} material dipilih
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, (isAutoHold || submitting) && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting || isAutoHold}
              accessibilityLabel={isAutoHold ? 'Permintaan ditahan, tidak dapat dikirim' : 'Ajukan permintaan material'}
              accessibilityRole="button"
              accessibilityState={{ disabled: isAutoHold || submitting, busy: submitting }}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={COLORS.textInverse} />
              ) : (
                <Text style={styles.submitBtnText}>
                  {isAutoHold ? 'Ditahan — Override Diperlukan' : 'Ajukan Permintaan'}
                </Text>
              )}
            </TouchableOpacity>
          </Card>
        )}
      </ScrollView>

      <Modal
        visible={materialPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setMaterialPickerVisible(false);
          setMaterialPickerLineId(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => {
              setMaterialPickerVisible(false);
              setMaterialPickerLineId(null);
            }}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Pilih Material</Text>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={16} color={COLORS.textSec} />
              <TextInput
                style={styles.searchInput}
                value={materialSearch}
                onChangeText={setMaterialSearch}
                placeholder="Cari kode, nama, atau kategori..."
                placeholderTextColor={COLORS.textSec}
              />
            </View>

            <FlatList
              data={filteredMaterialOptions}
              keyExtractor={item => item.id}
              keyboardShouldPersistTaps="handled"
              style={styles.optionList}
              ListEmptyComponent={<Text style={styles.modalEmpty}>Tidak ada material yang cocok.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => { void applyMaterialSelection(item); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{item.name}</Text>
                    <Text style={styles.optionMeta}>
                      {item.code ? `${item.code} · ` : ''}
                      {TIER_LABELS[item.tier]} · {item.supplier_unit || item.unit}
                      {item.category ? ` · ${item.category}` : ''}
                    </Text>
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

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },

  sectionHead: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: COLORS.textSec,
    marginBottom: SPACE.sm,
    marginTop: SPACE.base,
  },

  fieldLabel: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
    marginBottom: SPACE.xs,
    marginTop: SPACE.md,
  },
  req: { color: COLORS.critical },

  fieldHint: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginTop: SPACE.xs,
    lineHeight: 17,
  },

  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingVertical: SPACE.md - 1,
    paddingHorizontal: SPACE.md,
    fontSize: TYPE.md,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  inputDisabled: {
    backgroundColor: COLORS.surfaceAlt,
    color: COLORS.textSec,
  },
  textarea: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: SPACE.md - 1,
  },

  pickerWrap: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    backgroundColor: COLORS.surface,
  },

  row2: { flexDirection: 'row', gap: SPACE.sm },

  lineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    marginBottom: SPACE.xs,
    flexWrap: 'wrap',
  },
  lineNum: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    color: COLORS.textSec,
  },
  tierPill: {
    paddingHorizontal: SPACE.sm,
    paddingVertical: 3,
    borderRadius: RADIUS_SM,
    flexShrink: 1,
  },
  tierText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    letterSpacing: 0.3,
  },
  removeBtn: { marginLeft: 'auto' },

  selectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingVertical: SPACE.md - 1,
    paddingHorizontal: SPACE.md,
  },
  selectorText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
  },
  selectorPlaceholder: {
    color: COLORS.textSec,
  },
  selectorMeta: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginTop: 3,
  },
  linkText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.primary,
    marginTop: SPACE.xs,
  },

  inlineTierRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
    marginTop: SPACE.sm,
  },
  inlineTierChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingVertical: SPACE.xs + 4,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  inlineTierChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surfaceAlt,
  },
  inlineTierText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.textSec,
  },
  inlineTierTextActive: {
    color: COLORS.primary,
  },

  addActionRow: {
    gap: SPACE.sm,
    marginBottom: SPACE.sm,
  },
  addLineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    paddingVertical: SPACE.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    borderStyle: 'dashed',
  },
  addLineText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: COLORS.primary,
  },
  addSecondaryBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingVertical: SPACE.sm + 2,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  addSecondaryText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.textSec,
  },

  urgencyRow: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.xs },
  urgencyChip: {
    flex: 1,
    paddingVertical: SPACE.sm + 1,
    borderWidth: 1.5,
    borderRadius: RADIUS,
    alignItems: 'center',
  },
  urgencyText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  statusBox: {
    padding: SPACE.md,
    borderRadius: RADIUS,
    marginTop: SPACE.base,
    gap: 3,
  },
  statusLabel: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    letterSpacing: 0.3,
  },
  statusSub: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
  },

  envelopeBox: {
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS,
    padding: SPACE.md,
    marginTop: SPACE.sm,
    gap: SPACE.xs,
  },
  envelopeTitle: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.textSec,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginBottom: SPACE.xs,
  },
  envelopeBar: {
    height: 8,
    backgroundColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  envelopeBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  envelopeStat: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    flex: 1,
  },
  envelopePct: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
  },

  allocationBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: SPACE.md,
    marginTop: SPACE.sm,
    gap: SPACE.xs,
  },
  allocationTitle: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: COLORS.textSec,
  },
  allocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
  },
  allocationLabel: {
    flex: 1,
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  allocationQty: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.textSec,
  },

  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS,
    paddingVertical: SPACE.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: SPACE.base,
  },
  submitBtnDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  submitBtnText: {
    color: COLORS.textInverse,
    fontSize: TYPE.base,
    fontFamily: FONTS.semibold,
    letterSpacing: 0.3,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,18,16,0.38)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '82%',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS + 8,
    borderTopRightRadius: RADIUS + 8,
    paddingHorizontal: SPACE.base,
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.xxxl,
  },
  modalHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: SPACE.md,
  },
  modalTitle: {
    fontSize: TYPE.base,
    fontFamily: FONTS.bold,
    color: COLORS.text,
    marginBottom: SPACE.sm,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm + 1,
    marginBottom: SPACE.md,
  },
  searchInput: {
    flex: 1,
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.text,
    paddingVertical: 0,
  },
  optionList: {
    maxHeight: 420,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingVertical: SPACE.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  optionTitle: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
  },
  optionMeta: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginTop: 2,
  },
  modalEmpty: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    textAlign: 'center',
    paddingVertical: SPACE.lg,
  },
});
