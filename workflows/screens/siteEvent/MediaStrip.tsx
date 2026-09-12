import React, { Suspense, useEffect, useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { signedMediaUrl } from '../../../tools/siteEvents';
import type { SiteEventMedia } from '../../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';
import { formStyles as s } from './styles';

const ROLE_LABELS: Record<string, string> = {
  context: 'Konteks',
  closeup: 'Close-up',
  closure: 'Penutupan',
  audio: 'Suara',
};

/**
 * The playback control is the ONLY thing on the read path that touches
 * expo-audio, and the office and principal bundles render site events without
 * ever showing one. Lazy so the native audio module is pulled in at the moment
 * an event actually has a voice note, not at import time.
 */
const AudioPlayback = React.lazy(() => import('./AudioPlayback'));

/** Local formatter: importing tools/voiceRecorder here would pull expo-audio into the office bundles. */
function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function Thumb({ item }: { item: SiteEventMedia }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void signedMediaUrl(item.storage_path).then((signed) => {
      if (!alive) return;
      setUrl(signed);
      setFailed(!signed);
    });
    return () => {
      alive = false;
    };
  }, [item.storage_path]);

  return (
    <View style={styles.thumb}>
      {url ? (
        <Image source={{ uri: url }} style={styles.image} resizeMode="cover" accessibilityLabel={`Foto ${ROLE_LABELS[item.role] ?? item.role}`} />
      ) : (
        <View style={styles.placeholder}>
          <Ionicons name="image-outline" size={20} color={COLORS.textSec} />
          <Text style={styles.placeholderText}>{failed ? 'Foto tidak bisa dimuat' : 'Memuat foto'}</Text>
        </View>
      )}
      <Text style={styles.caption}>{ROLE_LABELS[item.role] ?? item.role}</Text>
    </View>
  );
}

/** Read-only evidence: signed thumbnails from the private bucket, and the voice note's length. */
export default function MediaStrip({ media }: { media: SiteEventMedia[] }) {
  const photos = media.filter((m) => m.kind === 'photo');
  const audio = media.find((m) => m.kind === 'audio');
  return (
    <View>
      {photos.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {photos.map((m) => (
            <Thumb key={m.id} item={m} />
          ))}
        </ScrollView>
      ) : (
        <Text style={s.empty}>Tidak ada foto.</Text>
      )}
      {audio ? (
        <View>
          <View style={styles.audioRow}>
            <Ionicons name="mic-outline" size={16} color={COLORS.textSec} />
            {/* `audio.duration_s ? …` hid the length of a 0-second note, which
                is exactly the note a supervisor needs told about. Only a NULL
                duration is unknown; 0 is a fact, and reads 0:00. */}
            <Text style={styles.audioText}>
              Rekaman suara{audio.duration_s != null ? ` · ${formatSeconds(Number(audio.duration_s))}` : ''}.
            </Text>
          </View>
          <Suspense fallback={<Text style={s.hint}>Memuat pemutar…</Text>}>
            <AudioPlayback storagePath={audio.storage_path} durationS={audio.duration_s} />
          </Suspense>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: SPACE.sm, paddingVertical: SPACE.xs },
  thumb: { width: 132 },
  image: { width: 132, height: 104, borderRadius: RADIUS, backgroundColor: COLORS.surfaceAlt },
  placeholder: {
    width: 132, height: 104, borderRadius: RADIUS, backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center', justifyContent: 'center', gap: 4, padding: SPACE.xs,
  },
  placeholderText: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center' },
  caption: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, marginTop: 4 },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.sm },
  audioText: { flex: 1, fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec },
});
