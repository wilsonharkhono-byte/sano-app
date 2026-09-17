// workflows/components/analytics/LoadBody.tsx
// SANO — what every analytics card shows while it loads or when its read
// failed: never an empty chart that looks like "no data".
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { a } from './analyticsStyles';

interface Props { status: 'loading' | 'ready' | 'error'; error: string | null; onRetry: () => void; label: string; children: React.ReactNode }

export default function LoadBody({ status, error, onRetry, label, children }: Props) {
  if (status === 'loading') return <ActivityIndicator accessibilityLabel={`Memuat ${label}`} />;
  if (status === 'error') {
    return (
      <View>
        <Text style={a.error}>{`${label} gagal dimuat: ${error}`}</Text>
        <TouchableOpacity style={a.ghostBtn} onPress={onRetry} accessibilityRole="button" accessibilityLabel={`Muat ulang ${label}`}>
          <Text style={a.ghostBtnText}>Coba lagi</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return <>{children}</>;
}
