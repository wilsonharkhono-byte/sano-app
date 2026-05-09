import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACE, TYPE, BREAKPOINTS } from '../workflows/theme';
import { lazyScreen } from '../workflows/components/LazyScreen';
import { useProject } from '../workflows/hooks/useProject';
import { useUnreadCount } from '../workflows/screens/hooks/useUnreadCount';
import { navigationRef } from '../workflows/App';
import NotificationsScreen from './screens/NotificationsScreen';

const PrincipalHomeScreen = lazyScreen(() => import('./screens/PrincipalHomeScreen'));
const ApprovalsScreen = lazyScreen(() => import('./screens/ApprovalsScreen'));
const OfficeReportsScreen = lazyScreen(() => import('./screens/OfficeReportsScreen'));

export type PrincipalTabParamList = {
  Home: undefined;
  Approvals: undefined;
  Reports: undefined;
  Notifikasi: undefined;
};

const Tab = createBottomTabNavigator<PrincipalTabParamList>();

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Approvals: 'checkmark-done-outline',
  Reports: 'bar-chart-outline',
  Notifikasi: 'notifications-outline',
};

const ICON_MAP_ACTIVE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home',
  Approvals: 'checkmark-done',
  Reports: 'bar-chart',
  Notifikasi: 'notifications',
};

const LABEL_MAP: Record<string, string> = {
  Home: 'Beranda',
  Approvals: 'Approval',
  Reports: 'Laporan',
  Notifikasi: 'Notifikasi',
};

export default function PrincipalNavigation() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { profile } = useProject();
  const unread = useUnreadCount(profile?.id);

  const isWide    = width >= BREAKPOINTS.tablet;
  const barHeight = isWide
    ? 64 + Math.max(insets.bottom, SPACE.sm)
    : 56 + Math.max(insets.bottom, SPACE.sm + 2);
  const iconSize  = isWide ? 26 : 22;
  const labelStyle = isWide ? styles.labelWide : styles.label;

  return (
    <NavigationContainer ref={navigationRef}>
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
            <Text style={[labelStyle, { color }]} numberOfLines={1}>
              {LABEL_MAP[route.name]}
            </Text>
          ),
          tabBarActiveTintColor: COLORS.primary,
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
        <Tab.Screen name="Home" component={PrincipalHomeScreen} />
        <Tab.Screen name="Approvals" component={ApprovalsScreen} />
        <Tab.Screen name="Reports" component={OfficeReportsScreen} />
        <Tab.Screen
          name="Notifikasi"
          options={{
            tabBarBadge: unread > 0 ? unread : undefined,
          }}
        >
          {() => <NotificationsScreen profileId={profile!.id} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    letterSpacing: 0.3,
    marginTop: 1,
  },
  labelWide: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    letterSpacing: 0.3,
    marginTop: 2,
  },
});
