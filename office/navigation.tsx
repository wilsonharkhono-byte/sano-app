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
import { buildLinking, ROOM_PATH } from '../workflows/linking';

const OfficeHomeScreen = lazyScreen(() => import('./screens/OfficeHomeScreen'));
const ApprovalsScreen = lazyScreen(() => import('./screens/ApprovalsScreen'));
const OfficeProcurementScreen = lazyScreen(() => import('./screens/OfficeProcurementScreen'));
const MaterialCatalogScreen = lazyScreen(() => import('./screens/MaterialCatalogScreen'));
const EquipmentScreen = lazyScreen(() => import('./screens/EquipmentScreen'));
const RoomsAdminScreen = lazyScreen(() => import('./screens/RoomsAdminScreen'));
const OfficeReportsScreen = lazyScreen(() => import('./screens/OfficeReportsScreen'));
const OfficeBaselineScreen = lazyScreen(() => import('./screens/OfficeBaselineScreen'));
const MandorSetupScreen = lazyScreen(() => import('../workflows/screens/MandorSetupScreen'));
const OpnameScreen = lazyScreen(() => import('../workflows/screens/OpnameScreen'));
const RoomDetailScreen = lazyScreen(() => import('./screens/RoomDetailScreen'));
const SiteEventDetailScreen = lazyScreen(() => import('../workflows/screens/SiteEventDetailScreen'));

export type OfficeTabParamList = {
  Home: undefined;
  Baseline: undefined;
  Approvals: undefined;
  Procurement: undefined;
  Materials: undefined;
  Equipment: undefined;
  Rooms: undefined;
  Mandor: undefined;
  Opname: undefined;
  Reports: undefined;
  Notifikasi: undefined;
  RoomDetail: { projectCode: string; roomCode: string };
  SiteEventDetail: { eventId: string; projectId: string };
};

const linking = buildLinking<OfficeTabParamList>({
  Home:       '',
  RoomDetail: ROOM_PATH,
});

const Tab = createBottomTabNavigator<OfficeTabParamList>();

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Baseline: 'cloud-upload-outline',
  Approvals: 'checkmark-done-outline',
  Procurement: 'pricetag-outline',
  Materials: 'layers-outline',
  Equipment: 'construct-outline',
  Rooms: 'business-outline',
  Mandor: 'people-outline',
  Opname: 'receipt-outline',
  Reports: 'bar-chart-outline',
  Notifikasi: 'notifications-outline',
  RoomDetail: 'business-outline',
  SiteEventDetail: 'document-text-outline',
};

const ICON_MAP_ACTIVE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home',
  Baseline: 'cloud-upload',
  Approvals: 'checkmark-done',
  Procurement: 'pricetag',
  Materials: 'layers',
  Equipment: 'construct',
  Rooms: 'business',
  Mandor: 'people',
  Opname: 'receipt',
  Reports: 'bar-chart',
  Notifikasi: 'notifications',
  RoomDetail: 'business',
  SiteEventDetail: 'document-text',
};

const LABEL_MAP: Record<string, string> = {
  Home: 'Beranda',
  Baseline: 'Baseline',
  Approvals: 'Approval',
  Procurement: 'Harga',
  Materials: 'Katalog',
  Equipment: 'Alat',
  Rooms: 'Ruangan',
  Mandor: 'Mandor',
  Opname: 'Opname',
  Reports: 'Laporan',
  Notifikasi: 'Notifikasi',
  RoomDetail: 'Ruangan',
  SiteEventDetail: 'Kejadian',
};

export default function OfficeNavigation() {
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
    <NavigationContainer ref={navigationRef} linking={linking}>
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
        <Tab.Screen name="Home" component={OfficeHomeScreen} />
        <Tab.Screen
          name="Baseline"
          component={OfficeBaselineScreen}
          options={{ tabBarButton: () => null }}
        />
        <Tab.Screen name="Approvals" component={ApprovalsScreen} />
        <Tab.Screen name="Procurement" component={OfficeProcurementScreen} />
        <Tab.Screen name="Materials" component={MaterialCatalogScreen} />
        <Tab.Screen name="Equipment" component={EquipmentScreen} />
        <Tab.Screen name="Rooms" component={RoomsAdminScreen} />
        <Tab.Screen name="RoomDetail" component={RoomDetailScreen} options={{ tabBarButton: () => null }} />
        <Tab.Screen name="SiteEventDetail" component={SiteEventDetailScreen} options={{ tabBarButton: () => null, unmountOnBlur: true }} />
        {/* Mandor setup and Opname are accessed from the workflow Progres tab, not as standalone tabs */}
        <Tab.Screen
          name="Mandor"
          children={({ navigation }) => (
            <MandorSetupScreen
              onBack={() => navigation.navigate('Reports')}
              onOpenAttendanceContract={(contract) => {
                navigation.navigate('Reports', {
                  screen: 'Attendance',
                  params: { contractId: contract.id },
                });
              }}
            />
          )}
          options={{ tabBarButton: () => null }}
        />
        <Tab.Screen
          name="Opname"
          children={({ navigation }) => <OpnameScreen onBack={() => navigation.navigate('Reports')} />}
          options={{ tabBarButton: () => null }}
        />
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
