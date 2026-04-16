import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import { COLORS, FONTS, TYPE, SPACE, BREAKPOINTS } from './theme';
import { lazyScreen } from './components/LazyScreen';

const BerandaScreen = lazyScreen(() => import('./screens/BerandaScreen'));
const PermintaanScreen = lazyScreen(() => import('./screens/PermintaanScreen'));
const TerimaScreen = lazyScreen(() => import('./screens/TerimaScreen'));
const ProgresScreen = lazyScreen(() => import('./screens/ProgresScreen'));
const LaporanScreen = lazyScreen(() => import('./screens/LaporanScreen'));

export type TabParamList = {
  Beranda:    undefined;
  Permintaan: undefined;
  Terima:     undefined;
  Progres:    undefined;
  Laporan:    { initialSection?: 'overview' | 'mtn' | 'baseline' | 'gate2' | 'jadwal' } | undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

// More descriptive icons — arrows removed in favour of semantic icons
const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  Beranda:    'home-outline',
  Permintaan: 'clipboard-outline',   // was arrow-forward (generic)
  Terima:     'download-outline',     // was arrow-down (generic)
  Progres:    'trending-up-outline',
  Laporan:    'bar-chart-outline',    // was document-text
};

const ICON_MAP_ACTIVE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Beranda:    'home',
  Permintaan: 'clipboard',
  Terima:     'download',
  Progres:    'trending-up',
  Laporan:    'bar-chart',
};

export default function AppNavigation() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Tablet/desktop: taller bar, more icon padding, always-visible labels
  const isWide     = width >= BREAKPOINTS.tablet;
  const barHeight  = isWide
    ? 64 + Math.max(insets.bottom, SPACE.sm)   // taller on wide screens
    : 56 + Math.max(insets.bottom, SPACE.sm + 2);
  const iconSize   = isWide ? 26 : 22;         // larger icons on tablet/desktop
  const labelStyle = isWide ? styles.labelWide : styles.label;

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? ICON_MAP_ACTIVE[route.name] : ICON_MAP[route.name]}
              size={iconSize}
              color={color}
            />
          ),
          tabBarLabel: ({ color }) => (
            <Text style={[labelStyle, { color }]}>
              {route.name}
            </Text>
          ),
          tabBarActiveTintColor:   COLORS.primary,
          tabBarInactiveTintColor: COLORS.textMuted,
          tabBarStyle: {
            backgroundColor: COLORS.surface,
            borderTopWidth: 1,
            borderTopColor: COLORS.borderSub,
            height: barHeight,
            paddingBottom: Math.max(insets.bottom, SPACE.sm + 2),
            paddingTop: isWide ? SPACE.md : SPACE.sm,
          },
          tabBarLabelPosition: 'below-icon',
          headerShown: false,
        })}
      >
        <Tab.Screen
          name="Beranda"
          component={BerandaScreen}
          options={{ tabBarAccessibilityLabel: 'Beranda — halaman utama' }}
        />
        <Tab.Screen
          name="Permintaan"
          component={PermintaanScreen}
          options={{ tabBarAccessibilityLabel: 'Permintaan material' }}
        />
        <Tab.Screen
          name="Terima"
          component={TerimaScreen}
          options={{ tabBarAccessibilityLabel: 'Terima material' }}
        />
        <Tab.Screen
          name="Progres"
          component={ProgresScreen}
          options={{ tabBarAccessibilityLabel: 'Input progres lapangan' }}
        />
        <Tab.Screen
          name="Laporan"
          component={LaporanScreen}
          options={{ tabBarAccessibilityLabel: 'Laporan dan ekspor' }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  // Phone — compact label below icon
  label: {
    fontSize: TYPE.xs,       // 12dp — readable on all phone sizes
    fontFamily: FONTS.semibold,
    letterSpacing: 0.3,
    marginTop: 1,
  },
  // Tablet / desktop — slightly larger, more breathing room
  labelWide: {
    fontSize: TYPE.sm,       // 13dp — comfortable at tablet density
    fontFamily: FONTS.semibold,
    letterSpacing: 0.3,
    marginTop: 2,
  },
});
