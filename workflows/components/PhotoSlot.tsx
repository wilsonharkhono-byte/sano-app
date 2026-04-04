import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS } from '../theme';
import { resolvePhotoUrl } from '../../tools/storage';

interface Props {
  label: string;
  captured: boolean;
  capturedTime?: string;
  gpsLabel?: string;
  photoPath?: string | null;
  helperText?: string;
  onPress: () => void;
}

export default function PhotoSlot({ label, captured, capturedTime, gpsLabel, photoPath, helperText, onPress }: Props) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    if (!photoPath) {
      setPhotoUrl(null);
      return () => {
        alive = false;
      };
    }

    resolvePhotoUrl(photoPath)
      .then((url) => {
        if (alive) setPhotoUrl(url);
      })
      .catch(() => {
        if (alive) setPhotoUrl(null);
      });

    return () => {
      alive = false;
    };
  }, [photoPath]);

  return (
    <TouchableOpacity
      style={[styles.slot, captured && styles.captured]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {captured && photoUrl ? (
        <>
          <View style={styles.previewFrame}>
            <Image source={{ uri: photoUrl }} style={styles.preview} resizeMode="contain" />
          </View>
          <View style={styles.previewMeta}>
            <Text style={styles.capturedTitle}>Foto Tersimpan</Text>
            <Text style={styles.capturedHint}>
              {capturedTime ? capturedTime : 'Ketuk untuk ambil ulang'}
              {gpsLabel ? `\n${gpsLabel}` : ''}
            </Text>
            <Text style={styles.retakeLabel}>Ketuk untuk ambil ulang</Text>
          </View>
        </>
      ) : (
        <>
          <Ionicons
            name={captured ? 'checkmark-circle' : 'add-circle-outline'}
            size={28}
            color={captured ? COLORS.ok : COLORS.border}
          />
          <Text style={styles.label}>
            {captured ? `Foto Diambil${capturedTime ? '\n' + capturedTime : ''}${gpsLabel ? '\n' + gpsLabel : ''}` : label}
          </Text>
        </>
      )}
      {helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  slot: {
    backgroundColor: '#f5f3f0',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 4,
  },
  captured: { borderStyle: 'solid', borderColor: COLORS.ok, backgroundColor: 'rgba(76,175,80,0.05)' },
  previewFrame: {
    width: '100%',
    height: 132,
    borderRadius: RADIUS - 4,
    backgroundColor: '#e9e5de',
    marginBottom: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  previewMeta: {
    width: '100%',
    alignItems: 'center',
    gap: 2,
  },
  capturedTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', color: COLORS.ok },
  capturedHint: { fontSize: 11, color: COLORS.textSec, textAlign: 'center', lineHeight: 15 },
  retakeLabel: { fontSize: 11, fontWeight: '600', color: COLORS.primary, textTransform: 'uppercase', marginTop: 2 },
  label: { fontSize: 11, color: COLORS.textSec, textAlign: 'center', fontWeight: '500', textTransform: 'uppercase', lineHeight: 16 },
  helper: { fontSize: 11, color: COLORS.textSec, textAlign: 'center', lineHeight: 15, marginTop: 4 },
});
