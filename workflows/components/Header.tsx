import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useProject } from '../hooks/useProject';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
import SanoBrand from './SanoBrand';

const ROLE_LABELS: Record<string, string> = {
  supervisor: 'Pengawas Lapangan',
  estimator:  'Estimator',
  admin:      'Admin / Purchasing',
  principal:  'Prinsipal',
};

export default function Header() {
  const { profile, project, projects, setActiveProject } = useProject();
  const insets = useSafeAreaInsets();
  const [showPicker, setShowPicker] = useState(false);

  const hasMultipleProjects = projects.length > 1;
  const roleLabel = profile?.role ? ROLE_LABELS[profile.role] ?? profile.role : '';

  return (
    <>
      <View style={[styles.container, { paddingTop: insets.top + SPACE.sm }]}>
        {/* Top row: logo + project selector */}
        <View style={styles.topRow}>
          <SanoBrand tone="light" compact />

          <View style={styles.right}>
            <TouchableOpacity
              style={[styles.projectBtn, hasMultipleProjects && styles.projectBtnActive]}
              onPress={() => hasMultipleProjects && setShowPicker(true)}
              disabled={!hasMultipleProjects}
              accessibilityLabel={
                hasMultipleProjects
                  ? `Proyek aktif: ${project?.name ?? '—'}. Ketuk untuk ganti proyek`
                  : `Proyek: ${project?.name ?? '—'}`
              }
              accessibilityRole="button"
              accessibilityHint={hasMultipleProjects ? 'Membuka daftar proyek' : undefined}
            >
              <View style={styles.projectCopy}>
                <Text style={styles.projectLabel}>Proyek</Text>
                <Text style={styles.projectName} numberOfLines={1}>
                  {project?.code ? `${project.code} · ${project.name}` : project?.name ?? '—'}
                </Text>
              </View>
              {hasMultipleProjects && (
                <Ionicons name="chevron-down" size={13} color={COLORS.textInverseMuted} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Bottom row: role + user name */}
        <View style={styles.bottomRow}>
          <Text style={styles.roleLabel}>{roleLabel}</Text>
          <Text style={styles.userName} numberOfLines={1}>{profile?.full_name ?? '—'}</Text>
        </View>
      </View>

      {/* Project picker modal */}
      <Modal
        visible={showPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}
        accessibilityViewIsModal
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setShowPicker(false)}
          accessibilityLabel="Tutup pilihan proyek"
        >
          <View style={[styles.pickerSheet, { marginTop: insets.top + 64 }]}>
            <Text style={styles.pickerTitle}>Pilih Proyek</Text>
            <Text style={styles.pickerCount}>{projects.length} proyek tersedia</Text>
            <FlatList
              data={projects}
              keyExtractor={p => p.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.pickerItem, item.id === project?.id && styles.pickerItemActive]}
                  onPress={() => { setActiveProject(item.id); setShowPicker(false); }}
                  accessibilityLabel={`${item.name}${item.id === project?.id ? ', aktif' : ''}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.id === project?.id }}
                >
                  <View style={styles.pickerItemBody}>
                    <Text style={styles.pickerItemCode}>{item.code}</Text>
                    <Text style={[styles.pickerItemText, item.id === project?.id && styles.pickerItemTextActive]}>
                      {item.name}
                    </Text>
                  </View>
                  {item.id === project?.id && (
                    <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACE.base,
    paddingBottom: SPACE.md,
    gap: SPACE.sm,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.md,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roleLabel: {
    color: COLORS.textInverseSec,
    fontSize: TYPE.xs,
    fontFamily: FONTS.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  right: {
    alignItems: 'flex-end',
    flexShrink: 1,
    maxWidth: '55%',
  },
  projectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    borderWidth: 1,
    borderColor: 'rgba(253,250,246,0.12)',
    borderRadius: RADIUS,
    paddingVertical: SPACE.sm + 2,   // was 7dp → now 10dp each side ≥ 44dp target
    paddingHorizontal: SPACE.sm + 2,
    minHeight: 44,
  },
  projectBtnActive: {
    borderColor: 'rgba(253,250,246,0.24)',
    backgroundColor: 'rgba(253,250,246,0.06)',
  },
  projectCopy: {
    alignItems: 'flex-end',
    flexShrink: 1,
  },
  projectLabel: {
    color: COLORS.textInverseMuted,
    fontSize: TYPE.xs,          // was TYPE.xs-1 (10dp) — below mobile legibility floor
    fontFamily: FONTS.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  projectName: {
    color: COLORS.textInverse,
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    marginTop: 1,
  },
  userName: {
    color: COLORS.textInverseSec,
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
  },

  // Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(20,18,16,0.5)',
  },
  pickerSheet: {
    marginHorizontal: SPACE.base,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS,
    padding: SPACE.base,
    maxHeight: 320,
    shadowColor: '#141210',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  pickerTitle: {
    fontSize: TYPE.base,
    fontFamily: FONTS.bold,
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  pickerCount: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginTop: 2,
    marginBottom: SPACE.md,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  pickerItemActive: {
    backgroundColor: COLORS.accentBg,
    borderRadius: RADIUS - 2,
  },
  pickerItemBody: {
    flex: 1,
    gap: 2,
  },
  pickerItemCode: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.medium,
    color: COLORS.textSec,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pickerItemText: {
    fontSize: TYPE.base,
    fontFamily: FONTS.medium,
    color: COLORS.text,
  },
  pickerItemTextActive: {
    fontFamily: FONTS.bold,
    color: COLORS.text,
  },
});
