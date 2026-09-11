import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { signedMediaUrl } from '../../../tools/siteEvents';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';
import { formStyles as s } from './styles';

interface Props {
  /** Path inside the private site-media bucket; signed here, never stored signed. */
  storagePath: string;
  /** The duration recorded at capture, used until the player reports its own. */
  durationS: number | null;
}

/** `m:ss`. A zero or missing duration is `0:00`, never a blank. */
export function formatClock(seconds: number | null | undefined): string {
  const total = Number.isFinite(Number(seconds)) ? Math.max(0, Math.round(Number(seconds))) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Plays the voice note the draft was transcribed from (spec §5.4 "Bukti").
 *
 * Loaded ONLY through React.lazy from MediaStrip, and only when the event
 * actually has an audio item: this module is the single import of expo-audio
 * on the read path, and the office and principal bundles render site events
 * too. A static import here would pull the native audio module into every one
 * of them.
 *
 * The transcript stays the authoritative text — this is for checking a word
 * the model may have misheard before editing it, which is the input to the VO
 * evidence rule on the confirm screen.
 */
export default function AudioPlayback({ storagePath, durationS }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    setUrl(null);
    setFailed(false);
    void signedMediaUrl(storagePath).then((signed) => {
      if (!current || !alive.current) return;
      // resolvePhotoUrl can hand back an empty string as well as null; both
      // mean "no playable object", and passing '' to the player would leave it
      // stuck in a permanent not-loaded state with no error to show.
      if (signed) setUrl(signed);
      else setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [storagePath]);

  const player = useAudioPlayer(url ?? null);
  const status = useAudioPlayerStatus(player);

  if (failed) {
    return (
      <View style={styles.row}>
        <Ionicons name="alert-circle-outline" size={18} color={COLORS.textSec} />
        <Text style={styles.text}>Rekaman tidak bisa dimuat.</Text>
      </View>
    );
  }

  const ready = !!url && status.isLoaded;
  // The player reports 0 until the source is loaded; fall back to the duration
  // recorded at capture so the strip does not flicker from a real length to 0:00.
  const total = status.duration > 0 ? status.duration : durationS ?? 0;
  const elapsed = status.currentTime > 0 ? status.currentTime : 0;

  const toggle = () => {
    if (!ready) return;
    if (status.playing) {
      player.pause();
      return;
    }
    // didJustFinish leaves the head at the end; rewind so a second tap replays.
    if (status.didJustFinish || (total > 0 && elapsed >= total)) void player.seekTo(0);
    player.play();
  };

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.button, !ready && styles.buttonDisabled]}
        onPress={toggle}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Jeda rekaman suara' : 'Putar rekaman suara'}
        accessibilityState={{ disabled: !ready }}
      >
        <Ionicons name={status.playing ? 'pause' : 'play'} size={18} color={COLORS.textInverse} />
      </TouchableOpacity>
      <Text style={styles.text}>
        {ready
          ? `${formatClock(elapsed)} / ${formatClock(total)}`
          : `Memuat rekaman… · ${formatClock(durationS)}`}
      </Text>
      <Text style={s.hint}>Isinya ada di transkrip.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.sm },
  button: {
    width: 44, height: 44, borderRadius: RADIUS, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.45 },
  text: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec },
});
