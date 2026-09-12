import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SITE_EVENT_TYPE_LABELS } from '../../../tools/constants';
import { REWORDING_NOTE, PULL_EMPTY_NOTE, type ProposedHighlight, type ProposedPhoto } from '../../../tools/dailyLogPull';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

/**
 * "Tarik dari kejadian ruangan" (spec §10.1). A picker, not an importer: it
 * shows every confirmed event of the day, pre-ticks only the two client-safe
 * types, and hands the curator's selection back. Nothing here saves.
 *
 * The four internal types are deliberately VISIBLE and unticked. Hiding them
 * would leave the curator unaware that the day had a blocker in it; ticking
 * them would put "Cacat: nat retak di KM utama" in front of a client in the
 * words a supervisor used for their own foreman.
 */
export default function PullEventsSheet(props: {
  loading: boolean;
  highlights: ProposedHighlight[];
  photos: ProposedPhoto[];
  onCancel: () => void;
  onApply: (picked: { highlights: ProposedHighlight[]; photos: ProposedPhoto[] }) => void;
}) {
  const { loading, highlights, photos, onCancel, onApply } = props;

  const [pickedH, setPickedH] = useState<Set<string>>(
    () => new Set(highlights.filter((h) => h.preselected).map((h) => h.eventId)),
  );
  const [pickedP, setPickedP] = useState<Set<string>>(() => new Set());

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    apply(next);
  };

  const chosen = useMemo(() => ({
    highlights: highlights.filter((h) => pickedH.has(h.eventId)),
    photos: photos.filter((p) => pickedP.has(p.mediaId)),
  }), [highlights, photos, pickedH, pickedP]);

  const total = chosen.highlights.length + chosen.photos.length;

  if (loading) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={styles.note}>Memuat kejadian…</Text>
      </View>
    );
  }

  if (highlights.length === 0 && photos.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.note}>{PULL_EMPTY_NOTE}</Text>
        <TouchableOpacity style={styles.ghostBtn} onPress={onCancel}>
          <Text style={styles.ghostText}>Tutup</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {highlights.length > 0 && <Text style={styles.section}>Catatan ({highlights.length})</Text>}
      {highlights.map((h) => {
        const on = pickedH.has(h.eventId);
        return (
          <TouchableOpacity
            key={h.eventId}
            style={styles.row}
            onPress={() => toggle(pickedH, h.eventId, setPickedH)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <Ionicons
              name={on ? 'checkbox' : 'square-outline'}
              size={20}
              color={on ? COLORS.primary : COLORS.textMuted}
            />
            <View style={styles.rowBody}>
              <Text style={styles.rowMeta}>
                {h.roomLabel} · {SITE_EVENT_TYPE_LABELS[h.eventType]}
              </Text>
              <Text style={styles.rowNote}>{h.highlight.note}</Text>
              {h.needsRewording && <Text style={styles.warn}>{REWORDING_NOTE}</Text>}
            </View>
          </TouchableOpacity>
        );
      })}

      {photos.length > 0 && <Text style={styles.section}>Foto konteks ({photos.length})</Text>}
      {photos.map((p) => {
        const on = pickedP.has(p.mediaId);
        return (
          <TouchableOpacity
            key={p.mediaId}
            style={styles.row}
            onPress={() => toggle(pickedP, p.mediaId, setPickedP)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <Ionicons
              name={on ? 'checkbox' : 'square-outline'}
              size={20}
              color={on ? COLORS.primary : COLORS.textMuted}
            />
            <View style={styles.rowBody}>
              <Text style={styles.rowMeta}>{p.roomLabel}</Text>
              <Text style={styles.rowNote}>Foto konteks · beri keterangan setelah ditarik</Text>
            </View>
          </TouchableOpacity>
        );
      })}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghostBtn} onPress={onCancel}>
          <Text style={styles.ghostText}>Batal</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryBtn, total === 0 && { opacity: 0.5 }]}
          disabled={total === 0}
          onPress={() => onApply(chosen)}
        >
          <Text style={styles.primaryText}>Tarik {total > 0 ? `(${total})` : ''}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACE.xs, paddingTop: SPACE.sm },
  section: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.accentDark, letterSpacing: 1, textTransform: 'uppercase', marginTop: SPACE.md },
  row: { flexDirection: 'row', gap: SPACE.sm, alignItems: 'flex-start', paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  rowBody: { flex: 1 },
  rowMeta: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  rowNote: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, marginTop: 2, lineHeight: 18 },
  warn: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.warning, marginTop: 4, lineHeight: 16 },
  note: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, paddingVertical: SPACE.sm },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  ghostBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  ghostText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  primaryBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse },
});
