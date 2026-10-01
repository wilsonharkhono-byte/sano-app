import React, { useSyncExternalStore } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { getPushStatus, subscribePushStatus, type PushStatus } from '../../tools/pushStatus';
import { COLORS, SPACE, TYPE } from '../theme';

const LABELS: Record<PushStatus, string> = {
  unknown: 'Memeriksa...',
  active: 'Aktif',
  denied: 'Izin ditolak - ketuk untuk membuka Pengaturan',
  error: 'Gagal mendaftar - tutup lalu buka lagi aplikasi',
  unsupported: 'Tidak didukung di perangkat ini',
};

const TONES: Record<PushStatus, string> = {
  unknown: COLORS.textSec,
  active: COLORS.ok,
  denied: COLORS.warning,
  error: COLORS.critical,
  unsupported: COLORS.textSec,
};

// Lets the office see at a glance whether this phone can receive pushes.
export default function PushStatusLine() {
  const status = useSyncExternalStore(subscribePushStatus, getPushStatus, getPushStatus);
  const label = <Text style={[styles.text, { color: TONES[status] }]}>{LABELS[status]}</Text>;

  if (status !== 'denied') return label;
  return (
    <TouchableOpacity accessibilityRole="button" onPress={() => { void Linking.openSettings(); }}>
      {label}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: TYPE.sm, marginTop: SPACE.xs },
});
