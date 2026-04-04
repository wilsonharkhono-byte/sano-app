import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Platform, useWindowDimensions } from 'react-native';
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
  createProject, getProjectTeam, listAllProfiles, addUserToProject, removeUserFromProject,
  inviteUser, updateUserRole,
  type TeamMember, type ProfileOption, ROLE_LABELS,
} from '../../tools/projectManagement';
import { COLORS, FONTS, RADIUS, SPACE, TYPE, BREAKPOINTS, MAX_CONTENT_WIDTH } from '../../workflows/theme';

interface PendingCounts {
  mtn: number;
  perubahan: number;
  requests: number;
}

export default function OfficeHomeScreen() {
  const navigation = useNavigation<any>();
  const { projects, project, setActiveProject, profile, boqItems, defects, milestones, refresh } = useProject();
  const { show: toast } = useToast();
  const [pending, setPending]     = useState<PendingCounts>({ mtn: 0, perubahan: 0, requests: 0 });
  const { width } = useWindowDimensions();

  // ── Project management state ──
  const [homeView, setHomeView] = useState<'dashboard' | 'new_project' | 'manage_team'>('dashboard');
  const canManageProjects = ['admin', 'principal', 'estimator'].includes(profile?.role ?? '');
  const canManageTeam     = ['admin', 'principal'].includes(profile?.role ?? '');

  // New project form
  const [npCode,     setNpCode]     = useState('');
  const [npName,     setNpName]     = useState('');
  const [npLocation, setNpLocation] = useState('');
  const [npClient,   setNpClient]   = useState('');
  const [npStart,    setNpStart]    = useState('');
  const [creating,   setCreating]   = useState(false);

  // Team management
  const [team,        setTeam]        = useState<TeamMember[]>([]);
  const [allProfiles, setAllProfiles] = useState<ProfileOption[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);

  // Invite new user
  const [invEmail,    setInvEmail]    = useState('');
  const [invPassword, setInvPassword] = useState('');
  const [invName,     setInvName]     = useState('');
  const [invRole,     setInvRole]     = useState('supervisor');
  const [inviting,    setInviting]    = useState(false);
  const isTablet  = width >= BREAKPOINTS.tablet;
  const isDesktop = width >= BREAKPOINTS.desktop;
  const contentMaxWidth = isDesktop
    ? MAX_CONTENT_WIDTH.desktop
    : isTablet
    ? MAX_CONTENT_WIDTH.tablet
    : undefined;

  useEffect(() => {
    if (!project) return;
    Promise.all([
      supabase.from('mtn_requests').select('id', { count: 'exact', head: true }).eq('project_id', project.id).eq('status', 'AWAITING'),
      supabase.from('site_changes').select('id', { count: 'exact', head: true }).eq('project_id', project.id).eq('decision', 'pending'),
      supabase.from('material_request_headers').select('id', { count: 'exact', head: true }).eq('project_id', project.id).in('overall_status', ['PENDING', 'UNDER_REVIEW', 'AUTO_HOLD']),
    ]).then(([mtn, perubahan, req]) => {
      setPending({ mtn: mtn.count ?? 0, perubahan: perubahan.count ?? 0, requests: req.count ?? 0 });
    });
  }, [project]);

  const overallProgress = boqItems.length > 0
    ? Math.round(boqItems.reduce((s, b) => s + b.progress, 0) / boqItems.length)
    : 0;
  const openDefects = defects.filter(d => !['VERIFIED', 'ACCEPTED_BY_PRINCIPAL'].includes(d.status)).length;
  const criticalDefects = defects.filter(d => d.severity === 'Critical' && !['VERIFIED', 'ACCEPTED_BY_PRINCIPAL'].includes(d.status)).length;
  const atRiskMilestones = milestones.filter(m => m.status === 'AT_RISK' || m.status === 'DELAYED').length;
  const totalPending = pending.mtn + pending.perubahan + pending.requests;
  const canManageBaseline = profile?.role === 'estimator' || profile?.role === 'admin';

  // ── Project management handlers ──────────────────────────────────────────

  const loadTeam = async () => {
    if (!project) return;
    setLoadingTeam(true);
    const [members, profiles] = await Promise.all([
      getProjectTeam(project.id),
      listAllProfiles(),
    ]);
    setTeam(members);
    setAllProfiles(profiles);
    setLoadingTeam(false);
  };

  useEffect(() => {
    if (homeView === 'manage_team') loadTeam();
  }, [homeView, project?.id]);

  const handleCreateProject = async () => {
    if (!npCode.trim() || !npName.trim()) {
      toast('Kode proyek dan nama wajib diisi', 'critical'); return;
    }
    setCreating(true);
    const { data, error } = await createProject({
      code: npCode, name: npName,
      location:   npLocation || undefined,
      clientName: npClient   || undefined,
      startDate:  npStart    || undefined,
    });
    setCreating(false);
    if (error) { toast(error, 'critical'); return; }
    toast(`Proyek ${data!.code} berhasil dibuat`, 'ok');
    setNpCode(''); setNpName(''); setNpLocation(''); setNpClient(''); setNpStart('');
    await refresh();
    setHomeView('dashboard');
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

  // ── Reusable JSX fragments shared between single-col and 2-col layouts ───────

  const projectSelector = projects.length > 1 ? (
    <Card title="Proyek Aktif">
      {projects.map(p => (
        <TouchableOpacity
          key={p.id}
          style={[styles.projectRow, p.id === project?.id && styles.projectRowActive]}
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
      ))}
    </Card>
  ) : null;

  const pendingCard = totalPending > 0 ? (
    <Card title={`${totalPending} Tindakan Diperlukan`} borderColor={COLORS.warning} style={styles.cardUrgent}>
      {pending.requests > 0 && (
        <View style={styles.pendingRow}>
          <Ionicons name="arrow-forward-circle" size={18} color={COLORS.warning} />
          <Text style={styles.pendingText}>{pending.requests} permintaan material ditahan (AUTO_HOLD)</Text>
        </View>
      )}
      {pending.mtn > 0 && (
        <View style={styles.pendingRow}>
          <Ionicons name="swap-horizontal" size={18} color={COLORS.info} />
          <Text style={styles.pendingText}>{pending.mtn} MTN menunggu persetujuan</Text>
        </View>
      )}
      {pending.perubahan > 0 && (
        <View style={styles.pendingRow}>
          <Ionicons name="create" size={18} color={COLORS.accent} />
          <Text style={styles.pendingText}>{pending.perubahan} catatan perubahan belum direview</Text>
        </View>
      )}
      <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.navigate('Approvals')}>
        <Text style={styles.primaryBtnText}>Lihat Semua Approval</Text>
      </TouchableOpacity>
    </Card>
  ) : null;

  const criticalCard = criticalDefects > 0 ? (
    <Card title="Perubahan Impact Berat Terbuka" borderColor={COLORS.critical} style={styles.cardCritical}>
      <Text style={styles.hint}>{criticalDefects} catatan perubahan berat belum terselesaikan.</Text>
      <TouchableOpacity style={styles.dangerBtn} onPress={() => navigation.navigate('Reports')}>
        <Text style={styles.dangerBtnText}>Lihat Catatan Perubahan</Text>
      </TouchableOpacity>
    </Card>
  ) : null;

  const baselineCard = canManageBaseline ? (
    <Card title="Baseline Sistem" borderColor={COLORS.info}>
      <Text style={styles.hint}>
        Upload Excel BoQ / AHS untuk menjadi dasar perhitungan BoQ, AHS, material envelope, dan review parser.
      </Text>
      <TouchableOpacity style={styles.ghostBtn} onPress={() => navigation.navigate('Baseline')}>
        <Text style={styles.ghostBtnText}>Buka Import Baseline</Text>
      </TouchableOpacity>
    </Card>
  ) : null;

  const quickActions = (cols: 2 | 3) => (
    <>
      <Text style={styles.sectionHead}>Aksi Cepat</Text>
      <View style={[styles.quickGrid, cols === 3 && styles.quickGrid3]}>
        {([
          { icon: 'checkmark-done', label: 'Approval',  screen: 'Approvals',  color: COLORS.warning,    bg: COLORS.warningBg },
          { icon: 'pricetag',       label: 'Harga',     screen: 'Procurement',color: COLORS.accent,     bg: COLORS.accentBg },
          { icon: 'layers',         label: 'Katalog',   screen: 'Materials',  color: COLORS.info,       bg: COLORS.infoBg },
          { icon: 'people',         label: 'Mandor',    screen: 'Mandor',     color: COLORS.info,       bg: COLORS.infoBg },
          { icon: 'receipt',        label: 'Opname',    screen: 'Opname',     color: COLORS.accentDark, bg: COLORS.accentBg },
          { icon: 'document-text',  label: 'Laporan',   screen: 'Reports',    color: COLORS.accent,     bg: COLORS.accentBg },
        ] as const).map(qa => (
          <TouchableOpacity
            key={qa.screen}
            style={[styles.qaBtn, cols === 3 && styles.qaBtn3]}
            onPress={() => navigation.navigate(qa.screen)}
          >
            <View style={[styles.qaIcon, { backgroundColor: qa.bg }]}>
              <Ionicons name={qa.icon as any} size={22} color={qa.color} />
            </View>
            <Text style={styles.qaLabel}>{qa.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );

  const milestoneCard = milestones.length > 0 ? (
    <Card title="Status Milestone">
      {milestones.slice(0, 5).map(m => (
        <View key={m.id} style={styles.milestoneRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.milestoneLabel}>{m.label}</Text>
            <Text style={styles.hint}>{new Date(m.planned_date).toLocaleDateString('id-ID')}</Text>
          </View>
          <Badge
            flag={m.status === 'ON_TRACK' || m.status === 'AHEAD' ? 'OK' : m.status === 'AT_RISK' ? 'WARNING' : m.status === 'DELAYED' ? 'CRITICAL' : 'INFO'}
            label={m.status.replace('_', ' ')}
          />
        </View>
      ))}
    </Card>
  ) : null;

  const managementCard = canManageProjects ? (
    <Card title="Kelola Proyek">
      <Text style={styles.hint}>Buat proyek baru atau kelola tim untuk proyek aktif.</Text>
      <View style={styles.mgmtBtnRow}>
        <TouchableOpacity style={[styles.ghostBtn, styles.mgmtBtn]} onPress={() => setHomeView('new_project')}>
          <Ionicons name="add-circle-outline" size={16} color={COLORS.accent} />
          <Text style={styles.mgmtBtnText}>Buat Proyek</Text>
        </TouchableOpacity>
        {canManageTeam && project && (
          <TouchableOpacity style={[styles.ghostBtn, styles.mgmtBtn]} onPress={() => setHomeView('manage_team')}>
            <Ionicons name="people-outline" size={16} color={COLORS.info} />
            <Text style={styles.mgmtBtnText}>Kelola Tim</Text>
          </TouchableOpacity>
        )}
      </View>
    </Card>
  ) : null;

  const accountCard = (
    <Card>
      <View style={styles.accountRow}>
        <View>
          <Text style={styles.accountName}>{profile?.full_name ?? '—'}</Text>
          <Text style={styles.hint}>{profile?.role} · {profile?.phone ?? '—'}</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={() => {
          if (Platform.OS === 'web') {
            if (window.confirm('Yakin ingin keluar?')) signOut();
          } else {
            Alert.alert('Logout', 'Yakin ingin keluar?', [
              { text: 'Batal', style: 'cancel' },
              { text: 'Logout', style: 'destructive', onPress: () => signOut() },
            ]);
          }
        }}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.critical} />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.footerHint}>SANO Office v1.0</Text>
    </Card>
  );

  // ── Sub-views ──────────────────────────────────────────────────────────────

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
                      {canManageTeam ? (
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
                      ) : (
                        <Text style={styles.memberRole}>{ROLE_LABELS[member.role] ?? member.role}</Text>
                      )}
                    </View>
                    {canManageTeam && (
                      <TouchableOpacity
                        style={styles.removeBtn}
                        onPress={() => handleRemoveUser(member.assignment_id, member.full_name)}
                      >
                        <Ionicons name="person-remove-outline" size={18} color={COLORS.critical} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))
              )}
            </Card>

            {/* ── Add existing user to project ── */}
            {canManageTeam && available.length > 0 && (
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
            {canManageTeam && (
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
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, isTablet && styles.contentWide]}
      >
        <View style={contentMaxWidth ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' } : undefined}>

          <Text style={styles.roleTag}>{profile?.role?.toUpperCase()} DASHBOARD</Text>

          {/* KPIs — full width on all breakpoints */}
          <View style={styles.statRow}>
            <StatTile value={`${overallProgress}%`}  label="Progress"         color={COLORS.accent}   context={`${boqItems.length} item BoQ`} />
            <StatTile value={openDefects}             label="Perubahan Open"   color={COLORS.critical} context={criticalDefects > 0 ? `${criticalDefects} berat` : undefined} />
            <StatTile value={atRiskMilestones}        label="Milestone Risiko" color={COLORS.warning}  context={`dari ${milestones.length} total`} />
          </View>

          {isDesktop ? (
            /* ── Desktop: 2-column dashboard ─────────────────────────────── */
            <View style={styles.columns}>

              {/* Left — urgency & actions (wider) */}
              <View style={styles.colLeft}>
                {pendingCard}
                {criticalCard}
                {baselineCard}
                {managementCard}
                {accountCard}
              </View>

              {/* Right — navigation & context (narrower) */}
              <View style={styles.colRight}>
                {projectSelector}
                {quickActions(3)}
                {milestoneCard}
              </View>

            </View>
          ) : (
            /* ── Mobile / tablet: single column ──────────────────────────── */
            <>
              {projectSelector}
              {pendingCard}
              {criticalCard}
              {baselineCard}
              {managementCard}
              {quickActions(2)}
              {milestoneCard}
              {accountCard}
            </>
          )}

        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  contentWide: { paddingHorizontal: SPACE.xl, alignItems: 'center' },

  // 2-column desktop layout
  columns: {
    flexDirection: 'row',
    gap: SPACE.lg,
    alignItems: 'flex-start',
  },
  colLeft:  { flex: 3 },   // ~60% — urgency/action cards
  colRight: { flex: 2 },   // ~40% — navigation & context
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
  statRow: { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },
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
  projectName: {
    fontSize: TYPE.base,
    fontFamily: FONTS.medium,
    color: COLORS.text,
    marginTop: 2,
  },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.sm - 2 },
  pendingText: {
    fontSize: TYPE.base,
    fontFamily: FONTS.regular,
    color: COLORS.text,
    flex: 1,
    lineHeight: 21,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACE.md - 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  milestoneLabel: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  quickGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md - 2, marginBottom: SPACE.md },
  quickGrid3: { gap: SPACE.sm },
  qaBtn: {
    width: '48%',
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
  qaBtn3: { width: '31%' },
  qaIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  qaLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: COLORS.text,
  },
  // Card urgency tints
  cardUrgent:  { backgroundColor: COLORS.warningBg },
  cardCritical:{ backgroundColor: COLORS.criticalBg },

  ghostBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: SPACE.md,
    alignItems: 'center',
    marginTop: SPACE.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  ghostBtnText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: COLORS.text,
  },
  // Primary CTA — for the most urgent action on the page
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS,
    padding: SPACE.md,
    alignItems: 'center',
    marginTop: SPACE.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: COLORS.textInverse,
  },
  // Danger CTA — for critical/blocking items
  dangerBtn: {
    backgroundColor: COLORS.critical,
    borderRadius: RADIUS,
    padding: SPACE.md,
    alignItems: 'center',
    marginTop: SPACE.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  dangerBtnText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: COLORS.textInverse,
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

  // Project management
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
});
