import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACE, TYPE } from '../workflows/theme';

import OfficeHomeScreen from './screens/OfficeHomeScreen';
import ApprovalsScreen from './screens/ApprovalsScreen';
import OfficeProcurementScreen from './screens/OfficeProcurementScreen';
import MaterialCatalogScreen from './screens/MaterialCatalogScreen';
import OfficeReportsScreen from './screens/OfficeReportsScreen';
import OfficeBaselineScreen from './screens/OfficeBaselineScreen';
import MandorSetupScreen from '../workflows/screens/MandorSetupScreen';
import OpnameScreen from '../workflows/screens/OpnameScreen';

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

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons
              name={focused ? ICON_MAP_ACTIVE[route.name] : ICON_MAP[route.name]}
              size={size - 2}
              color={color}
            />
          ),
          tabBarLabel: ({ color }) => (
            <Text style={[styles.label, { color }]}>
              {LABEL_MAP[route.name]}
            </Text>
          ),
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.textMuted,
          tabBarStyle: {
            backgroundColor: COLORS.surface,
            borderTopWidth: 1,
            borderTopColor: COLORS.borderSub,
            height: 56 + Math.max(insets.bottom, SPACE.sm + 2),
            paddingBottom: Math.max(insets.bottom, SPACE.sm + 2),
            paddingTop: SPACE.sm,
          },
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
          children={() => <MandorSetupScreen onBack={() => {}} />}
          options={{ tabBarButton: () => null }}
        />
        <Tab.Screen
          name="Opname"
          children={() => <OpnameScreen onBack={() => {}} />}
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
});
