import React, { useCallback, useState } from 'react';
import { Alert, Platform, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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
  /**
   * The row whose action is still running. The list only refreshes once the
   * store's write round-trips - hundreds of ms on a cheap phone with a day's
   * reports queued - and the button stays on screen and tappable the whole
   * time. retryQueueEntry's own lock already makes a double tap harmless;
   * this is so the supervisor can see that the first tap was taken.
   */
  const [pendingId, setPendingId] = useState<string | null>(null);

  const badge = queueBadgeText(entries);
  const attention = attentionRows(entries);

  const onRetry = useCallback(async (id: string) => {
    if (!profile) return;
    setPendingId(id);
    try {
      await retryQueueEntry(profile.id, id);
    } finally {
      setPendingId((current) => (current === id ? null : current));
    }
  }, [profile]);

  const discard = useCallback(async (id: string) => {
    if (!profile) return;
    setPendingId(id);
    try {
      const result = await discardEntryLocally(profile.id, id);
      if (result.error) toast(result.error, 'critical');
      else toast('Laporan dibuang dari ponsel ini.', 'ok');
    } finally {
      setPendingId((current) => (current === id ? null : current));
    }
  }, [profile, toast]);

  /**
   * Buang is irreversible and, for these rows, unrecoverable by definition:
   * the report never reached the server (attentionRows only offers this when
   * eventInserted is false), so nothing else holds a copy of the note, the
   * photos or the voice recording. Every other destructive action in this app
   * confirms first (SiteEventConfirmScreen's "Buang draf", the catalog's
   * "Hapus Alias", the logout dialogs); this one has more to lose than most.
   */
  const onDiscard = useCallback((id: string, title: string) => {
    const message = `Buang "${title}"? Laporan ini belum terkirim, dan catatan, foto serta rekamannya akan hilang dari ponsel ini.`;
    if (Platform.OS === 'web') {
      if (window.confirm(message)) void discard(id);
    } else {
      Alert.alert('Buang laporan', message, [
        { text: 'Batal', style: 'cancel' },
        { text: 'Buang', style: 'destructive', onPress: () => void discard(id) },
      ]);
    }
  }, [discard]);

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
          {attention.map((row) => {
            const busy = pendingId === row.id;
            const danger = row.action === 'discard';
            return (
              <View key={row.id} style={styles.row}>
                <View style={styles.meta}>
                  <Text style={styles.title} numberOfLines={1}>{row.title}</Text>
                  <Text style={styles.reason} numberOfLines={2}>{row.reason}</Text>
                </View>
                <TouchableOpacity
                  style={[danger ? styles.dangerBtn : styles.retryBtn, busy && styles.btnBusy]}
                  disabled={busy}
                  onPress={() => (danger ? onDiscard(row.id, row.title) : void onRetry(row.id))}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  accessibilityLabel={danger ? `Buang laporan ${row.title}` : `Coba lagi laporan ${row.title}`}
                >
                  <Text style={danger ? styles.dangerText : styles.retryText}>
                    {danger ? 'Buang' : 'Coba lagi'}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
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
  btnBusy: { opacity: 0.4 },
});
