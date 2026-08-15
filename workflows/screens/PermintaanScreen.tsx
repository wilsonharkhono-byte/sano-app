import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import FlagPanel from '../components/FlagPanel';
import DateSelectField, { getTodayIsoDate } from '../components/DateSelectField';
import MaterialNamingAssist from '../components/MaterialNamingAssist';
import SelectSheet, { type SelectOption } from '../components/SelectSheet';
import OverageReasonPicker from '../components/OverageReasonPicker';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { computeWorkGroupGate1Flag, buildProjectEnvelopeOverageResult, type EnvelopeUnitDisplay } from '../gates/gate1';
import { sanitizeText, isPositiveNumber } from '../../tools/validation';
import { supplierToBase } from '../../tools/materialUnitConversion';
import { applyCatalogMaterialToLine } from '../../tools/materialSelection';
import { supabase } from '../../tools/supabase';
import { auditRequestSubmitIfCritical } from '../../tools/audit';
import {
  getWorkGroupEnvelope, getMaterialBudget, getMaterialDrift,
  getWorkGroupMaterialEnvelopes, type WorkGroupMaterialEnvelope,
} from '../../tools/envelopes';
import {
  buildWorkGroupDemand, formatSisaLabel,
  type DemandRow, type DemandCatalogMaterial,
} from '../../tools/workGroupDemand';
import {
  isRebarCode, buildRebarCells, groupsWithRebarDemand, groupRebarSisaBatang,
  buildMatrixRows, splitBasisFor, defaultSplit, expandRebarMatrix,
  type RebarMaterial, type RebarGroupEnvelope, type RebarMatrixRow,
} from '../../tools/rebarMatrix';
import { evaluateTier4Untracked, evaluateTier3BudgetSoft } from '../../tools/budgetGate';
import { requiresOverageReason, requiresOverageNote } from '../../tools/requestOverage';
import { shouldShowDriftBadge, formatDriftBadge, type MaterialDrift } from '../../tools/planDrift';
import {
  buildSubmitMaterialRequestPayload, type SubmitRequestLineInput,
} from '../../tools/submitMaterialRequest';
import { resolveTier2Allocations } from '../../tools/tier2Allocation';
import { buildWorkGroups } from '../../tools/boqWorkGroups';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, RADIUS_SM } from '../theme';
import type {
  GateResult,
  FlagLevel,
  MaterialEnvelopeStatus,
  MaterialBudgetStatus,
  EnvelopeBoqBreakdown,
  MaterialRequestAllocationBasis,
  OverageReason,
  WorkGroup,
} from '../../tools/types';

type RequestBasis = 'BOQ' | 'MATERIAL';

const ACTIVE_REQUEST_BASIS: RequestBasis = 'MATERIAL';

/** The three entry paths plus their landing (design spec §1). */
type PermintaanMode = 'landing' | 'pekerjaan' | 'besi' | 'umum';

const MODE_TILES: Array<{
  key: Exclude<PermintaanMode, 'landing'>;
  /** Ionicons glyph name — typed off the component so a typo fails to compile. */
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  desc: string;
}> = [
  {
    key: 'pekerjaan',
    icon: 'construct-outline',
    title: 'Permintaan Pekerjaan (BoQ)',
    desc: 'Pilih grup pekerjaan dulu, lalu isi jumlah dari daftar kebutuhan materialnya.',
  },
  {
    key: 'besi',
    icon: 'git-commit-outline',
    title: 'Pesan Besi Beton',
    desc: 'Pesan besi per diameter dalam batang untuk beberapa grup pekerjaan sekaligus.',
  },
  {
    key: 'umum',
    icon: 'cube-outline',
    title: 'Material Umum / Lainnya',
    desc: 'Cari material bebas dari katalog atau tulis manual.',
  },
];

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
  /** Signal-1 reason capture (spec §3) — required before submit when the line's
   *  projected cumulative crosses 100% of plan. */
  overageReason: OverageReason | null;
  overageNote: string;
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
  4: COLORS.textSec,
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
    overageReason: null,
    overageNote: '',
    ...overrides,
  };
}

function roundQty(value: number) {
  return Math.round(value * 100) / 100;
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

/**
 * Tier-2 soft heads-up (Task 2.4). Delegates to the shared project-grain overage
 * builder: projected = di-PO (total_ordered) + permintaan berjalan
 * (total_requested) + permintaan ini, capped at WARNING with running-total copy.
 * No envelope → "Tidak ada alokasi pembanding" (INFO), never a silent OK.
 * SERVER TWIN: migration 069 compute_tier2_flag.
 */
function buildTier2Result(
  envelope: MaterialEnvelopeStatus | null,
  requestedQty: number,
  display?: EnvelopeUnitDisplay | null,
): GateResult {
  return buildProjectEnvelopeOverageResult(envelope, requestedQty, display);
}

/**
 * Tier-3 soft heads-up (Task 2.4). Replaces the old unconditional-OK stub with
 * the real Rupiah budget evaluation, capped at WARNING for the request-time
 * context (evaluateTier3BudgetSoft). A catalog-unlinked / free-text line has no
 * budget baseline → "Tidak ada alokasi pembanding" (INFO), never OK.
 * SERVER TWIN: migration 069 compute_tier3_flag.
 */
function buildTier3Result(
  budget: MaterialBudgetStatus | null,
  requestedQty: number,
  hasMaterial: boolean,
): GateResult {
  if (!hasMaterial) {
    return {
      flag: 'INFO',
      check: '1a',
      msg: 'Tidak ada alokasi pembanding — material bebas-teks tidak terhubung ke katalog. Estimator review manual.',
    };
  }
  return evaluateTier3BudgetSoft(budget, requestedQty);
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
  const [mode, setMode] = useState<PermintaanMode>('landing');
  const [lines, setLines] = useState<RequestLine[]>([makeLine()]);
  const [materialOptions, setMaterialOptions] = useState<MaterialOption[]>([]);
  const [materialSearch, setMaterialSearch] = useState('');
  const [materialPickerVisible, setMaterialPickerVisible] = useState(false);
  const [materialPickerLineId, setMaterialPickerLineId] = useState<string | null>(null);
  const [envelopeCache, setEnvelopeCache] = useState<Map<string, MaterialEnvelopeStatus>>(new Map());
  const [breakdownCache, setBreakdownCache] = useState<Map<string, EnvelopeBoqBreakdown[]>>(new Map());
  const [workGroupEnvCache, setWorkGroupEnvCache] = useState<Map<string, MaterialEnvelopeStatus | null>>(new Map());
  // Tier-3 Rupiah budget envelope per material (null = fetched, no baseline).
  const [budgetCache, setBudgetCache] = useState<Map<string, MaterialBudgetStatus | null>>(new Map());
  // Signal-2 plan drift (Task 2.13) — one project-wide fetch (getMaterialDrift
  // already returns every material with a baseline snapshot in one round trip,
  // so there is no per-line lazy-load like the other caches above).
  const [driftCache, setDriftCache] = useState<Map<string, MaterialDrift>>(new Map());
  // Path 1 / Mode Besi: all-materials envelope per work group (migration 086).
  const [groupEnvCache, setGroupEnvCache] = useState<Map<string, WorkGroupMaterialEnvelope[]>>(new Map());
  const [groupEnvLoading, setGroupEnvLoading] = useState(false);
  const [groupEnvError, setGroupEnvError] = useState<string | null>(null);
  const [pekerjaanGroupKey, setPekerjaanGroupKey] = useState<string | null>(null);
  const [showTier2Section, setShowTier2Section] = useState(false);
  // Mode Besi (spec §3): scope screen → matrix screen, with each diameter's
  // per-group split rendered inline under the total it divides.
  const [besiStep, setBesiStep] = useState<'scope' | 'matrix'>('scope');
  const [besiScope, setBesiScope] = useState<Set<string>>(new Set());
  /** Groups the default-scope seed has already offered. Never a boolean latch:
   *  the envelope cache can be PARTIALLY warm on entry (Path 1 leaves its group
   *  cached), so a one-shot seed would default-select only the groups that
   *  happened to be loaded on the first commit and silently under-order. */
  const [besiSeededKeys, setBesiSeededKeys] = useState<Set<string>>(new Set());
  const [besiShowOther, setBesiShowOther] = useState(false);
  /** materialId → total batang typed by the supervisor. */
  const [besiTotal, setBesiTotal] = useState<Record<string, string>>({});
  /** materialId → groupKey → batang. The single source the lines derive from. */
  const [besiSplit, setBesiSplit] = useState<Record<string, Record<string, string>>>({});
  /** materialId → one reason applied to every over-alokasi line of that diameter. */
  const [besiReason, setBesiReason] = useState<Record<string, { reason: OverageReason | null; note: string }>>({});

  // Work-groups: the bulk unit a supervisor orders against (Tier 1 target).
  const workGroups = useMemo<WorkGroup[]>(() => buildWorkGroups(boqItems), [boqItems]);
  const workGroupMap = useMemo(() => new Map(workGroups.map(g => [g.key, g])), [workGroups]);

  const workGroupOptions = useMemo<SelectOption[]>(() => workGroups.map(group => ({
    value: group.key,
    label: group.label,
    meta: `${group.itemCount} item`,
  })), [workGroups]);

  useEffect(() => {
    if (!project) return;
    supabase
      .from('material_catalog')
      .select('id, name, unit, supplier_unit, tier, code, category, base_qty_per_supplier_unit')
      // Company-owned equipment (scaffolding parts) is deployed via the
      // equipment pool, not requested/purchased as a consumable.
      .eq('is_asset', false)
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

  // Signal-2 plan drift (spec §4) — supervisor sees the badge as context only,
  // no Rp. One project-wide fetch; re-runs when the active project changes.
  useEffect(() => {
    if (!project) return;
    getMaterialDrift(project.id).then((rows) => {
      setDriftCache(new Map(rows.map(row => [row.material_id, row])));
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

  // Warm the Tier-3 Rupiah budget envelope for a catalog material (soft gate).
  const cacheMaterialBudget = useCallback(async (materialId: string) => {
    if (!project) return;
    if (budgetCache.has(materialId)) return;
    const budget = await getMaterialBudget(project.id, materialId);
    setBudgetCache(prev => {
      const next = new Map(prev);
      next.set(materialId, budget);
      return next;
    });
  }, [project, budgetCache]);

  /**
   * Warm the all-materials envelope for one or more work groups. A failure is
   * NON-blocking (spec §7): the rows stay unloaded, an INFO banner offers a
   * retry, and the rest of the screen keeps working.
   */
  const loadGroupEnvelopes = useCallback(async (groupKeys: string[]) => {
    if (!project) return;
    const missing = groupKeys.filter(key => !groupEnvCache.has(key) && workGroupMap.has(key));
    if (missing.length === 0) return;

    setGroupEnvLoading(true);
    try {
      const results = await Promise.all(missing.map(async key => {
        const group = workGroupMap.get(key)!;
        const { rows, error } = await getWorkGroupMaterialEnvelopes(project.id, group.itemIds);
        return { key, rows, error };
      }));

      setGroupEnvCache(prev => {
        // Identity must stay stable when NOTHING loaded: this cache is a dep of
        // loadGroupEnvelopes, which is a dep of the Path-1 effect. Handing back a
        // fresh empty Map on a failed fetch would re-arm the effect and re-fetch
        // forever instead of parking on the retry banner.
        const loaded = results.filter(result => !result.error);
        if (loaded.length === 0) return prev;
        const next = new Map(prev);
        for (const result of loaded) next.set(result.key, result.rows);
        return next;
      });
      setGroupEnvError(results.find(r => r.error)?.error ?? null);
    } catch (err: any) {
      // getWorkGroupMaterialEnvelopes resolves {rows, error} rather than
      // throwing, so this is the defensive path (transport blew up). Surface it
      // through the same non-blocking retry banner instead of swallowing it.
      setGroupEnvError(err?.message ?? 'Gagal memuat kebutuhan material');
    } finally {
      // Never leave the spinner armed: a stuck groupEnvLoading renders a
      // permanent ActivityIndicator with no rows and no banner — the dead
      // screen spec §7 forbids.
      setGroupEnvLoading(false);
    }
  }, [project, workGroupMap, groupEnvCache]);

  // Path 1: load the chosen group's demand as soon as it is picked.
  useEffect(() => {
    if (mode !== 'pekerjaan' || !pekerjaanGroupKey) return;
    void loadGroupEnvelopes([pekerjaanGroupKey]);
  }, [mode, pekerjaanGroupKey, loadGroupEnvelopes]);

  const pekerjaanDemand = useMemo(() => {
    if (!pekerjaanGroupKey) return null;
    const rows = groupEnvCache.get(pekerjaanGroupKey);
    if (!rows) return null;
    return buildWorkGroupDemand(rows, materialOptions);
  }, [pekerjaanGroupKey, groupEnvCache, materialOptions]);

  /** Deterministic line id per (group, material) so re-renders never churn keys. */
  const demandLineId = (groupKey: string, materialId: string) => `demand:${groupKey}:${materialId}`;

  /** Mode Besi's equivalent: one id per (diameter, group). Deterministic for the
   *  same reason — the derive effect rebuilds every line on each keystroke, and
   *  a churning id would remount inputs and re-arm every cache lookup. */
  const besiLinePrefix = (materialId: string) => `besi:${materialId}:`;
  const besiLineId = (materialId: string, groupKey: string) => `${besiLinePrefix(materialId)}${groupKey}`;

  /** Rows inside the "Material terkait (Tier 2+)" disclosure that already carry
   *  a materialized line. Drives both the toggle's count and tier2Open. */
  const tier2FilledCount = useMemo(() => {
    if (!pekerjaanDemand || !pekerjaanGroupKey) return 0;
    return pekerjaanDemand.tier2plus.filter(row =>
      lines.some(line => line.id === demandLineId(pekerjaanGroupKey, row.materialId)),
    ).length;
  }, [pekerjaanDemand, pekerjaanGroupKey, lines]);

  /**
   * The disclosure must not hide a filled row. Collapsing UNMOUNTS the row while
   * its line survives in `lines`, so a quantity — or worse a missing overage
   * reason, which DISABLES the submit button instead of firing a toast — would
   * sit behind a closed section with the fixing control invisible: a dead button
   * and no way to see why. Manual toggling still works while every row is empty.
   */
  const tier2Open = showTier2Section || tier2FilledCount > 0;

  /**
   * Typing a quantity on a demand row materializes a STANDARD RequestLine —
   * same fields the catalog picker sets (applyCatalogMaterialToLine), with the
   * chosen group preset for Tier 1. Clearing the field removes the line, so an
   * emptied row leaves no trace in the payload. Tier 2+ rows keep workGroupKey
   * null: they burn against the project envelope, not the group.
   *
   * Materializing a TIER-2 line also warms its project envelope + BoQ breakdown,
   * exactly as the catalog picker does on selection: without them the line has
   * no allocationPreview, and handleSubmit's Tier-2 guard would refuse the WHOLE
   * submission ("belum punya breakdown baseline"). Tier 1 is warmed by the
   * existing lines effect (it carries both workGroupKey and materialId), Tier 3
   * likewise for its Rupiah budget, and Tier 4 needs no baseline — so Tier 2 is
   * the only grain that has to be warmed here.
   */
  const setDemandQuantity = async (material: DemandCatalogMaterial, groupKey: string, value: string) => {
    const id = demandLineId(groupKey, material.id);
    // Only on materialization: re-warming per keystroke would refetch an
    // envelope the cache already answers for.
    const materializing = !!value.trim() && !lines.some(line => line.id === id);

    setLines(prev => {
      if (!value.trim()) return prev.filter(line => line.id !== id);
      if (prev.some(line => line.id === id)) {
        return prev.map(line => (line.id === id ? { ...line, quantity: value } : line));
      }
      return [...prev, makeLine({
        ...applyCatalogMaterialToLine(material),
        id,
        workGroupKey: material.tier === 1 ? groupKey : null,
        quantity: value,
      })];
    });

    if (materializing && material.tier === 2) {
      await cacheTier2Context([material.id]);
    }
  };

  /** In Path 1 a Tier-1 line belongs to the group the supervisor already chose. */
  const presetGroupFor = (tier: 1 | 2 | 3 | 4): { workGroupKey?: string } =>
    mode === 'pekerjaan' && pekerjaanGroupKey && tier === 1
      ? { workGroupKey: pekerjaanGroupKey }
      : {};

  /**
   * A Tier-1 line with a quantity but no allocation cannot be posted: handleSubmit
   * refuses it ("belum punya baseline material"). Surfacing it inline turns a
   * submit-time surprise into a visible state — the guard itself is untouched.
   *
   * Gated on the warm having RESOLVED. On the first keystroke of a demand row
   * the envelope/breakdown fetches are still in flight, so allocationPreview is
   * legitimately empty for a moment; without this gate every healthy Tier-1 row
   * flashes the red no-baseline hint for the length of a round trip (seconds on
   * a site connection). Only a resolved-and-still-empty preview is real.
   */
  const isUnallocatableTier1 = (line: RequestLine) => {
    if (line.tier !== 1 || !isPositiveNumber(line.quantity)) return false;
    if (line.allocationPreview.length > 0) return false;
    // No ids means nothing is pending — the empty preview is already final.
    if (!line.workGroupKey || !line.materialId) return true;
    // `.has()`, never `.get()`: workGroupEnvCache stores `null` for "fetched,
    // no baseline", so only key PRESENCE separates a resolved fetch from one
    // still in flight. breakdownCache likewise always sets a key (possibly [])
    // once it resolves, and it is what actually feeds buildWorkGroupAllocations.
    return workGroupEnvCache.has(`${line.workGroupKey}::${line.materialId}`)
      && breakdownCache.has(line.materialId);
  };

  // Warm work-group envelope + breakdown for Tier-1 lines once both a group and
  // a catalog material are chosen. Without a materialId there is no baseline to
  // validate the bulk order against (the gate then returns a soft INFO).
  // Tier-3 catalog lines warm their Rupiah budget envelope for the soft gate.
  useEffect(() => {
    for (const line of lines) {
      if (line.tier === 1 && line.workGroupKey && line.materialId) {
        void cacheWorkGroupEnvelope(line.workGroupKey, line.materialId);
        void cacheTier2Context([line.materialId]);
      }
      if (line.tier === 3 && line.materialId) {
        void cacheMaterialBudget(line.materialId);
      }
    }
  }, [lines, cacheWorkGroupEnvelope, cacheTier2Context, cacheMaterialBudget]);

  // ── Mode Besi (spec §3) ──────────────────────────────────────────────────
  // The matrix owns the numbers; `lines` is DERIVED from it (see the effect
  // below), so gates, allocations and submit stay the same pipeline every
  // other path uses — Mode Besi adds no write path of its own.

  const materialById = useMemo(
    () => new Map(materialOptions.map(m => [m.id, m])),
    [materialOptions],
  );

  /** Rebar bars come from the CATALOG (code LIKE 'REB-%'), never a hardcoded list. */
  const rebarMaterials = useMemo<RebarMaterial[]>(() => materialOptions
    .filter(m => isRebarCode(m.code))
    .map(m => ({
      id: m.id,
      code: m.code ?? '',
      name: m.name,
      unit: m.unit,
      supplierUnit: m.supplier_unit || 'batang',
      kgPerBatang: m.base_qty_per_supplier_unit,
    })), [materialOptions]);

  // Mode Besi needs every group's envelope to know which have rebar demand.
  useEffect(() => {
    if (mode !== 'besi') return;
    void loadGroupEnvelopes(workGroups.map(group => group.key));
  }, [mode, workGroups, loadGroupEnvelopes]);

  /**
   * Every group's envelope fetch has RESOLVED. Same `.has()` reasoning as
   * isUnallocatableTier1: until then "no group has rebar demand" is a fetch in
   * flight, not an answer, and the empty state must not claim otherwise.
   */
  const besiEnvelopesReady = useMemo(
    () => workGroups.every(group => groupEnvCache.has(group.key)),
    [workGroups, groupEnvCache],
  );

  const rebarGroupEnvelopes = useMemo<RebarGroupEnvelope[]>(() => workGroups
    .filter(group => groupEnvCache.has(group.key))
    .map(group => ({
      groupKey: group.key,
      groupLabel: group.label,
      rows: groupEnvCache.get(group.key)!,
    })), [workGroups, groupEnvCache]);

  const rebarCells = useMemo(
    () => buildRebarCells(rebarMaterials, rebarGroupEnvelopes),
    [rebarMaterials, rebarGroupEnvelopes],
  );

  const rebarDemandGroupKeys = useMemo(() => groupsWithRebarDemand(rebarCells), [rebarCells]);

  /**
   * Default scope = every group with rebar demand, selected (spec §3 step 1).
   *
   * ADDITIVE, not one-shot. Envelopes can arrive in more than one batch — Path 1
   * caches its own group and `discard` deliberately keeps that cache, so Mode
   * Besi's first commit can legitimately see one group and the rest a round trip
   * later. A latched seed would leave those later groups UNCHECKED under a hint
   * that promises "semua grup … dipilih otomatis": a silent under-order.
   *
   * The seeded set (not the scope itself) is what stops a re-add: a group the
   * user unchecked stays seeded, so it is never offered again.
   */
  useEffect(() => {
    if (mode !== 'besi') return;
    const fresh = rebarDemandGroupKeys.filter(key => !besiSeededKeys.has(key));
    if (fresh.length === 0) return;
    setBesiScope(prev => new Set([...prev, ...fresh]));
    setBesiSeededKeys(prev => new Set([...prev, ...fresh]));
  }, [mode, rebarDemandGroupKeys, besiSeededKeys]);

  const besiScopeKeys = useMemo(
    () => rebarDemandGroupKeys.filter(key => besiScope.has(key)),
    [rebarDemandGroupKeys, besiScope],
  );

  const besiMatrixRows = useMemo(
    () => buildMatrixRows(rebarMaterials, rebarCells, besiScopeKeys),
    [rebarMaterials, rebarCells, besiScopeKeys],
  );

  /**
   * Mode Besi's lines are DERIVED state: the matrix owns the numbers, this
   * effect projects them onto the same `lines` array every other path uses.
   * Ids are deterministic so React keys, caches and gate results survive a
   * keystroke. The per-diameter reason rides along onto each of its lines,
   * which is how "one picker per diameter, stored per line" is satisfied.
   *
   * It replaces `lines` wholesale, so it MUST stay inert outside Mode Besi —
   * the `mode` guard is both the first statement and the first dep. Mode Besi
   * renders no card list (shouldShowLines), so inside 'besi' nothing else can
   * own a line for it to clobber.
   */
  useEffect(() => {
    if (mode !== 'besi') return;
    const drafts = expandRebarMatrix(
      Object.entries(besiSplit).map(([materialId, byGroup]) => ({
        materialId,
        splits: Object.entries(byGroup).map(([groupKey, raw]) => ({
          groupKey,
          batang: Number.parseInt(raw, 10) || 0,
        })),
      })),
    );

    setLines(drafts.flatMap(draft => {
      const material = materialById.get(draft.materialId);
      if (!material) return [];
      const captured = besiReason[draft.materialId];
      return [makeLine({
        ...applyCatalogMaterialToLine(material),
        id: besiLineId(draft.materialId, draft.workGroupKey),
        // Mirrors Path 1's setDemandQuantity: only Tier 1 burns against a work
        // group. Every REB-* row in the catalogue is Tier 1 today, but a
        // reclassified one must not carry a group key its gate would then
        // validate against the wrong grain.
        workGroupKey: material.tier === 1 ? draft.workGroupKey : null,
        quantity: String(draft.quantityBatang),
        overageReason: captured?.reason ?? null,
        overageNote: captured?.note ?? '',
      })];
    }));
  }, [mode, besiSplit, besiReason, materialById]);

  /** Diameters rendered under the "Diameter lain" disclosure (no baseline in scope). */
  const besiOtherRows = useMemo(
    () => besiMatrixRows.filter(row => !row.hasBaseline),
    [besiMatrixRows],
  );

  /**
   * No-baseline diameters the supervisor has already touched — a materialized
   * line, or a typed total whose split is still unassigned (defaultSplit
   * returns null without a baseline, so those rows legitimately have a total
   * and no line yet).
   */
  const besiOtherFilledCount = useMemo(
    () => besiOtherRows.filter(row =>
      (Number.parseInt(besiTotal[row.material.id] ?? '', 10) || 0) > 0
      || lines.some(line => line.id.startsWith(besiLinePrefix(row.material.id))),
    ).length,
    [besiOtherRows, besiTotal, lines],
  );

  /**
   * Same rule as Path 1's tier2Open: the disclosure must not hide a filled row.
   * Collapsing unmounts the row while its line survives in `lines`, so a
   * missing overage reason (which DISABLES submit rather than firing a toast)
   * or an unallocatable 'tanpa baseline' line would sit behind a closed
   * section with no visible control to fix it. Manual toggling still works
   * while every row of the section is empty.
   */
  const besiOtherOpen = besiShowOther || besiOtherFilledCount > 0;

  /**
   * Changing the scope invalidates every split already seeded from it — a
   * de-scoped group would otherwise keep its batang and still expand into a
   * line. Clearing the matrix inputs on toggle keeps `besiSplit` unable to hold
   * a group that is not in scope, which is what makes the derive effect above
   * safe without a second filter.
   */
  const toggleBesiScope = (groupKey: string) => {
    setBesiScope(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      return next;
    });
    setBesiTotal({});
    setBesiSplit({});
    setBesiReason({});
  };

  /** Typing a total seeds the default split; the user can then edit any group. */
  const setBesiTotalFor = (materialId: string, value: string) => {
    setBesiTotal(prev => ({ ...prev, [materialId]: value }));
    const total = Number.parseInt(value, 10);
    if (!Number.isFinite(total) || total <= 0) {
      setBesiSplit(prev => ({ ...prev, [materialId]: {} }));
      return;
    }
    const basis = splitBasisFor(rebarCells, materialId, besiScopeKeys);
    const split = defaultSplit(total, basis);
    setBesiSplit(prev => ({
      ...prev,
      // No baseline anywhere in scope → no honest proportion; start every group
      // empty and let the supervisor assign (spec §3 step 3).
      [materialId]: Object.fromEntries(
        (split ?? basis.map(b => ({ groupKey: b.groupKey, batang: 0 })))
          .map(entry => [entry.groupKey, split ? String(entry.batang) : '']),
      ),
    }));
  };

  const setBesiSplitFor = (materialId: string, groupKey: string, value: string) => {
    setBesiSplit(prev => ({
      ...prev,
      [materialId]: { ...(prev[materialId] ?? {}), [groupKey]: value },
    }));
  };

  const besiSplitTotal = (materialId: string) =>
    Object.values(besiSplit[materialId] ?? {})
      .reduce((sum, raw) => sum + (Number.parseInt(raw, 10) || 0), 0);

  /** Every Mode Besi input, back to entry state. One helper so the three exits
   *  (enter a path, leave to the landing, submit) can never drift apart and
   *  leave a de-scoped group or a stale reason alive in the next draft. */
  const resetBesiState = () => {
    setBesiStep('scope');
    setBesiScope(new Set());
    // Clearing the seeded set is what makes the next entry re-seed from scratch
    // instead of inheriting "already offered" from the previous draft.
    setBesiSeededKeys(new Set());
    setBesiShowOther(false);
    setBesiTotal({});
    setBesiSplit({});
    setBesiReason({});
  };

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

  /** Removes a CARD-list line. The "keep one line" floor counts the cards the
   *  list actually renders (manualLines), not every line in state — in Path 1
   *  the demand rows also live in `lines` and must not pin a manual card open. */
  const removeLine = (id: string) => {
    if (manualLines.length <= 1) return;
    setLines(prev => prev.filter(line => line.id !== id));
  };

  /** Enter a path. Material Umum keeps its one blank starter line; the two
   *  BoQ-first paths start empty and materialize lines as quantities arrive.
   *  The header fields (note + urgency) belong to ONE submission, so they reset
   *  with the lines — otherwise a draft abandoned in one path rides into the
   *  next one, exactly as handleSubmit's post-submit reset already prevents. */
  const enterMode = (next: PermintaanMode) => {
    setLines(next === 'umum' ? [makeLine()] : []);
    setCommonNote('');
    setUrgency('NORMAL');
    setPekerjaanGroupKey(null);
    setShowTier2Section(false);
    resetBesiState();
    // The banner belongs to the path being left — Mode Besi and Path 1 share
    // this one error slot, so a stale one would accuse a fetch that never ran.
    setGroupEnvError(null);
    setMode(next);
  };

  /** Back to the landing. Unsubmitted input is confirmed away, never dropped
   *  silently (design spec §1). */
  const leaveMode = () => {
    const discard = () => {
      setLines([]);
      setCommonNote('');
      setUrgency('NORMAL');
      resetBesiState();
      setMode('landing');
    };
    const hasInput = lines.some(line => isPositiveNumber(line.quantity));
    if (!hasInput) {
      discard();
      return;
    }
    Alert.alert(
      'Batalkan permintaan ini?',
      'Jumlah yang sudah diisi akan dihapus.',
      [
        { text: 'Lanjut Isi', style: 'cancel' },
        {
          text: 'Hapus & Kembali',
          style: 'destructive',
          onPress: discard,
        },
      ],
    );
  };

  const openMaterialPicker = (lineId: string) => {
    setMaterialPickerLineId(lineId);
    setMaterialSearch('');
    setMaterialPickerVisible(true);
  };

  const applyMaterialSelection = async (material: MaterialOption) => {
    if (!materialPickerLineId) return;

    updateLine(materialPickerLineId, {
      ...applyCatalogMaterialToLine(material),
      ...presetGroupFor(material.tier),
    });

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
        // Project envelope (PO-based total_ordered) — shown alongside as PO
        // context only; the group grain has no PO dimension of its own.
        const projectEnvelope = line.materialId ? envelopeCache.get(line.materialId) ?? null : null;

        return {
          ...line,
          lineResult: computeWorkGroupGate1Flag(envelope, requestedBaseQty, group.label, envDisplay, projectEnvelope),
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
          // Task B: the per-BoQ breakdown is empty for project-level "Others"
          // master lines (boq_item_id NULL — migration 082), since
          // get_envelope_boq_breakdown INNER JOINs boq_items. Falls back to a
          // GENERAL_STOCK allocation when the project envelope shows real
          // planned demand for this material; stays [] (hard block) when it
          // doesn't. Gate 1 above is unaffected — same envelope, same result.
          allocationPreview: resolveTier2Allocations(breakdownCache.get(line.materialId) ?? [], envelope, requestedBaseQty),
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

      // Tier 3 — Rupiah budget soft gate. A catalog-linked material burns
      // against its budget envelope; a free-text line has no baseline.
      const budget = line.materialId ? budgetCache.get(line.materialId) ?? null : null;
      return {
        ...line,
        lineResult: buildTier3Result(budget, requestedBaseQty, !!line.materialId),
        allocationPreview: buildGeneralStockAllocation(requestedBaseQty),
      };
    });
  }, [lines, workGroupMap, envelopeCache, breakdownCache, workGroupEnvCache, budgetCache]);

  /**
   * Lines the multi-line CARD list owns. Demand rows and Mode Besi cells render
   * their own compact controls, so the card list must skip them or Path 1 would
   * show every material twice. Path 1 still needs the card list for "Tambah
   * material lain" / "Tambah Manual" (spec §2), which is why it is not gated on
   * Material Umum alone.
   */
  const manualLines = useMemo(
    () => linesWithResults.filter(
      line => !line.id.startsWith('demand:') && !line.id.startsWith('besi:'),
    ),
    [linesWithResults],
  );

  /** Diameters with at least one line projected over 100% — each gets one picker.
   *  Lives here, not with the other Mode Besi memos, because it reads the GATE
   *  results (linesWithResults), which are derived further down the file.
   *  Scoped to `besi:` lines (the manualLines prefix idiom): keying on
   *  materialId alone is only correct while Mode Besi owns every line, and that
   *  is an invariant of the current render tree, not of this memo. */
  const besiOverMaterialIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of linesWithResults) {
      if (!line.id.startsWith('besi:')) continue;
      if (line.materialId && requiresOverageReason(line.lineResult)) ids.add(line.materialId);
    }
    return ids;
  }, [linesWithResults]);

  const overallFlag = useMemo<FlagLevel>(() => {
    let worst: FlagLevel = 'OK';
    for (const line of linesWithResults) {
      if (!line.lineResult) continue;
      const lineIndex = FLAG_ORDER.indexOf(line.lineResult.flag);
      if (lineIndex > FLAG_ORDER.indexOf(worst)) worst = line.lineResult.flag;
    }
    return worst;
  }, [linesWithResults]);

  // Lines whose projected cumulative crosses 100% must carry an overage reason
  // before submit (spec §3). Request time never hard-blocks on quantity/budget —
  // the ONLY submit blocker now is a missing reason on an over-total line.
  const missingReasonLineIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of linesWithResults) {
      if (isPositiveNumber(line.quantity) && requiresOverageReason(line.lineResult) && !line.overageReason) {
        ids.add(line.id);
      }
    }
    return ids;
  }, [linesWithResults]);
  const hasMissingReason = missingReasonLineIds.size > 0;

  // Reason 'OTHER' ("Lainnya") requires a free-text note before submit (spec §3
  // "OTHER + free text") — same blocking pattern as the reason-required check
  // above, just one predicate deeper.
  const missingOtherNoteLineIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of linesWithResults) {
      if (
        isPositiveNumber(line.quantity)
        && requiresOverageReason(line.lineResult)
        && requiresOverageNote(line.overageReason, line.overageNote)
      ) {
        ids.add(line.id);
      }
    }
    return ids;
  }, [linesWithResults]);
  const hasMissingOtherNote = missingOtherNoteLineIds.size > 0;

  const hasValidLines = linesWithResults.some(line => isPositiveNumber(line.quantity));

  const hasBlockingReasonIssue = hasMissingReason || hasMissingOtherNote;

  const statusLabel = hasMissingReason
    ? 'Lengkapi alasan kelebihan alokasi'
    : hasMissingOtherNote
      ? "Lengkapi keterangan alasan 'Lainnya'"
      : overallFlag === 'WARNING' || overallFlag === 'HIGH'
        ? 'Perlu Review Estimator'
        : 'Siap Dikirim';

  // The multi-line catalog form renders only the lines the CARD list owns:
  // Material Umum's own lines, plus the ones Path 1 adds through "Tambah
  // material lain" / "Tambah Manual". Demand rows and Mode Besi cells render
  // their own compact controls (see manualLines) and are excluded here.
  const shouldShowLines = (mode === 'umum' || mode === 'pekerjaan') && manualLines.length > 0;

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
    // Soft heads-up: an over-total line submits, but only after the supervisor
    // picks a reason (spec §3). No principal hard-hold at request time.
    if (hasMissingReason) {
      toast('Pilih alasan untuk material yang melebihi alokasi sebelum mengirim', 'critical');
      return;
    }
    if (hasMissingOtherNote) {
      toast("Alasan 'Lainnya' butuh keterangan", 'critical');
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
      // Transactional submit (Task 2.9): header + N lines + per-line allocations
      // + activity_log all land in ONE plpgsql transaction (submit_material_request,
      // migration 073). Before this, a failed line/allocation insert orphaned the
      // header — the exact bug class 045 fixed for POs. Any RAISE now rolls the
      // whole request back, so there is a single error path and no partial-write
      // cleanup to do. Field-for-field the payload mirrors the old direct inserts.
      const submitLines: SubmitRequestLineInput[] = validLines.map(line => ({
        material_id: line.materialId ?? null,
        custom_material_name: line.isCustom || !line.materialId ? sanitizeText(line.materialName) : null,
        tier: line.tier,
        material_spec_reference: line.specRef ? sanitizeText(line.specRef) : null,
        // BASE-unit canonical: triggers 048/049 compare quantity against
        // per-kg benchmarks/envelopes. Batang exists only in the UI.
        quantity: supplierToBase(parseFloat(line.quantity), line.base_qty_per_supplier_unit),
        unit: sanitizeText(line.base_qty_per_supplier_unit ? (line.baseUnit || line.unit) : line.unit),
        // Advisory: 033 Trigger 1 overwrites line_flag server-side.
        line_flag: line.lineResult?.flag ?? 'OK',
        // line_check_details is the supervisor's evidence-of-then snapshot
        // (spec §3) — it now carries the overage running-total components via
        // lineResult.overage. Office/approval panels RECOMPUTE live and never
        // trust this stored value as current numbers.
        line_check_details: line.lineResult,
        // Signal-1 reason capture: persisted only for a line that is
        // actually over-total at submit (a reason left over from an earlier,
        // higher quantity is dropped if the line fell back under 100%).
        overage_reason: requiresOverageReason(line.lineResult) ? line.overageReason : null,
        overage_note: requiresOverageReason(line.lineResult) && line.overageReason && line.overageNote
          ? sanitizeText(line.overageNote)
          : null,
        work_group_label: line.tier === 1 && line.workGroupKey
          ? workGroupMap.get(line.workGroupKey)?.label ?? null
          : null,
        allocations: line.allocationPreview.map(preview => ({
          boq_item_id: preview.boqItemId,
          allocated_quantity: preview.allocatedQuantity,
          proportion_pct: preview.proportionPct,
          allocation_basis: preview.allocationBasis,
        })),
      }));

      const materialSummary = validLines
        .map(line => {
          const kgNote = line.base_qty_per_supplier_unit
            ? ` (≈ ${supplierToBase(parseFloat(line.quantity), line.base_qty_per_supplier_unit).toFixed(1)} ${line.baseUnit || 'kg'})`
            : '';
          return `${line.materialName} ×${line.quantity} ${line.unit}${kgNote}`.trim();
        })
        .join(', ');

      const payload = buildSubmitMaterialRequestPayload(
        {
          project_id: project.id,
          boq_item_id: null,
          request_basis: ACTIVE_REQUEST_BASIS,
          requested_by: profile.id,
          target_date: targetDate,
          urgency,
          common_note: commonNote ? sanitizeText(commonNote) : null,
          overall_flag: overallFlag,
          // Request time never hard-holds on quantity/budget (spec §3) — the
          // header opens PENDING. Any server-side promotion (033 Trigger 2) is
          // now unreachable for quantity/budget flags (they cap at WARNING).
          overall_status: 'PENDING',
        },
        submitLines,
        {
          project_id: project.id,
          user_id: profile.id,
          type: 'permintaan',
          label: `Permintaan material: ${materialSummary}`,
          flag: overallFlag,
        },
      );

      const { data: newHeaderId, error: submitErr } = await supabase.rpc('submit_material_request', payload);
      if (submitErr) throw submitErr;

      // Task 3.4: the 033 triggers compute overall_flag server-side and the RPC
      // returns only the header id, so read the flag back and, if it landed
      // CRITICAL (Tier-1 envelope breach → AUTO_HOLD), record an audit event.
      // Non-fatal: never blocks the submit's success path.
      if (typeof newHeaderId === 'string') {
        await auditRequestSubmitIfCritical({
          projectId: project.id,
          userId: profile.id,
          requestHeaderId: newHeaderId,
          summary: materialSummary,
        });
      }

      toast(
        `Permintaan material dikirim — ${validLines.length} line`,
        overallFlag === 'OK' ? 'ok' : 'warning',
      );

      setLines([]);
      setCommonNote('');
      setUrgency('NORMAL');
      setPekerjaanGroupKey(null);
      setShowTier2Section(false);
      resetBesiState();
      // Envelopes are stale the moment a request lands (spec §7) — drop them so
      // re-entering a path re-fetches instead of showing yesterday's sisa. The
      // banner and spinner belong to that dropped fetch, so they go with it.
      setGroupEnvCache(new Map());
      setGroupEnvError(null);
      setGroupEnvLoading(false);
      setMode('landing');
      await refresh();
    } catch (err: any) {
      Alert.alert('Gagal mengirim', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /** One demand row: sisa, quantity input, and — once filled — the standard
   *  gate result, allocation preview and reason capture for its line. */
  const renderDemandRow = (demandRow: DemandRow) => {
    const groupKey = pekerjaanGroupKey!;
    const id = demandLineId(groupKey, demandRow.materialId);
    const line = linesWithResults.find(l => l.id === id) ?? null;
    const inputUnit = demandRow.material.supplier_unit || demandRow.material.unit;

    return (
      <Card key={id}>
        <Text style={styles.demandName}>{demandRow.material.name}</Text>
        <Text style={styles.demandMeta}>
          Sisa kebutuhan: {formatSisaLabel(demandRow)}
          {demandRow.tier !== 1 ? ' · dipantau level proyek' : ''}
        </Text>

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Jumlah ({inputUnit})</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={line?.quantity ?? ''}
              onChangeText={value => { void setDemandQuantity(demandRow.material, groupKey, value); }}
              placeholder="0"
              placeholderTextColor={COLORS.textMuted}
              accessibilityLabel={`Jumlah ${demandRow.material.name}`}
            />
          </View>
        </View>

        {line?.lineResult && <FlagPanel result={line.lineResult} gateLabel="Gate 1" />}

        {line && isUnallocatableTier1(line) && (
          <Text style={styles.blockingHint}>
            Belum ada baseline material di grup ini, jadi permintaan tidak bisa dialokasikan.
            Ajukan lewat Material Umum / Lainnya.
          </Text>
        )}

        {line && requiresOverageReason(line.lineResult) && (
          <OverageReasonPicker
            reason={line.overageReason}
            note={line.overageNote}
            onChange={patch => updateLine(line.id, patch)}
          />
        )}
      </Card>
    );
  };

  /** One diameter: aggregate sisa, the batang total, and its per-group split. */
  const renderBesiRow = (row: RebarMatrixRow) => {
    const materialId = row.material.id;
    const splitByGroup = besiSplit[materialId] ?? {};
    const typedTotal = Number.parseInt(besiTotal[materialId] ?? '', 10) || 0;
    const dividedTotal = besiSplitTotal(materialId);
    const captured = besiReason[materialId] ?? { reason: null, note: '' };

    return (
      <Card key={materialId}>
        <View style={styles.lineHeader}>
          <Text style={styles.demandName}>{row.material.name}</Text>
          {!row.hasBaseline && (
            <View style={styles.noBaselinePill}>
              <Text style={styles.noBaselineText}>tanpa baseline</Text>
            </View>
          )}
        </View>
        <Text style={styles.demandMeta}>
          {row.hasBaseline
            ? `Sisa kebutuhan: ${row.remainingBatang.toLocaleString('id-ID')} batang (≈ ${Math.round(row.remainingBase).toLocaleString('id-ID')} ${row.material.unit})`
            : 'Grup terpilih belum punya rencana untuk diameter ini.'}
        </Text>

        <Text style={styles.fieldLabel}>Jumlah (batang)</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={besiTotal[materialId] ?? ''}
          onChangeText={value => setBesiTotalFor(materialId, value)}
          placeholder="0"
          placeholderTextColor={COLORS.textMuted}
          accessibilityLabel={`Jumlah batang ${row.material.name}`}
        />

        {typedTotal > 0 && (
          <>
            <Text style={styles.fieldLabel}>Pembagian per grup (batang)</Text>
            {besiScopeKeys.map(groupKey => {
              const group = workGroupMap.get(groupKey);
              if (!group) return null;
              const line = linesWithResults.find(l => l.id === besiLineId(materialId, groupKey)) ?? null;
              return (
                <View key={groupKey} style={styles.splitRow}>
                  <Text style={styles.splitLabel}>{group.label}</Text>
                  <TextInput
                    style={[styles.input, styles.splitInput]}
                    keyboardType="number-pad"
                    value={splitByGroup[groupKey] ?? ''}
                    onChangeText={value => setBesiSplitFor(materialId, groupKey, value)}
                    placeholder="0"
                    placeholderTextColor={COLORS.textMuted}
                    accessibilityLabel={`Jumlah ${row.material.name} untuk ${group.label}`}
                  />
                  {line?.lineResult && <FlagPanel result={line.lineResult} gateLabel="Gate 1" />}
                  {line && isUnallocatableTier1(line) && (
                    <Text style={styles.blockingHint}>
                      Grup ini belum punya baseline untuk diameter ini — kosongkan atau pesan lewat Material Umum.
                    </Text>
                  )}
                </View>
              );
            })}
            <Text style={[styles.fieldHint, dividedTotal !== typedTotal && styles.fieldHintWarn]}>
              Total dibagi: {dividedTotal.toLocaleString('id-ID')} batang dari {typedTotal.toLocaleString('id-ID')} batang yang diisi.
            </Text>
          </>
        )}

        {besiOverMaterialIds.has(materialId) && (
          <OverageReasonPicker
            reason={captured.reason}
            note={captured.note}
            // The untouched half of the patch is read from `prev`, never from
            // the render-time `captured`: a reason and a note landing in the
            // same tick would otherwise have the second write revert the first.
            onChange={patch => setBesiReason(prev => {
              const current = prev[materialId] ?? { reason: null, note: '' };
              return {
                ...prev,
                [materialId]: {
                  reason: patch.overageReason !== undefined ? patch.overageReason : current.reason,
                  note: patch.overageNote !== undefined ? patch.overageNote : current.note,
                },
              };
            })}
            title={`Alasan kelebihan — ${row.material.name}`}
            hint="Berlaku untuk semua grup diameter ini yang melebihi alokasi."
          />
        )}
      </Card>
    );
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {mode === 'landing' ? (
          <>
            <Text style={styles.sectionHead}>Gate 1 — Permintaan Material</Text>
            <Text style={styles.fieldHint}>
              Pilih cara pengajuan. Untuk material presisi, mulai dari pekerjaannya agar sisa kebutuhan terlihat.
            </Text>
            {MODE_TILES.map(tile => (
              <TouchableOpacity
                key={tile.key}
                style={styles.modeTile}
                onPress={() => enterMode(tile.key)}
                accessibilityRole="button"
                accessibilityLabel={tile.title}
              >
                <View style={styles.modeTileIcon}>
                  <Ionicons name={tile.icon} size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeTileTitle}>{tile.title}</Text>
                  <Text style={styles.modeTileDesc}>{tile.desc}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSec} />
              </TouchableOpacity>
            ))}
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.backRow}
              onPress={leaveMode}
              accessibilityRole="button"
              accessibilityLabel="Kembali ke pilihan jenis permintaan"
            >
              <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
              <Text style={styles.backText}>
                {MODE_TILES.find(t => t.key === mode)?.title ?? 'Permintaan'}
              </Text>
            </TouchableOpacity>

            {/* Material Umum keeps the screen's original heading + tier
                explanation verbatim — the landing only borrowed them. */}
            {mode === 'umum' && (
              <>
                <Text style={styles.sectionHead}>Gate 1 — Permintaan Material</Text>
                <Text style={styles.fieldHint}>
                  Pilih material dulu. Tier 1 wajib memilih satu item BoQ tujuan, Tier 2 otomatis dihitung sebagai bulk envelope, dan Tier 3 dicatat sebagai stok umum.
                </Text>
              </>
            )}
          </>
        )}

        {mode === 'pekerjaan' && (
          <>
            <Text style={styles.sectionHead}>1. Grup Pekerjaan</Text>
            <SelectSheet
              value={pekerjaanGroupKey ?? ''}
              options={workGroupOptions}
              onChange={value => {
                setPekerjaanGroupKey(value || null);
                setLines([]);
                // The banner belongs to the group being left — it must not
                // accuse the newly picked one.
                setGroupEnvError(null);
              }}
              placeholder="— Pilih grup pekerjaan —"
              title="Grup Pekerjaan"
              emptyText="Belum ada grup pekerjaan — BoQ proyek ini belum dipublish."
              accessibilityLabel="Pilih grup pekerjaan"
            />

            {groupEnvError && (
              <View style={styles.softErrorBox}>
                <Ionicons name="cloud-offline-outline" size={14} color={COLORS.info} />
                <Text style={styles.softErrorText}>
                  Data kebutuhan material gagal dimuat ({groupEnvError}).
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setGroupEnvError(null);
                    if (pekerjaanGroupKey) void loadGroupEnvelopes([pekerjaanGroupKey]);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.suggestLink}>Coba lagi</Text>
                </TouchableOpacity>
              </View>
            )}

            {pekerjaanGroupKey && groupEnvLoading && !pekerjaanDemand && (
              <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: SPACE.base }} />
            )}

            {pekerjaanDemand && (
              <>
                <Text style={styles.sectionHead}>
                  2. Kebutuhan Material — {workGroupMap.get(pekerjaanGroupKey!)?.label ?? ''}
                </Text>

                {pekerjaanDemand.tier1.length === 0 && pekerjaanDemand.tier2plus.length === 0 ? (
                  <Card>
                    <Text style={styles.emptyTitle}>Grup ini belum punya rencana material</Text>
                    <Text style={styles.fieldHint}>
                      BoQ grup ini belum terhubung ke material mana pun, jadi tidak ada sisa kebutuhan yang bisa ditampilkan.
                      Material tetap bisa diminta lewat katalog.
                    </Text>
                    <TouchableOpacity
                      style={styles.addSecondaryBtn}
                      onPress={addCatalogLine}
                      accessibilityRole="button"
                    >
                      <Text style={styles.addSecondaryText}>Tambah material lain</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => enterMode('umum')} accessibilityRole="button">
                      <Text style={styles.linkText}>Buka Material Umum / Lainnya</Text>
                    </TouchableOpacity>
                  </Card>
                ) : (
                  <>
                    {pekerjaanDemand.tier1.map(demandRow => renderDemandRow(demandRow))}

                    {pekerjaanDemand.tier2plus.length > 0 && (
                      <>
                        <TouchableOpacity
                          style={styles.sectionToggle}
                          onPress={() => setShowTier2Section(v => !v)}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: tier2Open }}
                        >
                          <Text style={styles.sectionToggleText}>
                            Material terkait (Tier 2+) — {pekerjaanDemand.tier2plus.length} item
                            {tier2FilledCount > 0 ? ` · ${tier2FilledCount} diisi` : ''}
                          </Text>
                          <Ionicons
                            name={tier2Open ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color={COLORS.textSec}
                          />
                        </TouchableOpacity>
                        {tier2Open && (
                          <>
                            <Text style={styles.fieldHint}>
                              Material ini dipantau level proyek, bukan per grup pekerjaan.
                            </Text>
                            {pekerjaanDemand.tier2plus.map(demandRow => renderDemandRow(demandRow))}
                          </>
                        )}
                      </>
                    )}

                    <View style={styles.addActionRow}>
                      <TouchableOpacity
                        style={styles.addLineBtn}
                        onPress={addCatalogLine}
                        accessibilityRole="button"
                      >
                        <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
                        <Text style={styles.addLineText}>Tambah material lain</Text>
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
              </>
            )}
          </>
        )}

        {mode === 'besi' && (
          <>
            {groupEnvError && (
              <View style={styles.softErrorBox}>
                <Ionicons name="cloud-offline-outline" size={14} color={COLORS.info} />
                <Text style={styles.softErrorText}>
                  Data kebutuhan besi gagal dimuat ({groupEnvError}).
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setGroupEnvError(null);
                    void loadGroupEnvelopes(workGroups.map(group => group.key));
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.suggestLink}>Coba lagi</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Keyed on "not every envelope has landed", not on an empty list:
                a partially warm cache shows a real (short) scope list while the
                rest is still in flight, and that state must still say so. */}
            {groupEnvLoading && !besiEnvelopesReady && (
              <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: SPACE.base }} />
            )}

            {/* "No rebar plan" is an ANSWER, so it waits for the fetches to
                resolve; before that an empty matrix is just a request in
                flight and claiming otherwise would be a fabricated number. */}
            {rebarDemandGroupKeys.length === 0 && !groupEnvLoading && !groupEnvError && besiEnvelopesReady && (
              <Card>
                <Text style={styles.emptyTitle}>Belum ada rencana besi beton</Text>
                <Text style={styles.fieldHint}>
                  Tidak ada grup pekerjaan dengan rencana besi beton di proyek ini, jadi tidak ada baseline yang bisa dipakai.
                  Besi tetap bisa diminta lewat Material Umum / Lainnya.
                </Text>
                <TouchableOpacity onPress={() => enterMode('umum')} accessibilityRole="button">
                  <Text style={styles.linkText}>Buka Material Umum / Lainnya</Text>
                </TouchableOpacity>
              </Card>
            )}

            {rebarDemandGroupKeys.length > 0 && besiStep === 'scope' && (
              <>
                <Text style={styles.sectionHead}>1. Lingkup Grup Pekerjaan</Text>
                <Text style={styles.fieldHint}>
                  Semua grup dengan rencana besi dipilih otomatis. Hapus centang grup yang tidak ikut dipesan.
                </Text>
                {rebarDemandGroupKeys.map(groupKey => {
                  const group = workGroupMap.get(groupKey);
                  if (!group) return null;
                  const checked = besiScope.has(groupKey);
                  const sisaBatang = groupRebarSisaBatang(rebarMaterials, rebarCells, groupKey)
                    .toLocaleString('id-ID');
                  return (
                    <TouchableOpacity
                      key={groupKey}
                      style={styles.scopeRow}
                      onPress={() => toggleBesiScope(groupKey)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      // The sisa is the number the keep-or-drop decision hangs
                      // on, so it belongs in the label a screen reader hears —
                      // the visual meta text is not announced on its own.
                      accessibilityLabel={`${group.label} — sisa ${sisaBatang} batang`}
                    >
                      <View style={[styles.scopeBox, checked && styles.scopeBoxOn]}>
                        {checked && <Ionicons name="checkmark" size={14} color={COLORS.textInverse} />}
                      </View>
                      <Text style={styles.scopeLabel}>{group.label}</Text>
                      <Text style={styles.scopeMeta}>sisa {sisaBatang} batang</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[styles.submitBtn, besiScopeKeys.length === 0 && styles.submitBtnDisabled]}
                  onPress={() => setBesiStep('matrix')}
                  disabled={besiScopeKeys.length === 0}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: besiScopeKeys.length === 0 }}
                >
                  <Text style={styles.submitBtnText}>
                    Lanjut — {besiScopeKeys.length} grup
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {rebarDemandGroupKeys.length > 0 && besiStep === 'matrix' && (
              <>
                <TouchableOpacity
                  style={styles.backRow}
                  onPress={() => setBesiStep('scope')}
                  accessibilityRole="button"
                  accessibilityLabel="Ubah lingkup grup pekerjaan"
                >
                  <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
                  <Text style={styles.backText}>Ubah lingkup ({besiScopeKeys.length} grup)</Text>
                </TouchableOpacity>

                <Text style={styles.sectionHead}>2. Jumlah per Diameter</Text>
                {besiMatrixRows.filter(row => row.hasBaseline).map(row => renderBesiRow(row))}

                {besiOtherRows.length > 0 && (
                  <>
                    <TouchableOpacity
                      style={styles.sectionToggle}
                      onPress={() => setBesiShowOther(v => !v)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: besiOtherOpen }}
                    >
                      <Text style={styles.sectionToggleText}>
                        Diameter lain — {besiOtherRows.length} item
                        {besiOtherFilledCount > 0 ? ` · ${besiOtherFilledCount} diisi` : ''}
                      </Text>
                      <Ionicons
                        name={besiOtherOpen ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={COLORS.textSec}
                      />
                    </TouchableOpacity>
                    {besiOtherOpen && besiOtherRows.map(row => renderBesiRow(row))}
                  </>
                )}
              </>
            )}
          </>
        )}

        {shouldShowLines && (
          <>
            <Text style={styles.sectionHead}>
              Material — {manualLines.length} item
            </Text>

            {manualLines.map((line, idx) => {
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
              // Signal-2 plan drift (spec §4) — context only, no Rp; shown as a
              // badge next to the envelope figures regardless of Signal-1 status.
              const drift = line.materialId ? driftCache.get(line.materialId) ?? null : null;
              const showDrift = drift != null && shouldShowDriftBadge(drift.drift_pct);

              return (
                <Card key={line.id}>
                  <View style={styles.lineHeader}>
                    <View style={[styles.tierPill, { backgroundColor: `${tierColor}18` }]}>
                      <Text style={[styles.tierText, { color: tierColor }]}>
                        {TIER_LABELS[line.tier]}
                      </Text>
                    </View>
                    <Text style={styles.lineNum}>#{idx + 1}</Text>
                    {manualLines.length > 1 && (
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
                          updateLine(line.id, {
                            ...applyCatalogMaterialToLine(material),
                            ...presetGroupFor(material.tier ?? 3),
                          });

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
                      {/* Manual tier chips only ever offer 1-3, by design: this
                          block is for CUSTOM/free-text materials with no catalog
                          link. Tier 4 (untracked consumable) is a catalog-only
                          classification carried automatically via
                          onSelectCatalogMaterial → material.tier — a free-text
                          line has no catalog id to derive it from. */}
                      <View style={styles.inlineTierRow}>
                        {[1, 2, 3].map(rawTier => {
                          const tier = rawTier as 1 | 2 | 3;
                          const isActive = line.tier === tier;
                          return (
                            <TouchableOpacity
                              key={tier}
                              style={[styles.inlineTierChip, isActive && styles.inlineTierChipActive]}
                              onPress={() => updateLine(line.id, {
                                tier,
                                boqItemId: tier === 1 ? line.boqItemId : null,
                                ...presetGroupFor(tier),
                              })}
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

                  {mode === 'umum' && !line.isCustom && line.materialId && line.tier === 1 && (
                    <View style={styles.suggestBox}>
                      <Ionicons name="bulb-outline" size={14} color={COLORS.info} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestText}>
                          Material presisi lebih mudah lewat Permintaan Pekerjaan (BoQ) — sisa kebutuhan per grup langsung terlihat.
                        </Text>
                        <TouchableOpacity onPress={() => { leaveMode(); }} accessibilityRole="button">
                          <Text style={styles.suggestLink}>Buka Permintaan Pekerjaan</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {line.tier === 1 && (
                    <>
                      <Text style={styles.fieldLabel}>
                        Grup Pekerjaan Tujuan <Text style={styles.req}>*</Text>
                      </Text>
                      <SelectSheet
                        value={line.workGroupKey ?? ''}
                        options={workGroupOptions}
                        onChange={value => updateLine(line.id, { workGroupKey: value || null })}
                        placeholder="— Pilih grup pekerjaan —"
                        title="Grup Pekerjaan Tujuan"
                        emptyText="Belum ada grup pekerjaan — BoQ proyek ini belum dipublish."
                        accessibilityLabel={`Pilih grup pekerjaan untuk line ${idx + 1}`}
                      />
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
                      {showDrift && (
                        <View style={styles.driftBadge}>
                          <Ionicons name="git-compare-outline" size={12} color={COLORS.info} />
                          <Text style={styles.driftBadgeText}>{formatDriftBadge(drift!.drift_pct as number)}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {line.allocationPreview.length > 0 && (
                    <View style={styles.allocationBox}>
                      <Text style={styles.allocationTitle}>
                        {/* Task B: a Tier-2 line can resolve to GENERAL_STOCK
                            (project-level "Others" material, no per-BoQ
                            breakdown) — label it like Tier 3/4's stock
                            allocation instead of the misleading "Otomatis"
                            per-BoQ title. */}
                        {line.allocationPreview[0]?.allocationBasis === 'GENERAL_STOCK'
                          ? 'Alokasi Stok'
                          : line.tier === 2 ? 'Alokasi Otomatis' : line.tier === 1 ? 'BoQ Terkunci' : 'Alokasi Stok'}
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

                  {requiresOverageReason(line.lineResult) && (
                    <OverageReasonPicker
                      reason={line.overageReason}
                      note={line.overageNote}
                      onChange={patch => updateLine(line.id, patch)}
                    />
                  )}
                </Card>
              );
            })}

            {/* Path 1 has its own add-pair at the end of the demand list, so
                this one belongs to Material Umum. */}
            {mode === 'umum' && (
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
            )}
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
              { backgroundColor: hasBlockingReasonIssue ? COLORS.criticalBg : COLORS.okBg },
            ]}>
              <Text style={[styles.statusLabel, { color: hasBlockingReasonIssue ? COLORS.critical : COLORS.ok }]}>
                {statusLabel}
              </Text>
              <Text style={styles.statusSub}>
                {linesWithResults.filter(line => isPositiveNumber(line.quantity)).length} material dipilih
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, (hasBlockingReasonIssue || submitting) && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting || hasBlockingReasonIssue}
              accessibilityLabel={
                hasMissingReason
                  ? 'Lengkapi alasan kelebihan sebelum mengirim'
                  : hasMissingOtherNote
                    ? "Lengkapi keterangan alasan Lainnya sebelum mengirim"
                    : 'Ajukan permintaan material'
              }
              accessibilityRole="button"
              accessibilityState={{ disabled: hasBlockingReasonIssue || submitting, busy: submitting }}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={COLORS.textInverse} />
              ) : (
                <Text style={styles.submitBtnText}>
                  {hasMissingReason
                    ? 'Lengkapi Alasan Kelebihan'
                    : hasMissingOtherNote
                      ? 'Lengkapi Keterangan'
                      : 'Ajukan Permintaan'}
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
                placeholderTextColor={COLORS.textMuted}
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
  // Signal-2 plan drift badge (Task 2.13) — context only, distinct from the
  // burn-pct color logic above (drift can be positive/negative regardless of
  // whether the Signal-1 envelope is currently healthy).
  driftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs - 2,
    marginTop: SPACE.xs,
    paddingVertical: 3,
    paddingHorizontal: SPACE.xs,
    borderRadius: RADIUS_SM,
    backgroundColor: COLORS.infoBg,
    alignSelf: 'flex-start',
  },
  driftBadgeText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.medium,
    color: COLORS.info,
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

  modeTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: SPACE.md,
    marginTop: SPACE.sm,
    minHeight: 72,
  },
  modeTileIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS_SM,
    backgroundColor: COLORS.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTileTitle: {
    fontSize: TYPE.base,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
  },
  modeTileDesc: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginTop: 2,
    lineHeight: 17,
  },

  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingVertical: SPACE.sm,
    marginTop: SPACE.sm,
  },
  backText: {
    fontSize: TYPE.base,
    fontFamily: FONTS.semibold,
    color: COLORS.primary,
  },

  suggestBox: {
    flexDirection: 'row',
    gap: SPACE.sm,
    alignItems: 'flex-start',
    backgroundColor: COLORS.infoBg,
    borderRadius: RADIUS_SM,
    padding: SPACE.sm,
    marginTop: SPACE.sm,
  },
  suggestText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    lineHeight: 17,
  },
  suggestLink: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.info,
    marginTop: SPACE.xs,
  },

  demandName: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  demandMeta: {
    fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec,
    marginTop: 2, lineHeight: 17,
  },
  emptyTitle: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  blockingHint: {
    fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.critical,
    marginTop: SPACE.sm, lineHeight: 17,
  },
  sectionToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: SPACE.sm, paddingVertical: SPACE.md, marginTop: SPACE.sm,
    borderTopWidth: 1, borderTopColor: COLORS.borderSub,
  },
  sectionToggleText: {
    fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec,
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  softErrorBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    backgroundColor: COLORS.infoBg, borderRadius: RADIUS_SM,
    padding: SPACE.sm, marginTop: SPACE.sm,
  },
  softErrorText: {
    flex: 1, fontSize: TYPE.xs, fontFamily: FONTS.regular,
    color: COLORS.textSec, lineHeight: 17,
  },

  scopeRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingHorizontal: SPACE.md, paddingVertical: SPACE.md,
    marginTop: SPACE.sm, minHeight: 52,
  },
  scopeBox: {
    width: 20, height: 20, borderRadius: RADIUS_SM - 1, borderWidth: 2,
    borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center',
  },
  scopeBoxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  scopeLabel: { flex: 1, fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text },
  scopeMeta: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },

  noBaselinePill: {
    paddingHorizontal: SPACE.sm, paddingVertical: 3,
    borderRadius: RADIUS_SM, backgroundColor: COLORS.infoBg,
  },
  noBaselineText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.info },

  splitRow: { marginTop: SPACE.sm, gap: SPACE.xs },
  splitLabel: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text },
  splitInput: { paddingVertical: SPACE.sm + 1 },
  fieldHintWarn: { color: COLORS.warning },
});
