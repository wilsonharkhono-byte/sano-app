import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Card from '../../components/Card';
import { useProject } from '../../hooks/useProject';
import { useToast } from '../../components/Toast';
import { discardEntryLocally, useCaptureQueueEntries } from '../../../tools/captureQueueStore';
import { retryQueueEntry } from '../../../tools/captureQueueWorker';
import { attentionRows, queueBadgeText } from './captureQueueModel';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';

/**
 * The offline capture queue's own badge (spec §7), separate from plan 2's
 * "Draf menunggu" (DraftEventsCard): that card reads confirmed server state
 * (site_events rows that already exist); this one reads what is still only
 * on the phone, so it stays useful even with no signal at all. Hidden when
 * the queue is empty.
 */
export default function CaptureQueueCard() {
  const { profile } = useProject();
  const { show: toast } = useToast();
  const entries = useCaptureQueueEntries(profile?.id ?? null);

  const badge = queueBadgeText(entries);
  const attention = attentionRows(entries);

  const onRetry = useCallback(async (id: string) => {
    if (!profile) return;
    await retryQueueEntry(profile.id, id);
  }, [profile]);

  const onDiscard = useCallback(async (id: string) => {
    if (!profile) return;
    const result = await discardEntryLocally(profile.id, id);
    if (result.error) toast(result.error, 'critical');
  }, [profile, toast]);

  if (!badge && attention.length === 0) return null;

  return (
    <Card
      title="Antrean kiriman"
      subtitle={badge ?? undefined}
      borderColor={attention.length > 0 ? COLORS.warning : COLORS.info}
    >
      {attention.length > 0 ? (
        <View>
          <Text style={styles.sectionLabel}>Perlu perhatian</Text>
          {attention.map((row) => (
            <View key={row.id} style={styles.row}>
              <View style={styles.meta}>
                <Text style={styles.title} numberOfLines={1}>{row.title}</Text>
                <Text style={styles.reason} numberOfLines={2}>{row.reason}</Text>
              </View>
              <TouchableOpacity
                style={row.action === 'discard' ? styles.dangerBtn : styles.retryBtn}
                onPress={() => void (row.action === 'discard' ? onDiscard(row.id) : onRetry(row.id))}
                accessibilityRole="button"
                accessibilityLabel={row.action === 'discard' ? `Buang laporan ${row.title}` : `Coba lagi laporan ${row.title}`}
              >
                <Text style={row.action === 'discard' ? styles.dangerText : styles.retryText}>
                  {row.action === 'discard' ? 'Buang' : 'Coba lagi'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec, textTransform: 'uppercase', marginBottom: SPACE.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.sm, minHeight: 48,
    borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  meta: { flex: 1 },
  title: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  reason: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  retryBtn: { paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, minHeight: 40, justifyContent: 'center' },
  retryText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, textTransform: 'uppercase' },
  dangerBtn: { paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, minHeight: 40, justifyContent: 'center' },
  dangerText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.critical, textTransform: 'uppercase' },
});
