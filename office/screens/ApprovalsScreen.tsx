import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import Badge from '../../workflows/components/Badge';
import { useProject } from '../../workflows/hooks/useProject';
import { useToast } from '../../workflows/components/Toast';
import { supabase } from '../../tools/supabase';
import { COLORS, FONTS, RADIUS, SPACE, TYPE, BREAKPOINTS, MAX_CONTENT_WIDTH } from '../../workflows/theme';
import {
  reviewSiteChange,
  CHANGE_TYPE_LABELS, IMPACT_LABELS, DECISION_LABELS,
  type SiteChange, type Decision,
} from '../../tools/siteChanges';
import { getEnvelopesByMaterialIds, type EnvelopeWithPrice } from '../../tools/envelopes';
import { MaterialUsagePanel } from './components/MaterialUsagePanel';

type Tab = 'mtn' | 'perubahan' | 'requests';
type MTNFilter = 'ALL' | 'AWAITING' | 'APPROVED' | 'REJECTED' | 'RECEIVED';
type PerubahanFilter = 'ALL' | 'pending' | 'disetujui' | 'ditolak' | 'selesai';
type RequestFilter = 'ALL' | 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'AUTO_HOLD';

interface MTNRequest {
  id: string;
  material_name: string;
  quantity: number;
  unit: string | null;
  destination_project: string;
  reason: string | null;
  status: string;
  created_at: string;
  requested_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

interface MaterialRequest {
  id: string;
  boq_item_id: string | null;
  request_basis: 'BOQ' | 'MATERIAL';
  requested_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  overall_flag: string;
  overall_status: string;
  urgency: string;
  target_date: string;
  created_at: string;
  common_note: string | null;
  material_request_lines?: MaterialRequestLineSummary[];
}

interface MaterialRequestLineSummary {
  id: string;
  material_id: string | null;
  custom_material_name: string | null;
  tier: 1 | 2 | 3;
  quantity: number;
  unit: string;
  line_flag: string;
  material_catalog?: { name: string | null; code: string | null } | Array<{ name: string | null; code: string | null }> | null;
  material_request_line_allocations?: MaterialRequestAllocationSummary[];
}

interface MaterialRequestAllocationSummary {
  boq_item_id: string | null;
  allocated_quantity: number;
  proportion_pct: number;
  allocation_basis: 'DIRECT' | 'TIER2_ENVELOPE' | 'GENERAL_STOCK';
}

function statusFlag(status: string) {
  switch (status) {
    case 'APPROVED':
    case 'RECEIVED':
    case 'disetujui':
    case 'selesai':
      return 'OK' as const;
    case 'REJECTED':
    case 'ditolak':
      return 'CRITICAL' as const;
    case 'REVIEWED':
    case 'UNDER_REVIEW':
      return 'INFO' as const;
    case 'AUTO_HOLD':
      return 'CRITICAL' as const;
    default:
      return 'WARNING' as const;
  }
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID');
}

function getLineMaterialName(line: MaterialRequestLineSummary) {
  const rawMaterial = line.material_catalog;
  const material = Array.isArray(rawMaterial) ? rawMaterial[0] ?? null : rawMaterial;
  return material?.name ?? line.custom_material_name ?? 'Material';
}

function describeRequestScope(request: MaterialRequest, boqLabels: Record<string, string>) {
  if (request.request_basis === 'BOQ' && request.boq_item_id) {
    return boqLabels[request.boq_item_id] ?? request.boq_item_id;
  }

  const lines = request.material_request_lines ?? [];
  if (lines.length === 0) return 'Permintaan berbasis material';
  if (lines.length === 1) {
    const line = lines[0];
    if (line.tier === 2) return `Envelope ${getLineMaterialName(line)}`;
    if (line.tier === 3) return `Stok Umum — ${getLineMaterialName(line)}`;
    return `${getLineMaterialName(line)} — BoQ spesifik`;
  }
  return `${lines.length} material lintas BoQ`;
}

export default function ApprovalsScreen() {
  const { project, profile } = useProject();
  const { show: toast } = useToast();
  const { width } = useWindowDimensions();
  const isTablet  = width >= BREAKPOINTS.tablet;
  const isDesktop = width >= BREAKPOINTS.desktop;
  const contentMaxWidth = isDesktop ? MAX_CONTENT_WIDTH.desktop : isTablet ? MAX_CONTENT_WIDTH.tablet : undefined;
  const [activeTab, setActiveTab] = useState<Tab>('mtn');
  const [mtnFilter, setMtnFilter] = useState<MTNFilter>('ALL');
  const [perubahanFilter, setPerubahanFilter] = useState<PerubahanFilter>('ALL');
  const [requestFilter, setRequestFilter] = useState<RequestFilter>('ALL');

  const [mtns, setMtns] = useState<MTNRequest[]>([]);
  const [changes, setChanges] = useState<SiteChange[]>([]);
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [boqLabels, setBoqLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [envelopeMap, setEnvelopeMap] = useState<Map<string, EnvelopeWithPrice>>(new Map());
  const [boqItemMap, setBoqItemMap] = useState<Map<string, { planned: number; installed: number; code: string; label: string }>>(new Map());

  const loadData = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const [mtnRes, changesRes, reqRes, boqRes] = await Promise.all([
        supabase.from('mtn_requests').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
        supabase
          .from('site_changes')
          .select('*, boq_items(code, label), mandor_contracts(mandor_name), profiles!site_changes_reported_by_fkey(full_name)')
          .eq('project_id', project.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('material_request_headers')
          .select(`
            *,
            material_request_lines(
              id,
              material_id,
              custom_material_name,
              tier,
              quantity,
              unit,
              line_flag,
              material_catalog(name, code),
              material_request_line_allocations(
                boq_item_id,
                allocated_quantity,
                proportion_pct,
                allocation_basis
              )
            )
          `)
          .eq('project_id', project.id)
          .order('created_at', { ascending: false }),
        supabase.from('boq_items').select('id, code, label').eq('project_id', project.id),
      ]);

      const nextMtns = (mtnRes.data as MTNRequest[]) ?? [];
      const nextChanges: SiteChange[] = ((changesRes.data as any[]) ?? []).map((row: any) => ({
        ...row,
        boq_code: row.boq_items?.code,
        boq_label: row.boq_items?.label,
        mandor_name: row.mandor_contracts?.mandor_name,
        reporter_name: row.profiles?.full_name,
        boq_items: undefined,
        mandor_contracts: undefined,
        profiles: undefined,
      }));
      const nextRequests = (reqRes.data as MaterialRequest[]) ?? [];
      setMtns(nextMtns);
      setChanges(nextChanges);
      setRequests(nextRequests);
      setBoqLabels(Object.fromEntries(((boqRes.data as any[]) ?? []).map((item) => [item.id, `${item.code} — ${item.label}`])));

      const profileIds = Array.from(new Set([
        ...nextMtns.flatMap(row => [row.requested_by, row.reviewed_by]),
        ...nextChanges.flatMap(row => [row.reported_by, row.reviewed_by]),
        ...nextRequests.flatMap(row => [row.requested_by, row.reviewed_by]),
      ].filter(Boolean))) as string[];

      if (profileIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', profileIds);
        setProfileNames(Object.fromEntries((profileRows ?? []).map((row: any) => [row.id, row.full_name])));
      } else {
        setProfileNames({});
      }

      // Collect material_ids and boq_item_ids referenced by request lines
      const materialIds = new Set<string>();
      const boqItemIds = new Set<string>();
      for (const req of nextRequests) {
        for (const line of req.material_request_lines ?? []) {
          if (line.material_id) materialIds.add(line.material_id);
          for (const alloc of line.material_request_line_allocations ?? []) {
            if (alloc.boq_item_id) boqItemIds.add(alloc.boq_item_id);
          }
        }
      }

      // Batch fetch envelopes
      const envelopes = await getEnvelopesByMaterialIds(project.id, Array.from(materialIds));
      setEnvelopeMap(envelopes);

      // Batch fetch BoQ items (planned + installed for Tier 1)
      if (boqItemIds.size > 0) {
        const { data: boqRows } = await supabase
          .from('boq_items')
          .select('id, planned, installed, code, label')
          .in('id', Array.from(boqItemIds));
        const map = new Map<string, { planned: number; installed: number; code: string; label: string }>();
        for (const row of (boqRows ?? []) as Array<{ id: string; planned: number; installed: number; code: string; label: string }>) {
          map.set(row.id, { planned: row.planned, installed: row.installed, code: row.code, label: row.label });
        }
        setBoqItemMap(map);
      } else {
        setBoqItemMap(new Map());
      }
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleMTN = async (id: string, approve: boolean) => {
    if (!profile) return;
    try {
      const { error } = await supabase.from('mtn_requests').update({
        status: approve ? 'APPROVED' : 'REJECTED',
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      toast(`MTN ${approve ? 'disetujui' : 'ditolak'}`, approve ? 'ok' : 'warning');
      await loadData();
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  const handlePerubahan = async (id: string, decision: Decision) => {
    if (!profile) return;
    try {
      const { error } = await reviewSiteChange({ id, decision });
      if (error) throw new Error(error);
      toast(`Catatan perubahan ${DECISION_LABELS[decision].toLowerCase()}`, 'ok');
      await loadData();
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  const handleRequest = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    if (!profile) return;
    try {
      const { error } = await supabase.from('material_request_headers').update({
        overall_status: action,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      toast(`Permintaan ${action === 'APPROVED' ? 'disetujui' : 'ditolak'}`, action === 'APPROVED' ? 'ok' : 'warning');
      await loadData();
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  // Principal-only: escalate material request back to hold
  const handleRequestHold = async (id: string) => {
    if (!profile) return;
    try {
      const { error } = await supabase.from('material_request_headers').update({
        overall_status: 'AUTO_HOLD',
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      toast('Permintaan ditahan', 'warning');
      await loadData();
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  const countBy = <T extends { status?: string; overall_status?: string }>(rows: T[], value: string, key: 'status' | 'overall_status') =>
    rows.filter(row => (row[key] ?? '') === value).length;

  const mtnCounts = useMemo(() => ({
    ALL: mtns.length,
    AWAITING: countBy(mtns, 'AWAITING', 'status'),
    APPROVED: countBy(mtns, 'APPROVED', 'status'),
    REJECTED: countBy(mtns, 'REJECTED', 'status'),
    RECEIVED: countBy(mtns, 'RECEIVED', 'status'),
  }), [mtns]);

  const countByDecision = (rows: SiteChange[], value: string) =>
    rows.filter(row => row.decision === value).length;

  const changeCounts = useMemo(() => ({
    ALL: changes.length,
    pending: countByDecision(changes, 'pending'),
    disetujui: countByDecision(changes, 'disetujui'),
    ditolak: countByDecision(changes, 'ditolak'),
    selesai: countByDecision(changes, 'selesai'),
  }), [changes]);

  const requestCounts = useMemo(() => ({
    ALL: requests.length,
    PENDING: countBy(requests, 'PENDING', 'overall_status'),
    UNDER_REVIEW: countBy(requests, 'UNDER_REVIEW', 'overall_status'),
    APPROVED: countBy(requests, 'APPROVED', 'overall_status'),
    REJECTED: countBy(requests, 'REJECTED', 'overall_status'),
    AUTO_HOLD: countBy(requests, 'AUTO_HOLD', 'overall_status'),
  }), [requests]);

  const filteredMtns = useMemo(
    () => mtnFilter === 'ALL' ? mtns : mtns.filter(row => row.status === mtnFilter),
    [mtns, mtnFilter],
  );
  // Priority weight for catatan perubahan — urgent and berat items first
  const changeWeight = (c: SiteChange) => {
    if (c.is_urgent) return 0;
    if (c.impact === 'berat') return 1;
    if (c.decision === 'pending') return 2;
    if (c.decision === 'disetujui') return 3;
    if (c.decision === 'selesai') return 4;
    return 5;
  };

  const filteredChanges = useMemo(() => {
    const base = perubahanFilter === 'ALL' ? changes : changes.filter(row => row.decision === perubahanFilter);
    return [...base].sort((a, b) => changeWeight(a) - changeWeight(b));
  }, [changes, perubahanFilter]);

  // Priority weight for requests — CRITICAL flag and AUTO_HOLD first
  const reqWeight = (r: MaterialRequest) => {
    if (r.overall_flag === 'CRITICAL') return 0;
    if (r.overall_status === 'AUTO_HOLD') return 1;
    if (r.overall_flag === 'HIGH' || r.overall_flag === 'WARNING') return 2;
    if (r.overall_status === 'PENDING') return 3;
    if (r.overall_status === 'UNDER_REVIEW') return 4;
    return 5;
  };

  const filteredRequests = useMemo(() => {
    const base = requestFilter === 'ALL' ? requests : requests.filter(row => row.overall_status === requestFilter);
    if (profile?.role !== 'principal') return base;
    return [...base].sort((a, b) => reqWeight(a) - reqWeight(b));
  }, [requests, requestFilter, profile?.role]);

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'mtn', label: 'MTN', count: mtnCounts.AWAITING },
    { key: 'perubahan', label: 'Perubahan', count: changeCounts.pending },
    { key: 'requests', label: 'Permintaan', count: requestCounts.PENDING + requestCounts.UNDER_REVIEW + requestCounts.AUTO_HOLD },
  ];

  const renderFilterChips = <T extends string>(
    filters: Array<{ key: T; label: string; count: number }>,
    current: T,
    onSelect: (key: T) => void,
  ) => (
    <View style={styles.filterRow}>
      {filters.map(filter => (
        <TouchableOpacity
          key={filter.key}
          style={[styles.filterChip, current === filter.key && styles.filterChipActive]}
          onPress={() => onSelect(filter.key)}
        >
          <Text style={[styles.filterText, current === filter.key && styles.filterTextActive]}>
            {filter.label} ({filter.count})
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const actorName = (id?: string | null) => id ? (profileNames[id] ?? '—') : '—';

  return (
    <View style={styles.flex}>
      <Header />

      <View style={styles.tabRow}>
        {tabs.map(tab => (
          <TouchableOpacity key={tab.key} style={[styles.tab, activeTab === tab.key && styles.tabActive]} onPress={() => setActiveTab(tab.key)}>
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
            {tab.count > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{tab.count}</Text></View>}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, contentMaxWidth != null && { alignSelf: 'center', width: '100%', maxWidth: contentMaxWidth }]}>
        <Text style={styles.sectionHead}>
          {activeTab === 'mtn' ? 'Daftar MTN' : activeTab === 'perubahan' ? 'Catatan Perubahan' : 'Permintaan Material'}
        </Text>

        {activeTab === 'mtn' && (
          <>
            {renderFilterChips(
              [
                { key: 'ALL', label: 'Semua', count: mtnCounts.ALL },
                { key: 'AWAITING', label: 'Awaiting', count: mtnCounts.AWAITING },
                { key: 'APPROVED', label: 'Approved', count: mtnCounts.APPROVED },
                { key: 'REJECTED', label: 'Rejected', count: mtnCounts.REJECTED },
                { key: 'RECEIVED', label: 'Received', count: mtnCounts.RECEIVED },
              ],
              mtnFilter,
              setMtnFilter,
            )}

            {filteredMtns.length === 0 ? (
              <Card><Text style={styles.empty}>{loading ? 'Memuat...' : 'Tidak ada MTN untuk filter ini.'}</Text></Card>
            ) : filteredMtns.map(mtn => (
              <Card key={mtn.id} borderColor={statusFlag(mtn.status) === 'OK' ? COLORS.ok : statusFlag(mtn.status) === 'CRITICAL' ? COLORS.critical : COLORS.warning}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemTitle}>{mtn.material_name}</Text>
                  <Badge flag={statusFlag(mtn.status)} label={mtn.status} />
                </View>
                <Text style={styles.itemSub}>{mtn.quantity}{mtn.unit ? ` ${mtn.unit}` : ''} → {mtn.destination_project}</Text>
                {mtn.reason ? <Text style={styles.itemNote}>{mtn.reason}</Text> : null}
                <Text style={styles.meta}>Pengaju: {actorName(mtn.requested_by)} · {formatDate(mtn.created_at)}</Text>
                {mtn.reviewed_by ? <Text style={styles.meta}>Diproses oleh: {actorName(mtn.reviewed_by)} · {formatDate(mtn.reviewed_at)}</Text> : null}
                {mtn.status === 'AWAITING' && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handleMTN(mtn.id, false)}>
                      <Text style={[styles.actionText, { color: COLORS.critical }]}>Tolak</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => handleMTN(mtn.id, true)}>
                      <Text style={[styles.actionText, { color: '#fff' }]}>Setujui</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Card>
            ))}
          </>
        )}

        {activeTab === 'perubahan' && (
          <>
            {renderFilterChips(
              [
                { key: 'ALL', label: 'Semua', count: changeCounts.ALL },
                { key: 'pending', label: 'Pending', count: changeCounts.pending },
                { key: 'disetujui', label: 'Disetujui', count: changeCounts.disetujui },
                { key: 'selesai', label: 'Selesai', count: changeCounts.selesai },
                { key: 'ditolak', label: 'Ditolak', count: changeCounts.ditolak },
              ],
              perubahanFilter,
              setPerubahanFilter,
            )}

            {filteredChanges.length === 0 ? (
              <Card><Text style={styles.empty}>{loading ? 'Memuat...' : 'Tidak ada catatan perubahan untuk filter ini.'}</Text></Card>
            ) : filteredChanges.map(change => (
              <Card key={change.id} borderColor={statusFlag(change.decision) === 'OK' ? COLORS.ok : statusFlag(change.decision) === 'CRITICAL' ? COLORS.critical : COLORS.warning}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemTitle}>{change.location}</Text>
                  <Badge flag={statusFlag(change.decision)} label={DECISION_LABELS[change.decision as Decision] ?? change.decision} />
                </View>
                <Text style={styles.itemSub}>{change.description}</Text>
                <Text style={styles.meta}>{CHANGE_TYPE_LABELS[change.change_type]} · Impact: {IMPACT_LABELS[change.impact]}{change.is_urgent ? ' · URGENT' : ''}</Text>
                <Text style={styles.meta}>Pelapor: {change.reporter_name ?? actorName(change.reported_by)}</Text>
                {change.boq_code ? <Text style={styles.meta}>BoQ: {change.boq_code}{change.boq_label ? ` — ${change.boq_label}` : ''}</Text> : null}
                {change.mandor_name ? <Text style={styles.meta}>Mandor: {change.mandor_name}</Text> : null}
                {change.est_cost != null ? <Text style={styles.cost}>Est. Biaya: Rp {change.est_cost.toLocaleString('id-ID')}</Text> : null}
                {change.estimator_note ? <Text style={styles.meta}>Catatan review: {change.estimator_note}</Text> : null}
                <Text style={styles.meta}>Dibuat: {formatDate(change.created_at)}</Text>
                {change.reviewed_by ? <Text style={styles.meta}>Diproses oleh: {actorName(change.reviewed_by)} · {formatDate(change.reviewed_at)}</Text> : null}
                {change.decision === 'pending' && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handlePerubahan(change.id, 'ditolak')}>
                      <Text style={[styles.actionText, { color: COLORS.critical }]}>Tolak</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => handlePerubahan(change.id, 'disetujui')}>
                      <Text style={[styles.actionText, { color: '#fff' }]}>Setujui</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {change.decision === 'disetujui' && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => handlePerubahan(change.id, 'selesai')}>
                      <Text style={[styles.actionText, { color: '#fff' }]}>Tandai Selesai</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Card>
            ))}
          </>
        )}

        {activeTab === 'requests' && (
          <>
            {renderFilterChips(
              [
                { key: 'ALL', label: 'Semua', count: requestCounts.ALL },
                { key: 'PENDING', label: 'Pending', count: requestCounts.PENDING },
                { key: 'UNDER_REVIEW', label: 'Review', count: requestCounts.UNDER_REVIEW },
                { key: 'AUTO_HOLD', label: 'Hold', count: requestCounts.AUTO_HOLD },
                { key: 'APPROVED', label: 'Approved', count: requestCounts.APPROVED },
                { key: 'REJECTED', label: 'Rejected', count: requestCounts.REJECTED },
              ],
              requestFilter,
              setRequestFilter,
            )}

            {filteredRequests.length === 0 ? (
              <Card><Text style={styles.empty}>{loading ? 'Memuat...' : 'Tidak ada permintaan untuk filter ini.'}</Text></Card>
            ) : filteredRequests.map(request => (
              <Card key={request.id} borderColor={statusFlag(request.overall_status) === 'CRITICAL' ? COLORS.critical : statusFlag(request.overall_status) === 'OK' ? COLORS.ok : COLORS.warning}>
                <View style={styles.itemHeader}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Badge
                      flag={request.overall_flag === 'CRITICAL' ? 'CRITICAL' : request.overall_flag === 'WARNING' || request.overall_flag === 'HIGH' ? 'WARNING' : 'INFO'}
                      label={request.overall_status.replace(/_/g, ' ')}
                    />
                    <Text style={styles.itemTitle}>{describeRequestScope(request, boqLabels)}</Text>
                  </View>
                  <Text style={styles.meta}>{formatDate(request.created_at)}</Text>
                </View>
                <Text style={styles.itemSub}>Target: {request.target_date} · Urgensi: {request.urgency}</Text>
                {(request.material_request_lines ?? []).map(line => {
                  const envelope = line.material_id ? envelopeMap.get(line.material_id) ?? null : null;
                  const firstAllocation = line.material_request_line_allocations?.find(
                    (a) => a.boq_item_id && a.allocation_basis === 'DIRECT',
                  );
                  const boqItem = firstAllocation?.boq_item_id ? boqItemMap.get(firstAllocation.boq_item_id) ?? null : null;
                  return (
                    <View key={line.id} style={{ marginTop: SPACE.sm }}>
                      <Text style={styles.itemSub}>
                        {getLineMaterialName(line)} — {line.quantity} {line.unit}{' '}
                        <Text style={styles.meta}>(Tier {line.tier})</Text>
                      </Text>
                      <MaterialUsagePanel
                        materialId={line.material_id}
                        customMaterialName={line.custom_material_name}
                        tier={line.tier}
                        requestedQuantity={line.quantity}
                        requestedUnit={line.unit}
                        boqItemId={firstAllocation?.boq_item_id ?? null}
                        envelope={envelope}
                        boqItem={boqItem}
                      />
                    </View>
                  );
                })}
                {request.common_note ? <Text style={styles.itemNote}>{request.common_note}</Text> : null}
                <Text style={styles.meta}>Pengaju: {actorName(request.requested_by)}</Text>
                {request.reviewed_by ? <Text style={styles.meta}>Diproses oleh: {actorName(request.reviewed_by)} · {formatDate(request.reviewed_at)}</Text> : null}
                {(request.overall_status === 'AUTO_HOLD' || request.overall_status === 'PENDING' || request.overall_status === 'UNDER_REVIEW') && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handleRequest(request.id, 'REJECTED')}>
                      <Text style={[styles.actionText, { color: COLORS.critical }]}>Tolak</Text>
                    </TouchableOpacity>
                    {profile?.role === 'principal' && request.overall_status !== 'AUTO_HOLD' && (
                      <TouchableOpacity style={[styles.actionBtn, styles.holdBtn]} onPress={() => handleRequestHold(request.id)}>
                        <Text style={[styles.actionText, { color: COLORS.warning }]}>Tahan</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => handleRequest(request.id, 'APPROVED')}>
                      <Text style={[styles.actionText, { color: '#fff' }]}>Approve / Override</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Card>
            ))}
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
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: COLORS.textSec,
    marginBottom: SPACE.md - 2,
    marginTop: SPACE.xs,
  },
  tabRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs + 2,
    paddingVertical: SPACE.sm + 2,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: {
    backgroundColor: 'rgba(178,159,134,0.12)',
    borderColor: COLORS.borderSub,
  },
  tabText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: COLORS.textSec,
  },
  tabTextActive: { color: COLORS.primary },
  badge: {
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingHorizontal: SPACE.sm - 1,
    paddingVertical: 2,
  },
  badgeText: { fontSize: TYPE.xs - 1, fontFamily: FONTS.bold, color: COLORS.textInverse },
  empty: {
    fontSize: TYPE.base,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    textAlign: 'center',
    paddingVertical: SPACE.md,
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.md - 2 },
  filterChip: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: SPACE.md - 2,
    paddingVertical: SPACE.sm - 1,
    backgroundColor: COLORS.surface,
  },
  filterChipActive: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}15` },
  filterText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  filterTextActive: { color: COLORS.primary },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACE.md - 2,
    marginBottom: SPACE.sm - 2,
  },
  itemTitle: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text, flex: 1, lineHeight: 21 },
  itemSub: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, marginBottom: 4, lineHeight: 18 },
  itemNote: { fontSize: TYPE.sm, fontFamily: FONTS.regular, fontStyle: 'italic', color: COLORS.textSec, marginTop: 4, lineHeight: 18 },
  meta: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  cost: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.primary, marginTop: SPACE.sm - 2 },
  actionRow: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: SPACE.md - 2,
  },
  rejectBtn: { borderColor: COLORS.critical },
  reviewBtn: { borderColor: COLORS.info },
  holdBtn: { borderColor: COLORS.warning },
  approveBtn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  actionText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
