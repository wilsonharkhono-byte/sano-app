import React, { useCallback, useState } from 'react';
import { Alert, Platform, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Card from '../../components/Card';
import { useProject } from '../../hooks/useProject';
import { useToast } from '../../components/Toast';
import { acknowledgeCloseEntry, discardEntryLocally, useCaptureQueueEntries } from '../../../tools/captureQueueStore';
import { retryQueueEntry } from '../../../tools/captureQueueWorker';
import { attentionRows, queueBadgeText, type AttentionRow } from './captureQueueModel';
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
  /** Why the last "Mengerti" on a row threw, shown in that row; cleared when it is pressed again. */
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const badge = queueBadgeText(entries);
  const attention = attentionRows(entries);
  /** Close rows name their own action; capture rows keep main's "... laporan {title}" labels unchanged. */
  const closeIds = new Set(entries.filter((e) => e.kind === 'close').map((e) => e.id));

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
    if (Platform?.OS === 'web') {
      if (window.confirm(message)) void discard(id);
    } else {
      Alert.alert('Buang laporan', message, [
        { text: 'Batal', style: 'cancel' },
        { text: 'Buang', style: 'destructive', onPress: () => void discard(id) },
      ]);
    }
  }, [discard]);

  /** "Batalkan" on a close job (closure spec §4.6): the event stays open; nothing on the server is touched. */
  const cancelClose = useCallback(async (id: string) => {
    if (!profile) return;
    setPendingId(id);
    try {
      const result = await discardEntryLocally(profile.id, id);
      if (result.error) toast(result.error, 'critical');
      else toast('Penutupan dibatalkan. Kejadian tetap terbuka.', 'ok');
    } finally {
      setPendingId((current) => (current === id ? null : current));
    }
  }, [profile, toast]);

  const onCancelClose = useCallback((row: Extract<AttentionRow, { action: 'cancel' }>) => {
    const message = row.confirm;
    if (Platform?.OS === 'web') {
      if (window.confirm(message)) void cancelClose(row.id);
    } else {
      Alert.alert('Batalkan penutupan', message, [
        { text: 'Tidak', style: 'cancel' },
        { text: 'Batalkan', style: 'destructive', onPress: () => void cancelClose(row.id) },
      ]);
    }
  }, [cancelClose]);

  /**
   * "Mengerti" on a close job the server already answered for good: it only
   * leaves the list. A throw (storage refusing the write) stays on the row,
   * next to the button that can be pressed again, rather than vanishing as an
   * unhandled rejection.
   */
  const onAcknowledge = useCallback(async (id: string) => {
    if (!profile) return;
    setPendingId(id);
    setRowError((current) => (current?.id === id ? null : current));
    try {
      const result = await acknowledgeCloseEntry(profile.id, id);
      if (result.error) toast(result.error, 'critical');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRowError({ id, message: `Gagal menghapus dari ponsel ini: ${message}` });
    } finally {
      setPendingId((current) => (current === id ? null : current));
    }
  }, [profile, toast]);

  const onRowAction = (row: AttentionRow) => {
    if (row.action === 'discard') onDiscard(row.id, row.title);
    else if (row.action === 'cancel') onCancelClose(row);
    else if (row.action === 'acknowledge') void onAcknowledge(row.id);
    else void onRetry(row.id);
  };

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
            const danger = row.action === 'discard' || row.action === 'cancel';
            const label = ACTION_LABEL[row.action];
            return (
              <View key={row.id} style={styles.row}>
                <View style={styles.meta}>
                  <Text style={styles.title} numberOfLines={1}>{row.title}</Text>
                  <Text style={styles.reason} numberOfLines={2}>{row.reason}</Text>
                  {rowError?.id === row.id ? <Text style={styles.rowError}>{rowError.message}</Text> : null}
                </View>
                <TouchableOpacity
                  style={[danger ? styles.dangerBtn : styles.retryBtn, busy && styles.btnBusy]}
                  disabled={busy}
                  onPress={() => onRowAction(row)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  accessibilityLabel={closeIds.has(row.id) ? `${label} ${row.title}` : `${label} laporan ${row.title}`}
                >
                  <Text style={danger ? styles.dangerText : styles.retryText}>{label}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

const ACTION_LABEL: Record<AttentionRow['action'], string> = {
  retry: 'Coba lagi',
  discard: 'Buang',
  cancel: 'Batalkan',
  acknowledge: 'Mengerti',
};

const styles = StyleSheet.create({
  sectionLabel: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec, textTransform: 'uppercase', marginBottom: SPACE.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.sm, minHeight: 48,
    borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  meta: { flex: 1 },
  title: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  reason: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  rowError: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.critical, marginTop: 2 },
  retryBtn: { paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, minHeight: 40, justifyContent: 'center' },
  retryText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, textTransform: 'uppercase' },
  dangerBtn: { paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, minHeight: 40, justifyContent: 'center' },
  dangerText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.critical, textTransform: 'uppercase' },
  btnBusy: { opacity: 0.4 },
});
