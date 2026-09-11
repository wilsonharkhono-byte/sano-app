import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Linking } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import RoomPicker from './components/RoomPicker';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { parseRoomUrl } from '../../tools/roomLinks';
import { listRooms } from '../../tools/rooms';
import type { Room } from '../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../theme';

/**
 * Two ways to reach a room without a working label: the in-app scanner (native)
 * and the picker (web, and native when permission is refused). A QR that is not
 * a SANO room URL gets the spec §8 refusal, never a silent no-op.
 *
 * This is a hidden bottom-tab screen (`unmountOnBlur: true` in navigation.tsx),
 * but React Navigation does not guarantee an unmount on every host/version, so
 * the screen also defends itself: the scan lock resets on focus and the camera
 * only renders while focused, so a second visit never inherits a stale lock or
 * a background-running camera.
 */
export default function RoomScanScreen() {
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const { project } = useProject();
  const { show: toast } = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const [rooms, setRooms] = useState<Room[]>([]);
  // One scan per visit: CameraView fires onBarcodeScanned on every frame.
  const handled = useRef(false);
  const invalidScanTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isWeb = Platform.OS === 'web';

  // Reset the lock every time this screen gains focus, and drop any pending
  // "try again" timeout when it loses focus, so a blurred-not-unmounted screen
  // never fires a stale reset into a fresh visit.
  useFocusEffect(
    useCallback(() => {
      handled.current = false;
      return () => {
        if (invalidScanTimeout.current) {
          clearTimeout(invalidScanTimeout.current);
          invalidScanTimeout.current = null;
        }
      };
    }, []),
  );

  useEffect(() => {
    if (!project) return;
    void listRooms(project.id).then(setRooms);
  }, [project]);

  const goToRoom = useCallback((projectCode: string, roomCode: string) => {
    navigation.navigate('Room', { projectCode, roomCode });
  }, [navigation]);

  const onBarcodeScanned = useCallback(({ data }: { data: string }) => {
    if (handled.current) return;
    const target = parseRoomUrl(data);
    if (!target) {
      handled.current = true;
      toast('QR bukan label ruangan SANO.', 'critical');
      // Let the supervisor try again on the next label after a beat.
      invalidScanTimeout.current = setTimeout(() => {
        handled.current = false;
        invalidScanTimeout.current = null;
      }, 1500);
      return;
    }
    handled.current = true;
    goToRoom(target.projectCode, target.roomCode);
  }, [goToRoom, toast]);

  const isPermanentlyDenied = !isWeb && !!permission && !permission.granted && !permission.canAskAgain;

  const pickerNote = isWeb
    ? 'Pemindai QR hanya tersedia di aplikasi Android. Pilih ruangan dari daftar.'
    : 'Pilih ruangan dari daftar bila labelnya hilang atau rusak.';

  return (
    <View style={styles.flex}>
      <Header />
      <View style={styles.content}>
        <Text style={styles.sectionHead}>Scan ruangan</Text>

        {!isWeb && permission?.granted && isFocused && (
          <View style={styles.cameraBox}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onBarcodeScanned}
            />
            <View style={styles.reticle} pointerEvents="none" />
          </View>
        )}

        {!isWeb && !permission?.granted && (
          <View style={styles.permBox}>
            <Ionicons name="camera-outline" size={28} color={COLORS.textSec} />
            {isPermanentlyDenied ? (
              <>
                <Text style={styles.permText}>
                  Akses kamera untuk SANO telah dimatikan. Aktifkan lagi lewat Pengaturan untuk memindai label QR ruangan.
                </Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => void Linking.openSettings()}>
                  <Text style={styles.primaryText}>Buka Pengaturan</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.permText}>
                  SANO perlu izin kamera untuk memindai label QR ruangan.
                </Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => void requestPermission()}>
                  <Text style={styles.primaryText}>Izinkan kamera</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        <View style={styles.pickerBox}>
          <RoomPicker
            rooms={rooms}
            note={pickerNote}
            onSelect={(r) => project && goToRoom(project.code, r.room_code)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, padding: SPACE.base },
  sectionHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.6, textTransform: 'uppercase',
    color: COLORS.textSec, marginBottom: SPACE.sm,
  },
  cameraBox: { height: 260, borderRadius: RADIUS, overflow: 'hidden', backgroundColor: COLORS.primary, marginBottom: SPACE.base },
  reticle: {
    position: 'absolute', top: '20%', left: '20%', right: '20%', bottom: '20%',
    borderWidth: 2, borderColor: COLORS.textInverse, borderRadius: RADIUS,
  },
  permBox: { alignItems: 'center', gap: SPACE.sm, padding: SPACE.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS, marginBottom: SPACE.base },
  permText: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center', lineHeight: 18 },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.lg },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
  pickerBox: { flex: 1 },
});
