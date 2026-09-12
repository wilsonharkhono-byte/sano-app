import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, TouchableOpacity, StyleSheet, Linking, type DimensionValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatVoiceDuration, useVoiceRecorder } from '../../../tools/voiceRecorder';
import { newSiteEventId } from '../../../tools/siteEvents';
import { VOICE_NOTE_MAX_SECONDS } from '../../../tools/constants';
import type { CaptureVoice } from './captureModel';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';
import { formStyles as s } from './styles';

interface Props {
  value: CaptureVoice | null;
  onChange: (voice: CaptureVoice | null) => void;
  /** Fires whenever the recorder is mid-take (starting/recording/stopping), so the parent can hold Kirim until the file lands. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

const MAX_LABEL = formatVoiceDuration(VOICE_NOTE_MAX_SECONDS * 1000);

/** Metering is dBFS, roughly -60 (silence) to 0 (loud). */
function levelWidth(db: number | null): DimensionValue {
  const pct = db === null ? 0 : Math.max(0, Math.min(100, Math.round(((db + 60) / 60) * 100)));
  return `${pct}%` as DimensionValue;
}

/** Hold to record, release to stop, 90 s cap (spec §5.2). */
export default function VoiceNoteField({ value, onChange, onBusyChange, disabled = false }: Props) {
  const rec = useVoiceRecorder();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;

  useEffect(() => {
    if (rec.state.phase !== 'recorded' || !rec.state.uri) return;
    onChangeRef.current({
      id: newSiteEventId(),
      uri: rec.state.uri,
      durationMs: rec.state.durationMs,
      mimeType: rec.fileInfo.mimeType,
      ext: rec.fileInfo.ext,
      capturedAt: new Date().toISOString(),
    });
  }, [rec.state.phase, rec.state.uri, rec.state.durationMs, rec.fileInfo.mimeType, rec.fileInfo.ext]);

  // Kirim must wait for a take to finish landing, not just for the finger to lift.
  useEffect(() => {
    const busy = rec.state.phase === 'starting' || rec.state.phase === 'recording' || rec.state.phase === 'stopping';
    onBusyChangeRef.current?.(busy);
  }, [rec.state.phase]);

  if (value) {
    return (
      <View style={styles.doneBox}>
        <Ionicons name="mic" size={18} color={COLORS.ok} />
        <Text style={styles.doneText}>Suara terekam · {formatVoiceDuration(value.durationMs)}</Text>
        <TouchableOpacity
          style={styles.rerecord}
          onPress={() => {
            rec.reset();
            onChange(null);
          }}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Rekam ulang suara"
        >
          <Text style={styles.rerecordText}>Rekam ulang</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const live = rec.state.phase === 'recording' || rec.state.phase === 'starting';
  const saving = rec.state.phase === 'stopping';
  const label = saving
    ? 'Menyimpan rekaman…'
    : live
      ? `Merekam ${formatVoiceDuration(rec.state.durationMs)} / ${MAX_LABEL}`
      : 'Tahan untuk merekam';

  return (
    <View>
      <Pressable
        style={[styles.holdBtn, live && styles.holdBtnLive, (disabled || saving) && s.primaryBtnDisabled]}
        onPressIn={rec.start}
        onPressOut={rec.stop}
        disabled={disabled || saving}
        accessibilityRole="button"
        accessibilityLabel="Tahan untuk merekam suara"
      >
        <Ionicons name={live ? 'radio-button-on' : 'mic-outline'} size={22} color={live ? COLORS.textInverse : COLORS.text} />
        <Text style={[styles.holdText, live && styles.holdTextLive]}>{label}</Text>
      </Pressable>
      {live ? (
        <View style={styles.levelTrack}>
          <View style={[styles.levelFill, { width: levelWidth(rec.meteringDb) }]} />
        </View>
      ) : null}
      {rec.state.error ? (
        <View style={styles.errorRow}>
          <Text style={[s.errorText, styles.errorTextFlex]}>{rec.state.error}</Text>
          {rec.state.canAskAgain === false ? (
            <TouchableOpacity
              onPress={() => void Linking.openSettings()}
              accessibilityRole="button"
              accessibilityLabel="Buka Pengaturan"
            >
              <Text style={styles.settingsLink}>Buka Pengaturan</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      <Text style={s.hint}>Opsional. Maksimal {VOICE_NOTE_MAX_SECONDS} detik, berhenti otomatis.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  holdBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, minHeight: 56,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface,
  },
  holdBtnLive: { backgroundColor: COLORS.critical, borderColor: COLORS.critical },
  holdText: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  holdTextLive: { color: COLORS.textInverse },
  levelTrack: { height: 6, borderRadius: 3, backgroundColor: COLORS.trackBg, overflow: 'hidden', marginTop: SPACE.sm },
  levelFill: { height: '100%', backgroundColor: COLORS.critical },
  doneBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, padding: SPACE.md, minHeight: 56,
    borderWidth: 1, borderColor: COLORS.borderSub, borderRadius: RADIUS, backgroundColor: COLORS.okBg,
  },
  doneText: { flex: 1, fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text },
  rerecord: { paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, minHeight: 44, justifyContent: 'center' },
  rerecordText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, textTransform: 'uppercase' },
  errorRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACE.sm, marginTop: 4 },
  errorTextFlex: { flexShrink: 1 },
  settingsLink: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, textDecorationLine: 'underline' },
});
