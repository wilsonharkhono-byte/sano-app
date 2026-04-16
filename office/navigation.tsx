import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACE, TYPE, BREAKPOINTS } from '../workflows/theme';
import { lazyScreen } from '../workflows/components/LazyScreen';

const OfficeHomeScreen = lazyScreen(() => import('./screens/OfficeHomeScreen'));
const ApprovalsScreen = lazyScreen(() => import('./screens/ApprovalsScreen'));
const OfficeProcurementScreen = lazyScreen(() => import('./screens/OfficeProcurementScreen'));
const MaterialCatalogScreen = lazyScreen(() => import('./screens/MaterialCatalogScreen'));
const OfficeReportsScreen = lazyScreen(() => import('./screens/OfficeReportsScreen'));
const OfficeBaselineScreen = lazyScreen(() => import('./screens/OfficeBaselineScreen'));
const MandorSetupScreen = lazyScreen(() => import('../workflows/screens/MandorSetupScreen'));
const OpnameScreen = lazyScreen(() => import('../workflows/screens/OpnameScreen'));

export type OfficeTabParamList = {
  Home: undefined;
  Baseline: undefined;
  Approvals: undefined;
  Procurement: undefined;
  Materials: undefined;
  Mandor: undefined;
  Opname: undefined;
  Reports: undefined;
};

const Tab = createBottomTabNavigator<OfficeTabParamList>();

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Baseline: 'cloud-upload-outline',
  Approvals: 'checkmark-done-outline',
  Procurement: 'pricetag-outline',
  Materials: 'layers-outline',
  Mandor: 'people-outline',
  Opname: 'receipt-outline',
  Reports: 'bar-chart-outline',
};

const ICON_MAP_ACTIVE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home',
  Baseline: 'cloud-upload',
  Approvals: 'checkmark-done',
  Procurement: 'pricetag',
  Materials: 'layers',
  Mandor: 'people',
  Opname: 'receipt',
  Reports: 'bar-chart',
};

const LABEL_MAP: Record<string, string> = {
  Home: 'Beranda',
  Baseline: 'Baseline',
  Approvals: 'Approval',
  Procurement: 'Harga',
  Materials: 'Katalog',
  Mandor: 'Mandor',
  Opname: 'Opname',
  Reports: 'Laporan',
};

export default function OfficeNavigation() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const isWide    = width >= BREAKPOINTS.tablet;
  const barHeight = isWide
    ? 64 + Math.max(insets.bottom, SPACE.sm)
    : 56 + Math.max(insets.bottom, SPACE.sm + 2);
  const iconSize  = isWide ? 26 : 22;
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
