import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Platform, useWindowDimensions, Modal, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header      from '../../workflows/components/Header';
import Card        from '../../workflows/components/Card';
import StatTile    from '../../workflows/components/StatTile';
import Badge       from '../../workflows/components/Badge';
import { useProject } from '../../workflows/hooks/useProject';
import { signOut } from '../../tools/auth';
import { supabase } from '../../tools/supabase';
import { useToast } from '../../workflows/components/Toast';
import {
  createProject, deleteProject, getProjectTeam, listAllProfiles, addUserToProject, removeUserFromProject,
  inviteUser, updateUserRole,
  type TeamMember, type ProfileOption, ROLE_LABELS,
} from '../../tools/projectManagement';
import { COLORS, FONTS, RADIUS, SPACE, TYPE, BREAKPOINTS, MAX_CONTENT_WIDTH } from '../../workflows/theme';
import { getKasbonAging, kasbonStatusLabel } from '../../tools/kasbon';
import type { KasbonAging } from '../../tools/types';
import { formatRp } from '../../tools/opname';

interface PendingCounts {
  perubahan: number;
  mtn: number;
}

interface AIUsageSnapshot {
  totalChats: number;
  activeUsers: number;
  totalTokens: number;
  sonnetChats: number;
  topUserName: string | null;
}

interface TodaySummary {
  progress: number;
  receipts: number;
  attendance: number;
  siteChanges: number;
  activityLog: number;
}

interface TeamActivityItem {
  id: string;
  user_name: string;
  type: string;
  label: string;
  flag: string;
  created_at: string;
}

interface SiteChangeSummary {
  pending_count: number;
  pending_berat: number;
  pending_sedang: number;
  approved_unresolved: number;
  open_rework: number;
  open_quality_notes: number;
  approved_cost_total: number;
  total_count: number;
}

interface FinancialSnapshot {
  opnameThisMonth: number;
  opnameLastMonth: number;
  outstandingPO: number;
  kasbonTotal: number;
}

interface PODetail {
  id: string;
  po_number: string | null;
  supplier: string;
  material_name: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
  status: string;
  ordered_date: string;
}

interface KasbonDetail {
  id: string;
  amount: number;
  kasbon_date: string;
  reason: string | null;
  status: string;
  mandor_name?: string;
}

interface SiteChangeDetail {
  id: string;
  location: string;
  description: string;
  photo_urls: string[];
  change_type: string;
  impact: string;
  is_urgent: boolean;
  decision: string;
  est_cost: number | null;
  cost_bearer: string | null;
  estimator_note: string | null;
  resolution_note: string | null;
  reporter_name?: string;
  created_at: string;
}

export default function PrincipalHomeScreen() {
  const navigation = useNavigation<any>();
  const { projects, project, setActiveProject, profile, boqItems, defects, milestones, purchaseOrders, refresh } = useProject();
  const { show: toast } = useToast();
  const [pending, setPending]       = useState<PendingCounts>({ perubahan: 0, mtn: 0 });
  const [aiUsage, setAiUsage]       = useState<AIUsageSnapshot>({ totalChats: 0, activeUsers: 0, totalTokens: 0, sonnetChats: 0, topUserName: null });
  const [agingKasbon, setAgingKasbon] = useState<KasbonAging[]>([]);
  const [todaySummary, setTodaySummary] = useState<TodaySummary>({ progress: 0, receipts: 0, attendance: 0, siteChanges: 0, activityLog: 0 });
  const [teamActivity, setTeamActivity] = useState<TeamActivityItem[]>([]);
  const [siteChangeSummary, setSiteChangeSummary] = useState<SiteChangeSummary | null>(null);
  const [financialSnapshot, setFinancialSnapshot] = useState<FinancialSnapshot>({ opnameThisMonth: 0, opnameLastMonth: 0, outstandingPO: 0, kasbonTotal: 0 });
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [showPOModal, setShowPOModal] = useState(false);
  const [poDetails, setPODetails] = useState<PODetail[]>([]);
  const [showKasbonModal, setShowKasbonModal] = useState(false);
  const [kasbonDetails, setKasbonDetails] = useState<KasbonDetail[]>([]);
  const [siteChangesList, setSiteChangesList] = useState<SiteChangeDetail[]>([]);
  const [selectedChange, setSelectedChange] = useState<SiteChangeDetail | null>(null);
  const [selectedDefect, setSelectedDefect] = useState<any>(null);
  const [defectsExpanded, setDefectsExpanded] = useState(false);
  const [kasbonExpanded, setKasbonExpanded] = useState(false);
  const [changesExpanded, setChangesExpanded] = useState(false);

  // ── Project & team management ──
  const [homeView, setHomeView] = useState<'dashboard' | 'new_project' | 'manage_team'>('dashboard');
  const [npCode,     setNpCode]     = useState('');
  const [npName,     setNpName]     = useState('');
  const [npLocation, setNpLocation] = useState('');
  const [npClient,   setNpClient]   = useState('');
  const [npStart,    setNpStart]    = useState('');
  const [creating,   setCreating]   = useState(false);
  const [team,        setTeam]        = useState<TeamMember[]>([]);
  const [allProfiles, setAllProfiles] = useState<ProfileOption[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);

  // Invite new user
  const [invEmail,    setInvEmail]    = useState('');
  const [invPassword, setInvPassword] = useState('');
  const [invName,     setInvName]     = useState('');
  const [invRole,     setInvRole]     = useState('supervisor');
  const [inviting,    setInviting]    = useState(false);

  const { width } = useWindowDimensions();
  const isTablet  = width >= BREAKPOINTS.tablet;
  const isDesktop = width >= BREAKPOINTS.desktop;
  const contentMaxWidth = isDesktop ? MAX_CONTENT_WIDTH.desktop : isTablet ? MAX_CONTENT_WIDTH.tablet : undefined;

  useEffect(() => {
    if (!project) return;
    Promise.all([
      supabase
        .from('site_changes')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('decision', 'pending'),
      supabase
        .from('mtn_requests')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('status', 'AWAITING'),
    ]).then(([perubahan, mtn]) => {
      setPending({ perubahan: perubahan.count ?? 0, mtn: mtn.count ?? 0 });
    });
  }, [project]);

  useEffect(() => {
    if (!project) return;

    const loadAIUsage = async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: logs, error } = await supabase
        .from('ai_chat_log')
        .select('user_id, model, input_tokens, output_tokens, created_at')
        .eq('project_id', project.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false });

      if (error || !(logs?.length)) {
        setAiUsage({ totalChats: 0, activeUsers: 0, totalTokens: 0, sonnetChats: 0, topUserName: null });
        return;
      }

      const userIds = Array.from(new Set(logs.map(row => row.user_id).filter(Boolean)));
      const { data: profiles } = userIds.length > 0
        ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
        : { data: [] as Array<{ id: string; full_name: string }> };

      const nameById = new Map((profiles ?? []).map(item => [item.id, item.full_name]));
      const usageByUser = new Map<string, number>();
      let totalTokens = 0;
      let sonnetChats = 0;

      for (const row of logs) {
        const tokens = Number(row.input_tokens ?? 0) + Number(row.output_tokens ?? 0);
        totalTokens += tokens;
        if (row.model === 'sonnet') sonnetChats += 1;
        usageByUser.set(row.user_id, (usageByUser.get(row.user_id) ?? 0) + tokens);
      }

      const topUser = Array.from(usageByUser.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      setAiUsage({
        totalChats: logs.length,
        activeUsers: usageByUser.size,
        totalTokens,
        sonnetChats,
        topUserName: topUser ? (nameById.get(topUser) ?? 'User') : null,
      });
    };

    loadAIUsage();
  }, [project]);

  useEffect(() => {
    if (!project) return;
    getKasbonAging(project.id).then(data => {
      setAgingKasbon(data.filter(k => k.opname_cycles_since >= 2));
    });
  }, [project]);

  // ── Section 1: Ringkasan Hari Ini ──
  useEffect(() => {
    if (!project) return;
    const today = new Date().toISOString().slice(0, 10);
    const todayStart = `${today}T00:00:00`;
    const todayEnd = `${today}T23:59:59`;

    Promise.all([
      supabase.from('progress_entries').select('id', { count: 'exact', head: true })
        .eq('project_id', project.id).gte('created_at', todayStart).lte('created_at', todayEnd),
      supabase.from('receipts').select('id', { count: 'exact', head: true })
        .eq('project_id', project.id).gte('created_at', todayStart).lte('created_at', todayEnd),
      supabase.from('worker_attendance_entries').select('id', { count: 'exact', head: true })
        .eq('project_id', project.id).eq('attendance_date', today),
      supabase.from('site_changes').select('id', { count: 'exact', head: true })
        .eq('project_id', project.id).gte('created_at', todayStart).lte('created_at', todayEnd),
      supabase.from('activity_log').select('id', { count: 'exact', head: true })
        .eq('project_id', project.id).gte('created_at', todayStart).lte('created_at', todayEnd),
    ]).then(([pe, rc, at, sc, al]) => {
      setTodaySummary({
        progress: pe.count ?? 0,
        receipts: rc.count ?? 0,
        attendance: at.count ?? 0,
        siteChanges: sc.count ?? 0,
        activityLog: al.count ?? 0,
      });
    });
  }, [project]);

  // ── Section 3: Aktivitas Tim ──
  useEffect(() => {
    if (!project) return;
    const since = new Date(Date.now() - 7 * 86400000).toISOString();

    supabase
      .from('activity_log')
      .select('id, user_id, type, label, flag, created_at')
      .eq('project_id', project.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(async ({ data: logs }) => {
        if (!logs?.length) { setTeamActivity([]); return; }
        const userIds = [...new Set(logs.map(l => l.user_id))];
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
        const nameMap = new Map((profiles ?? []).map(p => [p.id, p.full_name]));
        setTeamActivity(logs.map(l => ({
          id: l.id,
          user_name: nameMap.get(l.user_id) ?? 'User',
          type: l.type,
          label: l.label,
          flag: l.flag,
          created_at: l.created_at,
        })));
      });
  }, [project]);

  // ── Section 5: Status Keuangan ──
  useEffect(() => {
    if (!project) return;
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

    Promise.all([
      supabase.from('opname_headers').select('gross_total')
        .eq('project_id', project.id).gte('opname_date', thisMonthStart),
      supabase.from('opname_headers').select('gross_total')
        .eq('project_id', project.id).gte('opname_date', lastMonthStart).lte('opname_date', lastMonthEnd),
      supabase.from('purchase_orders').select('quantity, unit_price')
        .eq('project_id', project.id).in('status', ['OPEN', 'PARTIAL_RECEIVED']),
      supabase.from('mandor_kasbon').select('amount')
        .eq('project_id', project.id).in('status', ['REQUESTED', 'APPROVED']),
    ]).then(([opThis, opLast, pos, kasbon]) => {
      setFinancialSnapshot({
        opnameThisMonth: (opThis.data ?? []).reduce((s, r) => s + Number(r.gross_total ?? 0), 0),
        opnameLastMonth: (opLast.data ?? []).reduce((s, r) => s + Number(r.gross_total ?? 0), 0),
        outstandingPO: (pos.data ?? []).reduce((s, r) => s + (Number(r.quantity ?? 0) * Number(r.unit_price ?? 0)), 0),
        kasbonTotal: (kasbon.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0),
      });
    });
  }, [project]);

  // ── Section 8: Catatan Perubahan (summary + list) ──
  useEffect(() => {
    if (!project) return;
    supabase
      .from('v_site_change_summary')
      .select('*')
      .eq('project_id', project.id)
      .single()
      .then(({ data }) => {
        if (data) setSiteChangeSummary(data as SiteChangeSummary);
      });

    supabase
      .from('site_changes')
      .select('id, location, description, photo_urls, change_type, impact, is_urgent, decision, est_cost, cost_bearer, estimator_note, resolution_note, reported_by, created_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(async ({ data: changes }) => {
        if (!changes?.length) { setSiteChangesList([]); return; }
        const reporterIds = [...new Set(changes.map(c => c.reported_by))];
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', reporterIds);
        const nameMap = new Map((profiles ?? []).map(p => [p.id, p.full_name]));
        setSiteChangesList(changes.map(c => ({
          ...c,
          reporter_name: nameMap.get(c.reported_by) ?? 'User',
        })));
      });
  }, [project]);

  // ── Detail loaders for modals ──
  const loadPODetails = useCallback(async () => {
    if (!project) return;
    const { data } = await supabase
      .from('purchase_orders')
      .select('id, po_number, supplier, material_name, quantity, unit, unit_price, status, ordered_date')
      .eq('project_id', project.id)
      .in('status', ['OPEN', 'PARTIAL_RECEIVED'])
      .order('ordered_date', { ascending: false });
    setPODetails((data ?? []) as PODetail[]);
    setShowPOModal(true);
  }, [project]);

  const loadKasbonDetails = useCallback(async () => {
    if (!project) return;
    const { data } = await supabase
      .from('mandor_kasbon')
      .select('id, amount, kasbon_date, reason, status, contract_id')
      .eq('project_id', project.id)
      .in('status', ['REQUESTED', 'APPROVED'])
      .order('kasbon_date', { ascending: false });
    if (!data?.length) { setKasbonDetails([]); setShowKasbonModal(true); return; }
    const contractIds = [...new Set(data.map(k => k.contract_id))];
    const { data: contracts } = await supabase
      .from('mandor_contracts')
      .select('id, mandor_name')
      .in('id', contractIds);
    const nameMap = new Map((contracts ?? []).map(c => [c.id, c.mandor_name]));
    setKasbonDetails(data.map(k => ({
      id: k.id,
      amount: k.amount,
      kasbon_date: k.kasbon_date,
      reason: k.reason,
      status: k.status,
      mandor_name: nameMap.get(k.contract_id) ?? '—',
    })));
    setShowKasbonModal(true);
  }, [project]);

  // ── Team management handlers ──
  const loadTeam = useCallback(async () => {
    if (!project) return;
    setLoadingTeam(true);
    const [members, profiles] = await Promise.all([
      getProjectTeam(project.id),
      listAllProfiles(),
    ]);
    setTeam(members);
    setAllProfiles(profiles);
    setLoadingTeam(false);
  }, [project]);

  useEffect(() => {
    if (homeView === 'manage_team') loadTeam();
  }, [homeView, project?.id, loadTeam]);

  const handleCreateProject = async () => {
    if (!npCode.trim() || !npName.trim()) {
      toast('Kode proyek dan nama wajib diisi', 'critical'); return;
    }
    setCreating(true);
    const { data, error } = await createProject({
      code: npCode, name: npName,
      location:  npLocation || undefined,
      clientName: npClient  || undefined,
      startDate: npStart    || undefined,
    });
    setCreating(false);
    if (error) { toast(error, 'critical'); return; }
    toast(`Proyek ${data!.code} berhasil dibuat`, 'ok');
    setNpCode(''); setNpName(''); setNpLocation(''); setNpClient(''); setNpStart('');
    await refresh();
    setHomeView('dashboard');
  };

  const handleDeleteProject = async (projectId: string, projectName: string) => {
    const runDelete = async () => {
      const { error } = await deleteProject(projectId);
      if (error) { toast(error, 'critical'); return; }
      toast(`Proyek ${projectName} dihapus`, 'ok');
      await refresh();
    };
    const warning = `Menghapus "${projectName}" akan menghapus semua BoQ, AHS, milestone, PO, dan data terkait. Tindakan ini tidak bisa di-undo.`;
    if (Platform.OS === 'web') {
      if (window.confirm(`${warning}\n\nLanjutkan?`)) await runDelete();
    } else {
      Alert.alert('Hapus Proyek', warning, [
        { text: 'Batal', style: 'cancel' },
        { text: 'Hapus', style: 'destructive', onPress: runDelete },
      ]);
    }
  };

  const handleAddUser = async (userId: string) => {
    if (!project) return;
    const { error } = await addUserToProject(project.id, userId);
    if (error) { toast(error, 'critical'); return; }
    toast('Anggota ditambahkan', 'ok');
    await loadTeam();
  };

  const handleRemoveUser = async (assignmentId: string, name: string) => {
    if (Platform.OS === 'web') {
      if (!window.confirm(`Hapus ${name} dari proyek?`)) return;
      const { error } = await removeUserFromProject(assignmentId);
      if (error) toast(error, 'critical');
      else { toast('Anggota dihapus', 'ok'); await loadTeam(); }
    } else {
      Alert.alert('Hapus Anggota', `Hapus ${name} dari proyek ini?`, [
        { text: 'Batal', style: 'cancel' },
        { text: 'Hapus', style: 'destructive', onPress: async () => {
          const { error } = await removeUserFromProject(assignmentId);
          if (error) toast(error, 'critical');
          else { toast('Anggota dihapus', 'ok'); await loadTeam(); }
        }},
      ]);
    }
  };

  const handleInviteUser = async () => {
    if (!invEmail.trim() || !invPassword.trim() || !invName.trim()) {
      toast('Email, password, dan nama wajib diisi', 'critical'); return;
    }
    if (invPassword.length < 6) {
      toast('Password minimal 6 karakter', 'critical'); return;
    }
    setInviting(true);
    const { error } = await inviteUser({
      email: invEmail.trim(),
      password: invPassword,
      full_name: invName.trim(),
      role: invRole,
      project_id: project?.id,
    });
    setInviting(false);
    if (error) { toast(error, 'critical'); return; }
    toast(`${invName.trim()} berhasil didaftarkan sebagai ${ROLE_LABELS[invRole]}`, 'ok');
    setInvEmail(''); setInvPassword(''); setInvName(''); setInvRole('supervisor');
    await loadTeam();
  };

  const handleChangeRole = async (userId: string, name: string, newRole: string) => {
    const { error } = await updateUserRole(userId, newRole);
    if (error) { toast(error, 'critical'); return; }
    toast(`Role ${name} diubah ke ${ROLE_LABELS[newRole]}`, 'ok');
    await loadTeam();
  };

  // ── Computed KPIs ────────────────────────────────────────────────────
  const overallProgress = boqItems.length > 0
    ? Math.round(boqItems.reduce((s, b) => s + b.progress, 0) / boqItems.length)
    : 0;

  const overProgressItems = boqItems.filter(b => b.progress > 100);

  const criticalDefects = defects.filter(
    d => d.severity === 'Critical' && !['VERIFIED', 'ACCEPTED_BY_PRINCIPAL'].includes(d.status),
  );
  const majorDefects = defects.filter(
    d => d.severity === 'Major' && ['OPEN', 'VALIDATED', 'IN_REPAIR'].includes(d.status),
  );
  const handoverEligible = criticalDefects.length === 0 && majorDefects.length === 0;

  const delayedMilestones = milestones.filter(m => m.status === 'DELAYED');
  const atRiskMilestones = milestones.filter(m => m.status === 'AT_RISK');
  const totalRisk = delayedMilestones.length + atRiskMilestones.length;

  const openPOs = purchaseOrders.filter(po => po.status === 'OPEN' || po.status === 'PARTIAL_RECEIVED').length;
  const totalPending = pending.perubahan + pending.mtn;

  const allClear =
    criticalDefects.length === 0 &&
    majorDefects.length === 0 &&
    totalRisk === 0 &&
    totalPending === 0 &&
    overProgressItems.length === 0;

  // ── JSX fragments ────────────────────────────────────────────────────
  const canDeleteProjects = profile?.role === 'principal' || profile?.role === 'admin';
  const projectSelectorCard = projects.length >= 1 ? (
    <Card title="Proyek Aktif">
      {projects.map(p => (
        <View
          key={p.id}
          style={[styles.projectRow, p.id === project?.id && styles.projectRowActive]}
        >
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
            onPress={() => setActiveProject(p.id)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.projectCode}>{p.code}</Text>
              <Text style={styles.projectName}>{p.name}</Text>
            </View>
            {p.id === project?.id && (
              <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
            )}
          </TouchableOpacity>
          {canDeleteProjects && (
            <TouchableOpacity
              style={styles.projectDeleteBtn}
              onPress={() => handleDeleteProject(p.id, p.name)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={18} color={COLORS.critical} />
            </TouchableOpacity>
          )}
        </View>
      ))}
    </Card>
  ) : null;

  const statRowBlock = (
    <View style={styles.statRow}>
      <StatTile value={`${overallProgress}%`} label="Progress" color={COLORS.accent} />
      <StatTile value={criticalDefects.length} label="Critical" color={COLORS.critical} />
      <StatTile value={totalRisk} label="Risiko Jadwal" color={COLORS.warning} />
    </View>
  );

  const allClearCard = allClear ? (
    <Card borderColor={COLORS.ok}>
      <View style={[styles.bannerBox, { backgroundColor: 'rgba(76,175,80,0.08)' }]}>
        <Ionicons name="checkmark-circle" size={20} color={COLORS.ok} />
        <Text style={[styles.bannerText, { color: COLORS.ok }]}>
          Semua indikator aman — tidak ada sorotan khusus saat ini.
        </Text>
      </View>
    </Card>
  ) : null;

  const pendingCard = totalPending > 0 ? (
    <Card title={`${totalPending} Persetujuan Menunggu`} borderColor={COLORS.warning}>
      {pending.perubahan > 0 && (
        <View style={styles.excRow}>
          <Ionicons name="create" size={16} color={COLORS.accent} />
          <Text style={styles.excText}>{pending.perubahan} catatan perubahan menunggu review</Text>
        </View>
      )}
      {pending.mtn > 0 && (
        <View style={styles.excRow}>
          <Ionicons name="swap-horizontal" size={16} color={COLORS.info} />
          <Text style={styles.excText}>{pending.mtn} MTN menunggu persetujuan</Text>
        </View>
      )}
      <TouchableOpacity style={styles.ghostBtn} onPress={() => navigation.navigate('Approvals')}>
        <Text style={styles.ghostBtnText}>Tinjau Semua →</Text>
      </TouchableOpacity>
    </Card>
  ) : null;

  const EXPAND_MAX_H = 420;

  const allOpenDefects = [
    ...criticalDefects.map(d => ({ ...d, _severity: 'Critical' as const })),
    ...majorDefects.map(d => ({ ...d, _severity: 'Major' as const })),
  ];
  const DEFECT_PREVIEW = 3;
  const hasMoreDefects = allOpenDefects.length > DEFECT_PREVIEW;

  const renderDefectRow = (d: typeof allOpenDefects[0]) => (
    <TouchableOpacity key={d.id} style={styles.excRow} onPress={() => setSelectedDefect(d)} activeOpacity={0.7}>
      <Ionicons
        name={d._severity === 'Critical' ? 'alert-circle' : 'warning'}
        size={16}
        color={d._severity === 'Critical' ? COLORS.critical : COLORS.warning}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.excText}>{d.description ?? d.id}</Text>
        <Text style={styles.excMeta}>{d.location ?? ''}</Text>
      </View>
      <Badge flag={d._severity === 'Critical' ? 'CRITICAL' : 'WARNING'} label={d.status} />
      <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
    </TouchableOpacity>
  );

  const defectsCard = allOpenDefects.length > 0 ? (
    <Card
      title={`${allOpenDefects.length} Perubahan Memblokir / Belum Selesai`}
      borderColor={criticalDefects.length > 0 ? COLORS.critical : COLORS.warning}
    >
      {defectsExpanded ? (
        <View style={{ maxHeight: EXPAND_MAX_H }}>
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
            {allOpenDefects.map(renderDefectRow)}
          </ScrollView>
        </View>
      ) : (
        allOpenDefects.slice(0, DEFECT_PREVIEW).map(renderDefectRow)
      )}
      {hasMoreDefects && (
        <TouchableOpacity style={styles.expandBtn} onPress={() => setDefectsExpanded(!defectsExpanded)}>
          <Ionicons name={defectsExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.accent} />
          <Text style={styles.expandBtnText}>
            {defectsExpanded ? 'Tutup' : `Lihat ${allOpenDefects.length - DEFECT_PREVIEW} lainnya`}
          </Text>
        </TouchableOpacity>
      )}
    </Card>
  ) : null;

  const KASBON_PREVIEW = 3;
  const hasMoreKasbon = agingKasbon.length > KASBON_PREVIEW;

  const renderKasbonRow = (k: KasbonAging) => (
    <View key={k.id} style={styles.excRow}>
      <Ionicons name="cash-outline" size={16} color={COLORS.warning} />
      <View style={{ flex: 1 }}>
        <Text style={styles.excText}>
          {k.mandor_name}: {formatRp(k.amount)}
        </Text>
        <Text style={styles.excMeta}>
          {k.age_days} hari · {k.opname_cycles_since} siklus opname · {kasbonStatusLabel(k.status)}
        </Text>
      </View>
    </View>
  );

  const agingKasbonCard = agingKasbon.length > 0 ? (
    <Card title={`${agingKasbon.length} Kasbon Belum Terpotong`} borderColor={COLORS.warning}>
      {kasbonExpanded ? (
        <View style={{ maxHeight: EXPAND_MAX_H }}>
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
            {agingKasbon.map(renderKasbonRow)}
          </ScrollView>
        </View>
      ) : (
        agingKasbon.slice(0, KASBON_PREVIEW).map(renderKasbonRow)
      )}
      {hasMoreKasbon && (
        <TouchableOpacity style={styles.expandBtn} onPress={() => setKasbonExpanded(!kasbonExpanded)}>
          <Ionicons name={kasbonExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.accent} />
          <Text style={styles.expandBtnText}>
            {kasbonExpanded ? 'Tutup' : `Lihat ${agingKasbon.length - KASBON_PREVIEW} lainnya`}
          </Text>
        </TouchableOpacity>
      )}
    </Card>
  ) : null;

  const handoverCard = (
    <Card title="Status Serah Terima" borderColor={handoverEligible ? COLORS.ok : COLORS.critical}>
      <View style={[styles.eligibleBox, { backgroundColor: handoverEligible ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.08)' }]}>
        <Text style={[styles.eligibleLabel, { color: handoverEligible ? COLORS.ok : COLORS.critical }]}>
          {handoverEligible ? 'ELIGIBLE — Siap Serah Terima' : 'BELUM ELIGIBLE'}
        </Text>
        <Text style={styles.hint}>
          {handoverEligible
            ? 'Semua Critical dan Major telah diselesaikan.'
            : `${criticalDefects.length} Critical, ${majorDefects.length} Major masih open.`}
        </Text>
      </View>
    </Card>
  );

  const scheduleCard = (delayedMilestones.length > 0 || atRiskMilestones.length > 0) ? (
    <Card title="Sorotan Jadwal" borderColor={delayedMilestones.length > 0 ? COLORS.critical : COLORS.warning}>
      {delayedMilestones.map(m => (
        <View key={m.id} style={styles.milestoneRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.milestoneLabel}>{m.label}</Text>
            <Text style={styles.hint}>Rencana: {new Date(m.planned_date).toLocaleDateString('id-ID')}</Text>
          </View>
          <Badge flag="CRITICAL" label="DELAYED" />
        </View>
      ))}
      {atRiskMilestones.map(m => (
        <View key={m.id} style={styles.milestoneRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.milestoneLabel}>{m.label}</Text>
            <Text style={styles.hint}>Rencana: {new Date(m.planned_date).toLocaleDateString('id-ID')}</Text>
          </View>
          <Badge flag="WARNING" label="AT RISK" />
        </View>
      ))}
    </Card>
  ) : null;

  const overProgressCard = overProgressItems.length > 0 ? (
    <Card title={`${overProgressItems.length} Item Melebihi 100% (Anomali)`} borderColor={COLORS.critical}>
      {overProgressItems.slice(0, 4).map(b => (
        <View key={b.id} style={styles.excRow}>
          <Ionicons name="trending-up" size={16} color={COLORS.critical} />
          <Text style={[styles.excText, { flex: 1 }]}>{(b as any).code ?? b.id} — {(b as any).description ?? ''}</Text>
          <Text style={styles.criticalProgress}>{b.progress}%</Text>
        </View>
      ))}
    </Card>
  ) : null;

  // ── Section 1: Ringkasan Hari Ini ──
  const todayTotal = todaySummary.progress + todaySummary.receipts + todaySummary.attendance + todaySummary.siteChanges;
  const todayPulseCard = (
    <Card title="Ringkasan Hari Ini" subtitle={new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
      {todayTotal === 0 ? (
        <Text style={styles.hint}>Belum ada aktivitas tercatat hari ini.</Text>
      ) : (
        <View style={styles.todayGrid}>
          <View style={styles.todayTile}>
            <Ionicons name="construct-outline" size={18} color={COLORS.accent} />
            <Text style={styles.todayValue}>{todaySummary.progress}</Text>
            <Text style={styles.todayLabel}>Progres</Text>
          </View>
          <View style={styles.todayTile}>
            <Ionicons name="cube-outline" size={18} color={COLORS.info} />
            <Text style={styles.todayValue}>{todaySummary.receipts}</Text>
            <Text style={styles.todayLabel}>Penerimaan</Text>
          </View>
          <View style={styles.todayTile}>
            <Ionicons name="people-outline" size={18} color={COLORS.ok} />
            <Text style={styles.todayValue}>{todaySummary.attendance}</Text>
            <Text style={styles.todayLabel}>Absensi</Text>
          </View>
          <View style={styles.todayTile}>
            <Ionicons name="create-outline" size={18} color={COLORS.warning} />
            <Text style={styles.todayValue}>{todaySummary.siteChanges}</Text>
            <Text style={styles.todayLabel}>Perubahan</Text>
          </View>
        </View>
      )}
      <Text style={[styles.hint, { marginTop: SPACE.sm }]}>
        {todaySummary.activityLog} total entri log aktivitas hari ini.
      </Text>
    </Card>
  );

  // ── Section 3: Aktivitas Tim ──
  const ACTIVITY_ICON: Record<string, { icon: string; color: string }> = {
    progress:  { icon: 'construct-outline', color: COLORS.accent },
    receipt:   { icon: 'cube-outline', color: COLORS.info },
    defect:    { icon: 'alert-circle-outline', color: COLORS.critical },
    vo:        { icon: 'swap-horizontal-outline', color: COLORS.warning },
    opname:    { icon: 'calculator-outline', color: COLORS.ok },
    attendance:{ icon: 'people-outline', color: COLORS.ok },
    mtn:       { icon: 'arrow-forward-outline', color: COLORS.info },
  };

  const formatRelativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m lalu`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}j lalu`;
    const days = Math.floor(hrs / 24);
    return `${days}h lalu`;
  };

  const ACTIVITY_PREVIEW_COUNT = 5;
  const hasMoreActivity = teamActivity.length > ACTIVITY_PREVIEW_COUNT;

  const renderActivityRow = (a: TeamActivityItem) => {
    const cfg = ACTIVITY_ICON[a.type] ?? { icon: 'ellipse-outline', color: COLORS.textSec };
    return (
      <View key={a.id} style={styles.activityRow}>
        <View style={[styles.activityDot, { backgroundColor: cfg.color }]}>
          <Ionicons name={cfg.icon as any} size={14} color={COLORS.surface} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.activityUser}>{a.user_name}</Text>
          <Text style={styles.activityLabel} numberOfLines={2}>{a.label}</Text>
          <Text style={styles.activityTimeSub}>
            {new Date(a.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} · {formatRelativeTime(a.created_at)}
          </Text>
        </View>
      </View>
    );
  };

  const teamActivityCard = (
    <Card title="Aktivitas Tim" subtitle={`${teamActivity.length} entri · 7 hari terakhir`}>
      {teamActivity.length === 0 ? (
        <Text style={styles.hint}>Belum ada aktivitas tercatat dalam 7 hari terakhir.</Text>
      ) : (
        <>
          {activityExpanded ? (
            <View style={{ maxHeight: EXPAND_MAX_H }}>
              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
                {teamActivity.map(renderActivityRow)}
              </ScrollView>
            </View>
          ) : (
            teamActivity.slice(0, ACTIVITY_PREVIEW_COUNT).map(renderActivityRow)
          )}
          {hasMoreActivity && (
            <TouchableOpacity
              style={styles.expandBtn}
              onPress={() => setActivityExpanded(!activityExpanded)}
            >
              <Ionicons
                name={activityExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={COLORS.accent}
              />
              <Text style={styles.expandBtnText}>
                {activityExpanded ? 'Tutup' : `Lihat ${teamActivity.length - ACTIVITY_PREVIEW_COUNT} aktivitas lainnya`}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </Card>
  );

  // ── Section 5: Status Keuangan ──
  const opnameDelta = financialSnapshot.opnameLastMonth > 0
    ? Math.round(((financialSnapshot.opnameThisMonth - financialSnapshot.opnameLastMonth) / financialSnapshot.opnameLastMonth) * 100)
    : 0;

  const financialCard = (
    <Card title="Status Keuangan" subtitle="Ringkasan bulan berjalan">
      <View style={styles.finGrid}>
        <View style={styles.finTile}>
          <Text style={styles.finLabel}>Opname Bulan Ini</Text>
          <Text style={styles.finValue}>{formatRp(financialSnapshot.opnameThisMonth)}</Text>
          {financialSnapshot.opnameLastMonth > 0 && (
            <Text style={[styles.finDelta, { color: opnameDelta >= 0 ? COLORS.ok : COLORS.critical }]}>
              {opnameDelta >= 0 ? '↑' : '↓'} {Math.abs(opnameDelta)}% vs bulan lalu
            </Text>
          )}
        </View>
        <View style={styles.finTile}>
          <Text style={styles.finLabel}>Opname Bulan Lalu</Text>
          <Text style={styles.finValue}>{formatRp(financialSnapshot.opnameLastMonth)}</Text>
        </View>
      </View>
      <View style={styles.finGrid}>
        <TouchableOpacity style={styles.finTileTap} onPress={loadPODetails} activeOpacity={0.7}>
          <Text style={styles.finLabel}>PO Outstanding</Text>
          <Text style={styles.finValue}>{formatRp(financialSnapshot.outstandingPO)}</Text>
          <View style={styles.finTapHint}>
            <Text style={styles.hint}>{openPOs} PO aktif</Text>
            <Ionicons name="chevron-forward" size={12} color={COLORS.textMuted} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.finTileTap} onPress={loadKasbonDetails} activeOpacity={0.7}>
          <Text style={styles.finLabel}>Kasbon Outstanding</Text>
          <Text style={[styles.finValue, financialSnapshot.kasbonTotal > 0 ? { color: COLORS.warning } : null]}>
            {formatRp(financialSnapshot.kasbonTotal)}
          </Text>
          <View style={styles.finTapHint}>
            {agingKasbon.length > 0 ? (
              <Text style={[styles.hint, { color: COLORS.warning }]}>{agingKasbon.length} aging</Text>
            ) : (
              <Text style={styles.hint}>Lihat detail</Text>
            )}
            <Ionicons name="chevron-forward" size={12} color={COLORS.textMuted} />
          </View>
        </TouchableOpacity>
      </View>
    </Card>
  );

  // ── Section 6: Progres vs Jadwal ──
  const completedMilestones = milestones.filter(m => m.status === 'COMPLETE');
  const progressVsScheduleCard = (
    <Card title="Progres vs Jadwal">
      <View style={styles.progressBarWrap}>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${Math.min(overallProgress, 100)}%` }]} />
        </View>
        <Text style={styles.progressBarPct}>{overallProgress}%</Text>
      </View>
      <View style={styles.finGrid}>
        <View style={styles.milestoneStat}>
          <Text style={styles.milestoneStatValue}>{completedMilestones.length}/{milestones.length}</Text>
          <Text style={styles.hint}>Milestone selesai</Text>
        </View>
        <View style={styles.milestoneStat}>
          <Text style={[styles.milestoneStatValue, delayedMilestones.length > 0 ? { color: COLORS.critical } : null]}>
            {delayedMilestones.length}
          </Text>
          <Text style={styles.hint}>Terlambat</Text>
        </View>
        <View style={styles.milestoneStat}>
          <Text style={[styles.milestoneStatValue, atRiskMilestones.length > 0 ? { color: COLORS.warning } : null]}>
            {atRiskMilestones.length}
          </Text>
          <Text style={styles.hint}>Berisiko</Text>
        </View>
        <View style={styles.milestoneStat}>
          <Text style={[styles.milestoneStatValue, overProgressItems.length > 0 ? { color: COLORS.critical } : null]}>
            {overProgressItems.length}
          </Text>
          <Text style={styles.hint}>Over 100%</Text>
        </View>
      </View>
      {delayedMilestones.length > 0 && (
        <>
          <Text style={[styles.sectionHeadInline, { marginTop: SPACE.md }]}>Milestone Terlambat</Text>
          {delayedMilestones.slice(0, 3).map(m => (
            <View key={m.id} style={styles.milestoneRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.milestoneLabel}>{m.label}</Text>
                <Text style={styles.hint}>Rencana: {new Date(m.planned_date).toLocaleDateString('id-ID')}</Text>
              </View>
              <Badge flag="CRITICAL" label="DELAYED" />
            </View>
          ))}
        </>
      )}
    </Card>
  );

  // ── Section 8: Catatan Perubahan ──
  const CHANGE_TYPE_LABELS: Record<string, string> = {
    permintaan_owner: 'Permintaan Owner',
    kondisi_lapangan: 'Kondisi Lapangan',
    rework: 'Rework',
    revisi_desain: 'Revisi Desain',
    catatan_mutu: 'Catatan Mutu',
  };
  const IMPACT_BADGE: Record<string, { label: string; color: string; bg: string }> = {
    berat:  { label: 'Berat', color: COLORS.critical, bg: COLORS.criticalBg },
    sedang: { label: 'Sedang', color: COLORS.warning, bg: COLORS.warningBg },
    ringan: { label: 'Ringan', color: COLORS.ok, bg: COLORS.okBg },
  };
  const DECISION_LABEL: Record<string, string> = {
    pending: 'Menunggu', disetujui: 'Disetujui', ditolak: 'Ditolak', selesai: 'Selesai',
  };

  const siteChangesCard = siteChangeSummary && siteChangeSummary.total_count > 0 ? (
    <Card title="Catatan Perubahan" subtitle={`${siteChangeSummary.total_count} total tercatat`}>
      {/* Summary banner */}
      {siteChangeSummary.pending_count > 0 ? (
        <View style={[styles.bannerBox, { backgroundColor: COLORS.warningBg, marginBottom: SPACE.md }]}>
          <Ionicons name="time-outline" size={18} color={COLORS.warning} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerText, { color: COLORS.warning }]}>
              {siteChangeSummary.pending_count} menunggu keputusan
            </Text>
            {(siteChangeSummary.pending_berat > 0 || siteChangeSummary.pending_sedang > 0) && (
              <Text style={styles.hint}>
                {siteChangeSummary.pending_berat > 0 ? `${siteChangeSummary.pending_berat} berat` : ''}
                {siteChangeSummary.pending_berat > 0 && siteChangeSummary.pending_sedang > 0 ? ' · ' : ''}
                {siteChangeSummary.pending_sedang > 0 ? `${siteChangeSummary.pending_sedang} sedang` : ''}
                {siteChangeSummary.approved_unresolved > 0 ? ` · ${siteChangeSummary.approved_unresolved} disetujui belum selesai` : ''}
              </Text>
            )}
          </View>
        </View>
      ) : (
        <View style={[styles.bannerBox, { backgroundColor: COLORS.okBg, marginBottom: SPACE.md }]}>
          <Ionicons name="checkmark-circle" size={18} color={COLORS.ok} />
          <Text style={[styles.bannerText, { color: COLORS.ok }]}>Semua perubahan sudah ditinjau.</Text>
        </View>
      )}

      {/* Compact stats row */}
      <View style={[styles.scCompactRow, { marginBottom: SPACE.md }]}>
        {siteChangeSummary.open_rework > 0 && (
          <View style={styles.scTag}>
            <Ionicons name="refresh-outline" size={12} color={COLORS.warning} />
            <Text style={[styles.scTagText, { color: COLORS.warning }]}>{siteChangeSummary.open_rework} rework</Text>
          </View>
        )}
        {siteChangeSummary.approved_cost_total > 0 && (
          <View style={styles.scTag}>
            <Ionicons name="cash-outline" size={12} color={COLORS.info} />
            <Text style={[styles.scTagText, { color: COLORS.info }]}>Biaya: {formatRp(siteChangeSummary.approved_cost_total)}</Text>
          </View>
        )}
      </View>

      {/* Individual change items — tappable + expandable */}
      {changesExpanded ? (
        <View style={{ maxHeight: EXPAND_MAX_H }}>
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
            {siteChangesList.map(c => {
              const impact = IMPACT_BADGE[c.impact] ?? IMPACT_BADGE.ringan;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={styles.changeRow}
                  onPress={() => setSelectedChange(c)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.changeHeader}>
                      <Text style={styles.changeType}>{CHANGE_TYPE_LABELS[c.change_type] ?? c.change_type}</Text>
                      <View style={[styles.impactBadge, { backgroundColor: impact.bg }]}>
                        <Text style={[styles.impactBadgeText, { color: impact.color }]}>{impact.label}</Text>
                      </View>
                      {c.is_urgent && (
                        <Ionicons name="flame" size={13} color={COLORS.critical} />
                      )}
                    </View>
                    <Text style={styles.changeDesc} numberOfLines={1}>{c.description}</Text>
                    <Text style={styles.hint}>
                      {c.reporter_name} · {c.location} · {DECISION_LABEL[c.decision] ?? c.decision}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        siteChangesList.slice(0, 3).map(c => {
          const impact = IMPACT_BADGE[c.impact] ?? IMPACT_BADGE.ringan;
          return (
            <TouchableOpacity
              key={c.id}
              style={styles.changeRow}
              onPress={() => setSelectedChange(c)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.changeHeader}>
                  <Text style={styles.changeType}>{CHANGE_TYPE_LABELS[c.change_type] ?? c.change_type}</Text>
                  <View style={[styles.impactBadge, { backgroundColor: impact.bg }]}>
                    <Text style={[styles.impactBadgeText, { color: impact.color }]}>{impact.label}</Text>
                  </View>
                  {c.is_urgent && (
                    <Ionicons name="flame" size={13} color={COLORS.critical} />
                  )}
                </View>
                <Text style={styles.changeDesc} numberOfLines={1}>{c.description}</Text>
                <Text style={styles.hint}>
                  {c.reporter_name} · {c.location} · {DECISION_LABEL[c.decision] ?? c.decision}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          );
        })
      )}
      {siteChangesList.length > 3 && (
        <TouchableOpacity style={styles.expandBtn} onPress={() => setChangesExpanded(!changesExpanded)}>
          <Ionicons name={changesExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.accent} />
          <Text style={styles.expandBtnText}>
            {changesExpanded ? 'Tutup' : `Lihat ${siteChangesList.length - 3} perubahan lainnya`}
          </Text>
        </TouchableOpacity>
      )}
    </Card>
  ) : null;

  const aiActivityCard = (
    <Card title="Aktivitas AI Tim" subtitle="Ringkas 30 hari terakhir · hanya usage, bukan isi chat.">
      <View style={styles.aiUsageGrid}>
        <View style={styles.aiUsageTile}>
          <Text style={styles.aiUsageValue}>{aiUsage.totalChats}</Text>
          <Text style={styles.aiUsageLabel}>Total Chat</Text>
        </View>
        <View style={styles.aiUsageTile}>
          <Text style={styles.aiUsageValue}>{aiUsage.activeUsers}</Text>
          <Text style={styles.aiUsageLabel}>User Aktif</Text>
        </View>
        <View style={styles.aiUsageTile}>
          <Text style={styles.aiUsageValue}>{Math.round(aiUsage.totalTokens / 1000)}k</Text>
          <Text style={styles.aiUsageLabel}>Token</Text>
        </View>
      </View>
      <Text style={styles.hint}>
        {aiUsage.totalChats > 0
          ? `${aiUsage.sonnetChats} chat memakai Sonnet.${aiUsage.topUserName ? ` Pengguna terbesar: ${aiUsage.topUserName}.` : ''}`
          : 'Belum ada penggunaan AI pada 30 hari terakhir.'}
      </Text>
      <TouchableOpacity style={styles.ghostBtn} onPress={() => navigation.navigate('Reports')}>
        <Text style={styles.ghostBtnText}>Buka Laporan Penggunaan AI →</Text>
      </TouchableOpacity>
    </Card>
  );

  const quickActionsGrid = (
    <View style={styles.quickGrid}>
      <TouchableOpacity style={styles.qaBtn} onPress={() => navigation.navigate('Approvals')}>
        <View style={[styles.qaIcon, { backgroundColor: `${COLORS.warning}15` }]}>
          <Ionicons name="checkmark-done" size={22} color={COLORS.warning} />
        </View>
        <Text style={styles.qaLabel}>Approval</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.qaBtn} onPress={() => navigation.navigate('Reports')}>
        <View style={[styles.qaIcon, { backgroundColor: `${COLORS.accent}15` }]}>
          <Ionicons name="document-text" size={22} color={COLORS.accent} />
        </View>
        <Text style={styles.qaLabel}>Laporan</Text>
      </TouchableOpacity>
    </View>
  );

  const managementCard = (
    <Card title="Kelola Proyek">
      <Text style={styles.hint}>Buat proyek baru atau kelola tim untuk proyek aktif.</Text>
      <View style={styles.mgmtBtnRow}>
        <TouchableOpacity style={[styles.ghostBtn, styles.mgmtBtn]} onPress={() => setHomeView('new_project')}>
          <Ionicons name="add-circle-outline" size={16} color={COLORS.accent} />
          <Text style={styles.mgmtBtnText}>Buat Proyek</Text>
        </TouchableOpacity>
        {project && (
          <TouchableOpacity style={[styles.ghostBtn, styles.mgmtBtn]} onPress={() => setHomeView('manage_team')}>
            <Ionicons name="people-outline" size={16} color={COLORS.info} />
            <Text style={styles.mgmtBtnText}>Kelola Tim</Text>
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );

  const accountCard = (
    <Card>
      <View style={styles.accountRow}>
        <View>
          <Text style={styles.accountName}>{profile?.full_name ?? '—'}</Text>
          <Text style={styles.hint}>{profile?.role} · {profile?.phone ?? '—'}</Text>
        </View>
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => {
            if (Platform.OS === 'web') {
              if (window.confirm('Yakin ingin keluar?')) signOut();
            } else {
              Alert.alert('Logout', 'Yakin ingin keluar?', [
                { text: 'Batal', style: 'cancel' },
                { text: 'Logout', style: 'destructive', onPress: () => signOut() },
              ]);
            }
          }}
        >
          <Ionicons name="log-out-outline" size={18} color={COLORS.critical} />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.footerHint}>SANO Principal v1.0</Text>
    </Card>
  );

  // ── Sub-views ──────────────────────────────────────────────────────
  const SubHeader = ({ title }: { title: string }) => (
    <View style={styles.subHeader}>
      <TouchableOpacity style={styles.backBtn} onPress={() => setHomeView('dashboard')}>
        <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
        <Text style={styles.backText}>Kembali</Text>
      </TouchableOpacity>
      <Text style={styles.subTitle}>{title}</Text>
    </View>
  );

  if (homeView === 'new_project') {
    return (
      <View style={styles.flex}>
        <Header />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <View style={contentMaxWidth ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' } : undefined}>
            <SubHeader title="Buat Proyek Baru" />
            <Card title="Detail Proyek">
              <Text style={styles.formLabel}>Kode Proyek <Text style={styles.req}>*</Text></Text>
              <TextInput style={styles.input} value={npCode} onChangeText={setNpCode} placeholder="SBY-001" placeholderTextColor={COLORS.textMuted} autoCapitalize="characters" />

              <Text style={styles.formLabel}>Nama Proyek <Text style={styles.req}>*</Text></Text>
              <TextInput style={styles.input} value={npName} onChangeText={setNpName} placeholder="Rumah Tinggal Pak Ahmad" placeholderTextColor={COLORS.textMuted} />

              <Text style={styles.formLabel}>Lokasi</Text>
              <TextInput style={styles.input} value={npLocation} onChangeText={setNpLocation} placeholder="Jl. Merdeka No.12, Surabaya" placeholderTextColor={COLORS.textMuted} />

              <Text style={styles.formLabel}>Nama Klien</Text>
              <TextInput style={styles.input} value={npClient} onChangeText={setNpClient} placeholder="Ahmad Santoso" placeholderTextColor={COLORS.textMuted} />

              <Text style={styles.formLabel}>Tanggal Mulai</Text>
              <TextInput style={styles.input} value={npStart} onChangeText={setNpStart} placeholder="YYYY-MM-DD" placeholderTextColor={COLORS.textMuted} />

              <Text style={styles.formHint}>
                Setelah proyek dibuat, Anda otomatis ditambahkan sebagai anggota. Tambahkan supervisor dan tim lainnya lewat menu Kelola Tim.
              </Text>

              <TouchableOpacity style={styles.primaryBtn} onPress={handleCreateProject} disabled={creating}>
                <Text style={styles.primaryBtnText}>{creating ? 'Membuat...' : 'Buat Proyek'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.ghostBtn, { marginTop: SPACE.sm }]} onPress={() => setHomeView('dashboard')}>
                <Text style={styles.ghostBtnText}>Batal</Text>
              </TouchableOpacity>
            </Card>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (homeView === 'manage_team') {
    const assignedIds = new Set(team.map(m => m.user_id));
    const available   = allProfiles.filter(p => !assignedIds.has(p.id));
    const roleOptions = ['supervisor', 'estimator', 'admin', 'principal'];

    return (
      <View style={styles.flex}>
        <Header />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <View style={contentMaxWidth ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' } : undefined}>
            <SubHeader title="Kelola Tim Proyek" />

            {/* ── Current team ── */}
            <Card title={`Tim — ${project?.name ?? ''}`}>
              {loadingTeam ? (
                <Text style={styles.hint}>Memuat...</Text>
              ) : team.length === 0 ? (
                <Text style={styles.hint}>Belum ada anggota tercatat.</Text>
              ) : (
                team.map(member => (
                  <View key={member.assignment_id} style={styles.memberRow}>
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>
                        {member.full_name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{member.full_name}</Text>
                      {/* Role chips — tap to change */}
                      <View style={styles.roleChipRow}>
                        {roleOptions.map(r => (
                          <TouchableOpacity
                            key={r}
                            style={[styles.roleChip, r === member.role && styles.roleChipActive]}
                            onPress={() => {
                              if (r !== member.role) handleChangeRole(member.user_id, member.full_name, r);
                            }}
                          >
                            <Text style={[styles.roleChipText, r === member.role && styles.roleChipTextActive]}>
                              {ROLE_LABELS[r]}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => handleRemoveUser(member.assignment_id, member.full_name)}
                    >
                      <Ionicons name="person-remove-outline" size={18} color={COLORS.critical} />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </Card>

            {/* ── Add existing user to project ── */}
            {available.length > 0 && (
              <Card title="Tambah Anggota yang Sudah Terdaftar">
                <Text style={styles.hint}>Pengguna ini sudah punya akun, tinggal tambahkan ke proyek.</Text>
                {available.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.addMemberRow}
                    onPress={() => handleAddUser(p.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{p.full_name || '(Tanpa Nama)'}</Text>
                      <Text style={styles.memberRole}>{ROLE_LABELS[p.role] ?? p.role}</Text>
                    </View>
                    <Ionicons name="person-add-outline" size={18} color={COLORS.accent} />
                  </TouchableOpacity>
                ))}
              </Card>
            )}

            {/* ── Invite brand-new user ── */}
            <Card title="Daftarkan Anggota Baru">
              <Text style={styles.hint}>Buat akun baru dan otomatis tambahkan ke proyek ini.</Text>

              <Text style={styles.formLabel}>Nama Lengkap <Text style={styles.req}>*</Text></Text>
              <TextInput style={styles.input} value={invName} onChangeText={setInvName}
                placeholder="Nama Lengkap" placeholderTextColor={COLORS.textMuted} />

              <Text style={styles.formLabel}>Email <Text style={styles.req}>*</Text></Text>
              <TextInput style={styles.input} value={invEmail} onChangeText={setInvEmail}
                placeholder="nama@email.com" placeholderTextColor={COLORS.textMuted}
                keyboardType="email-address" autoCapitalize="none" />

              <Text style={styles.formLabel}>Password <Text style={styles.req}>*</Text></Text>
              <TextInput style={styles.input} value={invPassword} onChangeText={setInvPassword}
                placeholder="Min. 6 karakter" placeholderTextColor={COLORS.textMuted}
                secureTextEntry />

              <Text style={styles.formLabel}>Role</Text>
              <View style={styles.roleChipRow}>
                {roleOptions.map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.roleChip, r === invRole && styles.roleChipActive]}
                    onPress={() => setInvRole(r)}
                  >
                    <Text style={[styles.roleChipText, r === invRole && styles.roleChipTextActive]}>
                      {ROLE_LABELS[r]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.primaryBtn} onPress={handleInviteUser} disabled={inviting}>
                <Text style={styles.primaryBtnText}>{inviting ? 'Mendaftarkan...' : 'Daftarkan & Tambahkan ke Proyek'}</Text>
              </TouchableOpacity>
            </Card>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          contentMaxWidth != null && { alignSelf: 'center', width: '100%', maxWidth: contentMaxWidth },
        ]}
      >
        <Text style={styles.roleTag}>PRINCIPAL DASHBOARD</Text>

        {isDesktop ? (
          <View style={styles.columns}>
            {/* Left: KPIs, today, progress, financial, changes, exceptions */}
            <View style={styles.colLeft}>
              {statRowBlock}
              {todayPulseCard}
              {progressVsScheduleCard}
              {allClearCard}
              {pendingCard}
              {financialCard}
              {defectsCard}
              {agingKasbonCard}
              {siteChangesCard}
              {handoverCard}
              {scheduleCard}
              {overProgressCard}
            </View>
            {/* Right: project selector, team activity, AI, quick actions, account */}
            <View style={styles.colRight}>
              {projectSelectorCard}
              {teamActivityCard}
              {managementCard}
              {aiActivityCard}
              <Text style={styles.sectionHead}>Aksi Cepat</Text>
              {quickActionsGrid}
              {accountCard}
            </View>
          </View>
        ) : (
          <>
            {projectSelectorCard}
            {statRowBlock}
            {todayPulseCard}
            {progressVsScheduleCard}
            {allClearCard}
            {pendingCard}
            {teamActivityCard}
            {financialCard}
            {defectsCard}
            {agingKasbonCard}
            {siteChangesCard}
            {handoverCard}
            {scheduleCard}
            {overProgressCard}
            {managementCard}
            {aiActivityCard}
            <Text style={styles.sectionHead}>Aksi Cepat</Text>
            {quickActionsGrid}
            {accountCard}
          </>
        )}
      </ScrollView>

      {/* ── PO Detail Modal ── */}
      <Modal visible={showPOModal} animationType="slide" onRequestClose={() => setShowPOModal(false)}>
        <View style={styles.flex}>
          <View style={styles.modalBar}>
            <TouchableOpacity onPress={() => setShowPOModal(false)} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.modalBarTitle}>PO Outstanding</Text>
            <View style={{ width: 36 }} />
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {poDetails.length === 0 ? (
              <Text style={styles.hint}>Tidak ada PO outstanding.</Text>
            ) : poDetails.map(po => (
              <View key={po.id} style={styles.detailCard}>
                <View style={styles.detailCardHead}>
                  <Text style={styles.detailCardTitle}>{po.material_name}</Text>
                  <Badge flag={po.status === 'OPEN' ? 'INFO' : 'WARNING'} label={po.status} />
                </View>
                <Text style={styles.hint}>{po.po_number ? `PO ${po.po_number}` : 'No PO#'} · {po.supplier}</Text>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Qty</Text>
                  <Text style={styles.detailVal}>{po.quantity} {po.unit}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Harga Satuan</Text>
                  <Text style={styles.detailVal}>{po.unit_price ? formatRp(po.unit_price) : '—'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Total</Text>
                  <Text style={[styles.detailVal, { fontFamily: FONTS.bold }]}>
                    {po.unit_price ? formatRp(po.quantity * po.unit_price) : '—'}
                  </Text>
                </View>
                <Text style={styles.hint}>Ordered: {new Date(po.ordered_date).toLocaleDateString('id-ID')}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Kasbon Detail Modal ── */}
      <Modal visible={showKasbonModal} animationType="slide" onRequestClose={() => setShowKasbonModal(false)}>
        <View style={styles.flex}>
          <View style={styles.modalBar}>
            <TouchableOpacity onPress={() => setShowKasbonModal(false)} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.modalBarTitle}>Kasbon Outstanding</Text>
            <View style={{ width: 36 }} />
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {kasbonDetails.length === 0 ? (
              <Text style={styles.hint}>Tidak ada kasbon outstanding.</Text>
            ) : kasbonDetails.map(k => (
              <View key={k.id} style={styles.detailCard}>
                <View style={styles.detailCardHead}>
                  <Text style={styles.detailCardTitle}>{formatRp(k.amount)}</Text>
                  <Badge flag={k.status === 'REQUESTED' ? 'WARNING' : 'INFO'} label={kasbonStatusLabel(k.status as any)} />
                </View>
                <Text style={styles.hint}>{k.mandor_name}</Text>
                {k.reason && <Text style={[styles.hint, { marginTop: 4 }]}>Alasan: {k.reason}</Text>}
                <Text style={[styles.hint, { marginTop: 2 }]}>
                  Tanggal: {new Date(k.kasbon_date).toLocaleDateString('id-ID')}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Defect Detail Modal ── */}
      <Modal visible={selectedDefect !== null} animationType="slide" onRequestClose={() => setSelectedDefect(null)}>
        {selectedDefect && (
          <View style={styles.flex}>
            <View style={styles.modalBar}>
              <TouchableOpacity onPress={() => setSelectedDefect(null)} style={styles.modalClose}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.modalBarTitle}>Detail Perubahan</Text>
              <View style={{ width: 36 }} />
            </View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
              {/* Severity + status header */}
              <View style={styles.changeDetailHead}>
                <View style={[styles.impactBadge, {
                  backgroundColor: selectedDefect.severity === 'Critical' ? COLORS.criticalBg : COLORS.warningBg,
                }]}>
                  <Text style={[styles.impactBadgeText, {
                    color: selectedDefect.severity === 'Critical' ? COLORS.critical : COLORS.warning,
                  }]}>{selectedDefect.severity}</Text>
                </View>
                <Badge
                  flag={selectedDefect.severity === 'Critical' ? 'CRITICAL' : 'WARNING'}
                  label={selectedDefect.status}
                />
                {selectedDefect.handover_impact && (
                  <View style={[styles.impactBadge, { backgroundColor: COLORS.criticalBg }]}>
                    <Text style={[styles.impactBadgeText, { color: COLORS.critical }]}>Blokir Serah Terima</Text>
                  </View>
                )}
              </View>

              {/* Description */}
              <Text style={styles.sectionHeadInline}>Deskripsi</Text>
              <Text style={styles.changeDetailDesc}>{selectedDefect.description}</Text>

              {/* Key details */}
              <View style={[styles.detailRow, { marginTop: SPACE.md }]}>
                <Text style={styles.detailLabel}>Lokasi</Text>
                <Text style={styles.detailVal}>{selectedDefect.location}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>BoQ Ref</Text>
                <Text style={styles.detailVal}>{selectedDefect.boq_ref ?? '—'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Pihak Bertanggung Jawab</Text>
                <Text style={styles.detailVal}>{selectedDefect.responsible_party ?? '—'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Dilaporkan</Text>
                <Text style={styles.detailVal}>
                  {new Date(selectedDefect.reported_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>
              </View>
              {selectedDefect.target_resolution_date && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Target Penyelesaian</Text>
                  <Text style={styles.detailVal}>
                    {new Date(selectedDefect.target_resolution_date).toLocaleDateString('id-ID')}
                  </Text>
                </View>
              )}
              {selectedDefect.resolved_at && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Diselesaikan</Text>
                  <Text style={[styles.detailVal, { color: COLORS.ok }]}>
                    {new Date(selectedDefect.resolved_at).toLocaleDateString('id-ID')}
                  </Text>
                </View>
              )}
              {selectedDefect.verified_at && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Diverifikasi</Text>
                  <Text style={[styles.detailVal, { color: COLORS.ok }]}>
                    {new Date(selectedDefect.verified_at).toLocaleDateString('id-ID')}
                  </Text>
                </View>
              )}

              {/* Photos */}
              {(selectedDefect.photo_path || selectedDefect.repair_photo_path) && (
                <>
                  <Text style={[styles.sectionHeadInline, { marginTop: SPACE.md }]}>Foto</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll}>
                    {selectedDefect.photo_path && (
                      <Image source={{ uri: selectedDefect.photo_path }} style={styles.photoThumb} resizeMode="cover" />
                    )}
                    {selectedDefect.repair_photo_path && (
                      <Image source={{ uri: selectedDefect.repair_photo_path }} style={styles.photoThumb} resizeMode="cover" />
                    )}
                  </ScrollView>
                </>
              )}
            </ScrollView>
          </View>
        )}
      </Modal>

      {/* ── Site Change Detail Modal ── */}
      <Modal visible={selectedChange !== null} animationType="slide" onRequestClose={() => setSelectedChange(null)}>
        {selectedChange && (
          <View style={styles.flex}>
            <View style={styles.modalBar}>
              <TouchableOpacity onPress={() => setSelectedChange(null)} style={styles.modalClose}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.modalBarTitle}>Detail Perubahan</Text>
              <View style={{ width: 36 }} />
            </View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
              {/* Impact + type header */}
              <View style={styles.changeDetailHead}>
                <View style={[styles.impactBadge, { backgroundColor: (IMPACT_BADGE[selectedChange.impact] ?? IMPACT_BADGE.ringan).bg }]}>
                  <Text style={[styles.impactBadgeText, { color: (IMPACT_BADGE[selectedChange.impact] ?? IMPACT_BADGE.ringan).color }]}>
                    {(IMPACT_BADGE[selectedChange.impact] ?? IMPACT_BADGE.ringan).label}
                  </Text>
                </View>
                <Text style={styles.changeDetailType}>
                  {CHANGE_TYPE_LABELS[selectedChange.change_type] ?? selectedChange.change_type}
                </Text>
                {selectedChange.is_urgent && (
                  <View style={[styles.impactBadge, { backgroundColor: COLORS.criticalBg }]}>
                    <Text style={[styles.impactBadgeText, { color: COLORS.critical }]}>Urgent</Text>
                  </View>
                )}
              </View>

              {/* Status */}
              <View style={[styles.bannerBox, {
                backgroundColor: selectedChange.decision === 'pending' ? COLORS.warningBg
                  : selectedChange.decision === 'disetujui' ? COLORS.infoBg
                  : selectedChange.decision === 'selesai' ? COLORS.okBg : COLORS.criticalBg,
                marginBottom: SPACE.md,
              }]}>
                <Text style={[styles.bannerText, {
                  color: selectedChange.decision === 'pending' ? COLORS.warning
                    : selectedChange.decision === 'disetujui' ? COLORS.info
                    : selectedChange.decision === 'selesai' ? COLORS.ok : COLORS.critical,
                }]}>
                  Status: {DECISION_LABEL[selectedChange.decision] ?? selectedChange.decision}
                </Text>
              </View>

              {/* Description */}
              <Text style={styles.sectionHeadInline}>Deskripsi</Text>
              <Text style={styles.changeDetailDesc}>{selectedChange.description}</Text>

              {/* Location */}
              <View style={[styles.detailRow, { marginTop: SPACE.md }]}>
                <Text style={styles.detailLabel}>Lokasi</Text>
                <Text style={styles.detailVal}>{selectedChange.location}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Pelapor</Text>
                <Text style={styles.detailVal}>{selectedChange.reporter_name}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Tanggal</Text>
                <Text style={styles.detailVal}>
                  {new Date(selectedChange.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>
              </View>

              {/* Cost info */}
              {selectedChange.est_cost != null && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Estimasi Biaya</Text>
                  <Text style={[styles.detailVal, { fontFamily: FONTS.bold }]}>{formatRp(selectedChange.est_cost)}</Text>
                </View>
              )}
              {selectedChange.cost_bearer && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Ditanggung</Text>
                  <Text style={styles.detailVal}>
                    {selectedChange.cost_bearer === 'mandor' ? 'Mandor' : selectedChange.cost_bearer === 'owner' ? 'Owner' : 'Kontraktor'}
                  </Text>
                </View>
              )}

              {/* Notes */}
              {selectedChange.estimator_note && (
                <>
                  <Text style={[styles.sectionHeadInline, { marginTop: SPACE.md }]}>Catatan Estimator</Text>
                  <Text style={styles.changeDetailDesc}>{selectedChange.estimator_note}</Text>
                </>
              )}
              {selectedChange.resolution_note && (
                <>
                  <Text style={[styles.sectionHeadInline, { marginTop: SPACE.md }]}>Catatan Penyelesaian</Text>
                  <Text style={styles.changeDetailDesc}>{selectedChange.resolution_note}</Text>
                </>
              )}

              {/* Photos */}
              {selectedChange.photo_urls.length > 0 && (
                <>
                  <Text style={[styles.sectionHeadInline, { marginTop: SPACE.md }]}>Foto ({selectedChange.photo_urls.length})</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll}>
                    {selectedChange.photo_urls.map((url, i) => (
                      <Image
                        key={i}
                        source={{ uri: url }}
                        style={styles.photoThumb}
                        resizeMode="cover"
                      />
                    ))}
                  </ScrollView>
                </>
              )}
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  roleTag: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    letterSpacing: 1.2,
    color: COLORS.primary,
    marginBottom: SPACE.md,
    marginTop: SPACE.sm,
  },
  sectionHead: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: COLORS.textSec,
    marginBottom: SPACE.md - 2,
    marginTop: SPACE.base,
  },

  // Desktop 2-column layout
  columns: {
    flexDirection: 'row',
    gap: SPACE.base,
    alignItems: 'flex-start',
  },
  colLeft:  { flex: 3 },
  colRight: { flex: 2 },

  statRow: { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },
  bannerBox: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md - 2, padding: SPACE.md, borderRadius: RADIUS },
  bannerText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, flex: 1, lineHeight: 20 },
  excRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.sm,
    paddingVertical: SPACE.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  excText: { fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.text, lineHeight: 21 },
  excMeta: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  criticalProgress: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    color: COLORS.critical,
    marginTop: 2,
  },
  eligibleBox: { padding: SPACE.md, borderRadius: RADIUS },
  eligibleLabel: { fontSize: TYPE.sm, fontFamily: FONTS.bold, letterSpacing: 0.5 },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACE.md - 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  milestoneLabel: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACE.md - 2,
    paddingHorizontal: SPACE.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
    borderRadius: RADIUS - 2,
  },
  projectRowActive: { backgroundColor: COLORS.accentBg },
  projectCode: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  projectName: { fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.text, marginTop: 2 },
  projectDeleteBtn: {
    padding: SPACE.xs,
    marginLeft: SPACE.sm,
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: SPACE.md - 2,
    alignItems: 'center',
    marginTop: SPACE.sm,
  },
  ghostBtnText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: COLORS.text,
  },
  aiUsageGrid: { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.sm },
  aiUsageTile: {
    flex: 1,
    paddingVertical: SPACE.md - 2,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS,
    backgroundColor: COLORS.accentBg,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
  },
  aiUsageValue: {
    fontSize: TYPE.lg,
    fontFamily: FONTS.bold,
    color: COLORS.text,
  },
  aiUsageLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.textSec,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  quickGrid: { flexDirection: 'row', gap: SPACE.md - 2, marginBottom: SPACE.md },
  qaBtn: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    borderRadius: RADIUS,
    padding: SPACE.base,
    alignItems: 'center',
    gap: SPACE.sm,
    shadowColor: '#5A4A3A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  qaIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  qaLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: COLORS.text,
  },
  accountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountName: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, padding: SPACE.sm },
  logoutText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.critical,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  footerHint: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    textAlign: 'center',
    marginTop: SPACE.sm,
  },

  // Project & team management
  mgmtBtnRow:  { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.sm },
  mgmtBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, justifyContent: 'center', marginTop: 0 },
  mgmtBtnText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase', color: COLORS.text, letterSpacing: 0.3 },

  subHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.md, marginTop: SPACE.sm },
  backBtn:   { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  backText:  { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  subTitle:  { fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5, color: COLORS.textSec },

  formLabel: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, marginBottom: SPACE.xs, marginTop: SPACE.md },
  req:       { color: COLORS.critical },
  input:     {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingVertical: SPACE.md - 1, paddingHorizontal: SPACE.md,
    fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.text,
  },
  formHint:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 17, marginTop: SPACE.md },
  primaryBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md,
    alignItems: 'center', marginTop: SPACE.sm, minHeight: 44, justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase',
    letterSpacing: 0.5, color: COLORS.textInverse,
  },

  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.md,
    paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  memberAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.accentBg, alignItems: 'center', justifyContent: 'center',
  },
  memberAvatarText: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.primary },
  memberName:  { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  memberRole:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2, textTransform: 'capitalize' },
  removeBtn:   { padding: SPACE.xs },
  addMemberRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.md,
    paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },

  roleChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, marginTop: SPACE.xs },
  roleChip: {
    paddingHorizontal: SPACE.md - 2, paddingVertical: SPACE.xs,
    borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  roleChipActive: {
    backgroundColor: COLORS.primary, borderColor: COLORS.primary,
  },
  roleChipText: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec,
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  roleChipTextActive: { color: COLORS.textInverse },

  // ── Section 1: Ringkasan Hari Ini ──
  todayGrid: { flexDirection: 'row', gap: SPACE.sm },
  todayTile: {
    flex: 1, alignItems: 'center', gap: 4,
    paddingVertical: SPACE.md, borderRadius: RADIUS,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderSub,
  },
  todayValue: { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text },
  todayLabel: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, textTransform: 'uppercase', letterSpacing: 0.3 },

  // ── Section 3: Aktivitas Tim ──
  activityRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm,
    paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  activityDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  activityUser: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  activityLabel: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 1, lineHeight: 16 },
  activityTimeSub: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 3 },
  expandBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs,
    paddingVertical: SPACE.md, marginTop: SPACE.xs,
    borderTopWidth: 1, borderTopColor: COLORS.borderSub,
  },
  expandBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.accent },

  // ── Section 5: Status Keuangan ──
  finGrid: { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.sm },
  finTile: {
    flex: 1, paddingVertical: SPACE.md - 2, paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderSub,
  },
  finTileTap: {
    flex: 1, paddingVertical: SPACE.md - 2, paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderSub,
  },
  finTapHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  finLabel: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, textTransform: 'uppercase', letterSpacing: 0.3 },
  finValue: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text, marginTop: 4 },
  finDelta: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, marginTop: 2 },

  // ── Section 6: Progres vs Jadwal ──
  progressBarWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.md },
  progressBarBg: { flex: 1, height: 12, borderRadius: 6, backgroundColor: COLORS.borderSub },
  progressBarFill: { height: 12, borderRadius: 6, backgroundColor: COLORS.accent },
  progressBarPct: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text, minWidth: 40, textAlign: 'right' },
  milestoneStat: { flex: 1, alignItems: 'center' },
  milestoneStatValue: { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text },
  sectionHeadInline: {
    fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase',
    letterSpacing: 0.5, color: COLORS.textSec, marginBottom: SPACE.xs,
  },

  // ── Section 8: Catatan Perubahan ──
  scCompactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  scTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: SPACE.sm, paddingVertical: 4,
    borderRadius: RADIUS, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderSub,
  },
  scTagText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold },
  changeRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    paddingVertical: SPACE.md - 2, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  changeHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginBottom: 2 },
  changeType: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase', letterSpacing: 0.3 },
  changeDesc: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, lineHeight: 20 },
  impactBadge: { paddingHorizontal: SPACE.xs + 2, paddingVertical: 2, borderRadius: RADIUS - 2 },
  impactBadgeText: { fontSize: TYPE.xs - 1, fontFamily: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.3 },

  // ── Modals ──
  modalBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.base, paddingVertical: SPACE.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.borderSub, backgroundColor: COLORS.surface,
  },
  modalBarTitle: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text },
  modalClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  detailCard: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderSub,
    borderRadius: RADIUS, padding: SPACE.base, marginBottom: SPACE.md,
  },
  detailCardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.xs },
  detailCardTitle: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text, flex: 1, marginRight: SPACE.sm },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: SPACE.xs + 2, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  detailLabel: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  detailVal: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },

  // ── Site Change Detail ──
  changeDetailHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginBottom: SPACE.md },
  changeDetailType: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.text, textTransform: 'uppercase', letterSpacing: 0.3 },
  changeDetailDesc: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.text, lineHeight: 22 },
  photoScroll: { marginTop: SPACE.sm },
  photoThumb: { width: 160, height: 120, borderRadius: RADIUS, marginRight: SPACE.sm, backgroundColor: COLORS.borderSub },
});
