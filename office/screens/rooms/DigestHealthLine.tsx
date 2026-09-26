import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { getDigestHealth, type DigestHealthResult } from '../../../tools/siteEventAttention';
import { formatWibShort } from '../../../tools/timeWindow';
import { COLORS, FONTS, SPACE, TYPE } from '../../../workflows/theme';

/**
 * The office health line under "Perlu ditindak" (closure spec 2026-09-26
 * §5.6). It reads site_event_digest_log through v_site_event_digest_health,
 * which records SENDS, not runs: a morning on which nobody needed a message
 * leaves no trace, so "belum pernah terkirim" is the only empty sentence the
 * table can prove. A failed read says so, never "belum pernah".
 */
export default function DigestHealthLine({ reloadKey }: { reloadKey?: number }) {
  const [result, setResult] = useState<DigestHealthResult | null>(null);

  const load = useCallback(async () => {
    setResult(null);
    setResult(await getDigestHealth());
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (result === null) {
    return <Text style={styles.muted}>Memuat status pengingat harian…</Text>;
  }
  if ('error' in result) {
    return (
      <View style={styles.row}>
        <Text style={styles.error}>Status pengingat harian gagal dimuat.</Text>
        <TouchableOpacity onPress={() => void load()} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.link}>Coba lagi</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (result.last === null) {
    return <Text style={styles.muted}>Pengingat harian belum pernah terkirim</Text>;
  }
  return (
    <Text style={styles.muted}>
      Pengingat terakhir: {formatWibShort(result.last.last_sent_at)} · {result.last.recipients} orang
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' },
  muted: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginBottom: SPACE.sm, paddingHorizontal: SPACE.xs },
  error: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.critical },
  retry: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary },
});
