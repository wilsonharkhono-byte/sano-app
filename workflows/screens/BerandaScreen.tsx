import React, { useEffect, useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet, Alert, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header      from '../components/Header';
import Card        from '../components/Card';
import StatTile    from '../components/StatTile';
import Badge       from '../components/Badge';
import { useProject } from '../hooks/useProject';
import { signOut }    from '../../tools/auth';
import { getOpenAuditCases } from '../../tools/audit';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(isoDate: string): string {
  const now  = Date.now();
  const then = new Date(isoDate).getTime();
  const diff = Math.floor((now - then) / 1000); // seconds

  if (diff < 60)           return 'Baru saja';
  if (diff < 3600)         return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400)        return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 86400 * 2)    return 'Kemarin';
  if (diff < 86400 * 7)    return `${Math.floor(diff / 86400)} hari lalu`;

  return new Date(isoDate).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short',
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BerandaScreen() {
  const navigation = useNavigation<any>();
  const { boqItems, purchaseOrders, defects, milestones, activityLog, project, profile } = useProject();
  const [openCases, setOpenCases]   = useState(0);

  useEffect(() => {
    if (!project || profile?.role === 'supervisor') return;
    getOpenAuditCases(project.id).then(cases => setOpenCases(cases.length));
  }, [project, profile]);

  // ── Derived metrics ─────────────────────────────────────────────────────
  const overallProgress = boqItems.length > 0
    ? Math.round(boqItems.reduce((s, b) => s + b.progress, 0) / boqItems.length)
    : 0;

  const pendingDeliveries = purchaseOrders.filter(
    po => po.status === 'OPEN' || po.status === 'PARTIAL_RECEIVED',
  ).length;

  const defectsOpen = defects.filter(
    d => d.status === 'OPEN' || d.status === 'VALIDATED' || d.status === 'IN_REPAIR',
  ).length;

  const criticalDefects = defects.filter(
    d => d.severity === 'Critical' && d.status !== 'VERIFIED' && d.status !== 'ACCEPTED_BY_PRINCIPAL',
  ).length;

  const inProgressBoQ      = boqItems.filter(b => b.progress > 0 && b.progress < 100).length;
  const atRiskMilestones   = milestones.filter(m => m.status === 'AT_RISK' || m.status === 'DELAYED').length;
  const recentActivities   = activityLog.slice(0, 20);

  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Yakin ingin keluar?')) signOut();
    } else {
      Alert.alert('Logout', 'Yakin ingin keluar?', [
        { text: 'Batal', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: () => signOut() },
      ]);
    }
  };

  // ── Alert helper ────────────────────────────────────────────────────────
  const hasAlerts = pendingDeliveries > 0 || criticalDefects > 0 || atRiskMilestones > 0 ||
    (openCases > 0 && profile?.role !== 'supervisor');

  return (
    <View style={styles.flex}>
      <Header />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >

        {/* Date */}
        <Text style={styles.dateText}>{today}</Text>

        {/* ── Stat row ─────────────────────────────────────────────────── */}
        <View
          style={styles.statRow}
          accessibilityLabel={`Progress ${overallProgress}%, ${pendingDeliveries} pengiriman tertunda, ${defectsOpen} perubahan terbuka`}
        >
          <StatTile
            value={`${overallProgress}%`}
            label="Progress"
            color={COLORS.accent}
          />
          <StatTile
            value={pendingDeliveries}
            label="Pengiriman"
            color={pendingDeliveries > 0 ? COLORS.warning : COLORS.textSec}
          />
          <StatTile
            value={defectsOpen}
            label="Perubahan"
            color={defectsOpen > 0 ? COLORS.critical : COLORS.textSec}
          />
        </View>

        {/* ── Project progress ─────────────────────────────────────────── */}
        <Card title="Progress Proyek" borderColor={COLORS.accent}>
          <View style={styles.progressRow}>
            <View style={styles.progressMeta}>
              <Text style={styles.projectName} numberOfLines={1}>
                {project?.name ?? '—'}
              </Text>
              <Text style={styles.progressHint}>
                {inProgressBoQ} item BoQ sedang berjalan
              </Text>
            </View>
            <Text style={styles.progressPct}>{overallProgress}%</Text>
          </View>
          <View style={styles.progressTrack} accessibilityLabel={`Progress bar ${overallProgress}%`}>
            <View style={[styles.progressFill, { width: `${overallProgress}%` as any }]} />
          </View>
        </Card>

        {/* ── Control alerts ───────────────────────────────────────────── */}
        {hasAlerts && (
          <Text style={styles.sectionHead}>Perlu Tindakan</Text>
        )}

        {pendingDeliveries > 0 && (
          <Card title="Pengiriman Tertunda" borderColor={COLORS.warning}>
            <Text style={styles.alertBody}>
              {pendingDeliveries} pengiriman menunggu konfirmasi penerimaan.
            </Text>
            <TouchableOpacity
              style={styles.alertBtn}
              onPress={() => navigation.navigate('Terima')}
              accessibilityLabel={`Lihat ${pendingDeliveries} pengiriman tertunda`}
              accessibilityRole="button"
            >
              <Text style={styles.alertBtnText}>Buka Terima</Text>
              <Ionicons name="arrow-forward" size={14} color={COLORS.warning} />
            </TouchableOpacity>
          </Card>
        )}

        {criticalDefects > 0 && (
          <Card title="Perubahan Berat" borderColor={COLORS.critical}>
            <Text style={styles.alertBody}>
              {criticalDefects} catatan perubahan berat belum terselesaikan.
            </Text>
            <TouchableOpacity
              style={styles.alertBtn}
              onPress={() => navigation.navigate('Progres')}
              accessibilityLabel={`Lihat ${criticalDefects} perubahan berat di Progres`}
              accessibilityRole="button"
            >
              <Text style={[styles.alertBtnText, { color: COLORS.critical }]}>Buka Progres</Text>
              <Ionicons name="arrow-forward" size={14} color={COLORS.critical} />
            </TouchableOpacity>
          </Card>
        )}

        {atRiskMilestones > 0 && (
          <Card title="Milestone Berisiko" borderColor={COLORS.warning}>
            <Text style={styles.alertBody}>
              {atRiskMilestones} milestone berisiko atau terlambat.
            </Text>
            <TouchableOpacity
              style={styles.alertBtn}
              onPress={() => navigation.navigate('Laporan', { initialSection: 'jadwal' })}
              accessibilityLabel={`Lihat ${atRiskMilestones} milestone berisiko di Jadwal`}
              accessibilityRole="button"
            >
              <Text style={styles.alertBtnText}>Buka Jadwal</Text>
              <Ionicons name="arrow-forward" size={14} color={COLORS.warning} />
            </TouchableOpacity>
          </Card>
        )}

        {openCases > 0 &&
          (profile?.role === 'estimator' || profile?.role === 'admin' || profile?.role === 'principal') && (
          <Card title="Kasus Audit Terbuka" borderColor={COLORS.high}>
            <Text style={styles.alertBody}>
              {openCases} kasus audit memerlukan tindakan.
            </Text>
            <TouchableOpacity
              style={styles.alertBtn}
              onPress={() => navigation.navigate('Laporan')}
              accessibilityLabel={`Lihat ${openCases} kasus audit di Laporan`}
              accessibilityRole="button"
            >
              <Text style={[styles.alertBtnText, { color: COLORS.high }]}>Buka Laporan</Text>
              <Ionicons name="arrow-forward" size={14} color={COLORS.high} />
            </TouchableOpacity>
          </Card>
        )}

        {/* ── Activity log ─────────────────────────────────────────────── */}
        <Text style={styles.sectionHead}>Aktivitas Terkini</Text>
        <Card>
          {recentActivities.length === 0 ? (
            <Text style={styles.emptyText}>Belum ada aktivitas untuk proyek ini.</Text>
          ) : (
            recentActivities.map((a, index) => (
              <View
                key={a.id}
                style={[styles.actItem, index === recentActivities.length - 1 && styles.actItemLast]}
              >
                <Text style={styles.actTime}>{relativeTime(a.created_at)}</Text>
                <Text style={styles.actLabel} numberOfLines={2}>{a.label}</Text>
                <Badge flag={a.flag} />
              </View>
            ))
          )}
        </Card>

        {/* ── Account ──────────────────────────────────────────────────── */}
        <Text style={styles.sectionHead}>Akun</Text>
        <Card>
          <View style={styles.accountRow}>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>{profile?.full_name ?? '—'}</Text>
              <Text style={styles.accountRole}>
                {profile?.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : '—'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={handleLogout}
              accessibilityLabel="Keluar dari akun"
              accessibilityRole="button"
            >
              <Ionicons name="log-out-outline" size={16} color={COLORS.critical} />
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </Card>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },

  dateText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.medium,
    color: COLORS.textSec,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: SPACE.md,
    marginTop: SPACE.sm,
  },

  // Stat row — tighter gap, section-level spacing above/below
  statRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
    marginBottom: SPACE.base,
  },

  // Section headings — varied spacing creates rhythm
  sectionHead: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    color: COLORS.textSec,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: SPACE.lg,
    marginBottom: SPACE.sm,
  },

  // Progress card
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACE.sm,
  },
  progressMeta: { flex: 1, paddingRight: SPACE.sm },
  projectName: {
    fontSize: TYPE.base,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
    marginBottom: 2,
  },
  progressHint: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    lineHeight: 18,
  },
  progressPct: {
    fontSize: TYPE.xl,
    fontFamily: FONTS.bold,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  progressTrack: {
    backgroundColor: 'rgba(20,18,16,0.08)',
    borderRadius: 4,
    height: 6,
    overflow: 'hidden',
    marginTop: SPACE.xs,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: COLORS.accent,
  },

  // Alert cards
  alertBody: {
    fontSize: TYPE.base,
    fontFamily: FONTS.regular,
    color: COLORS.text,
    lineHeight: 22,
    marginBottom: SPACE.sm,
  },
  alertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    alignSelf: 'flex-start',
    paddingVertical: SPACE.xs,
  },
  alertBtnText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.warning,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  // Activity log
  actItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACE.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
    gap: SPACE.sm,
  },
  actItemLast: { borderBottomWidth: 0 },
  actTime: {
    width: 68,
    fontSize: TYPE.xs,
    fontFamily: FONTS.medium,
    color: COLORS.textSec,
    flexShrink: 0,
  },
  actLabel: {
    flex: 1,
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.text,
    lineHeight: 19,
  },
  emptyText: {
    fontSize: TYPE.base,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    textAlign: 'center',
    paddingVertical: SPACE.xl,
    lineHeight: 22,
  },

  // Account
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  accountInfo: { flex: 1, gap: 3 },
  accountName: {
    fontSize: TYPE.base,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
  },
  accountRole: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS - 2,
    backgroundColor: COLORS.criticalBg,
  },
  logoutText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.critical,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
