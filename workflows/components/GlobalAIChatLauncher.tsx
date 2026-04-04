import React, { useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AIChatModal from './AIChatModal';
import { useProject } from '../hooks/useProject';
import { COLORS, SPACE } from '../theme';

export default function GlobalAIChatLauncher() {
  const insets = useSafeAreaInsets();
  const { project, profile, boqItems, defects, milestones, purchaseOrders } = useProject();
  const [visible, setVisible] = useState(false);

  const context = useMemo(() => {
    const overallProgress = boqItems.length > 0
      ? Math.round(boqItems.reduce((sum, item) => sum + item.progress, 0) / boqItems.length)
      : 0;
    const openDefects = defects.filter(defect => !['VERIFIED', 'ACCEPTED_BY_PRINCIPAL'].includes(defect.status)).length;
    const criticalDefects = defects.filter(
      defect => defect.severity === 'Critical' && !['VERIFIED', 'ACCEPTED_BY_PRINCIPAL'].includes(defect.status),
    ).length;
    const delayedMilestones = milestones.filter(
      milestone => milestone.status === 'AT_RISK' || milestone.status === 'DELAYED',
    ).length;
    const openPOs = purchaseOrders.filter(
      po => po.status === 'OPEN' || po.status === 'PARTIAL_RECEIVED',
    ).length;

    return {
      projectId: project?.id,
      projectName: project?.name,
      projectCode: project?.code,
      userRole: profile?.role,
      overallProgress,
      openDefects,
      criticalDefects,
      delayedMilestones,
      activeBoqItems: boqItems.length,
      openPOs,
    };
  }, [boqItems, defects, milestones, profile?.role, project?.code, project?.name, purchaseOrders]);

  if (!profile) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <TouchableOpacity
        style={[styles.fab, { bottom: Math.max(insets.bottom + 78, 92) }]}
        onPress={() => setVisible(true)}
        accessibilityLabel="Buka Asisten SANO"
        accessibilityRole="button"
      >
        <Ionicons name="sparkles" size={20} color="rgba(255,255,255,0.78)" />
      </TouchableOpacity>

      <AIChatModal
        visible={visible}
        onClose={() => setVisible(false)}
        projectId={project?.id}
        userId={profile?.id}
        userRole={profile?.role}
        context={context}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: SPACE.base,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(27,23,21,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#141210',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 6,
  },
});
