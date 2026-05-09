import React, { Suspense, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Platform, View } from 'react-native';
import * as Font from 'expo-font';
import { createNavigationContainerRef } from '@react-navigation/native';
import { supabase } from '../tools/supabase';
import { Session } from '@supabase/supabase-js';
import { ProjectProvider, useProject } from './hooks/useProject';
import { COLORS } from './theme';
import { lazyScreen } from './components/LazyScreen';
import { registerForPushNotifications, attachNotificationTapListener } from '../tools/notifications';

// Module-scoped so all three role-based NavigationContainers share the same ref.
// The push-notification tap listener navigates through this ref from outside the React tree.
export const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

// Notification deeplink screen names may not match the role's nav routes.
// Map to actual route names; fall back to the Notifikasi tab if the role's
// stack doesn't have that route (e.g., supervisor has no Approvals tab).
const NOTIFICATION_ROUTE_MAP: Record<string, string> = {
  ApprovalsScreen: 'Approvals',
  POScreen: 'Procurement',
  ReceiptScreen: 'Terima',
};

const AppNavigation = lazyScreen(() => import('./navigation'));
const LoginScreen = lazyScreen(() => import('./screens/LoginScreen'));
const OfficeNavigation = lazyScreen(() => import('../office/navigation'));
const PrincipalNavigation = lazyScreen(() => import('../office/PrincipalNavigation'));
const GlobalAIChatLauncher = React.lazy(() => import('./components/GlobalAIChatLauncher'));

// Routes to supervisor app or office dashboard based on profile role.
// Must be rendered inside ProjectProvider so useProject() works.
function RoleRouter() {
  const { profile, loading } = useProject();

  // Register the Expo push token once the profile is known.
  useEffect(() => {
    if (profile?.id) {
      void registerForPushNotifications(profile.id);
    }
  }, [profile?.id]);

  // Wire the global tap listener exactly once. Cross-stack deeplink navigation
  // happens through the module-scoped navigationRef shared by all three navigators.
  useEffect(() => {
    const cleanup = attachNotificationTapListener((screen, params) => {
      const ref = navigationRef.current;
      if (!ref?.isReady()) return;
      const target = NOTIFICATION_ROUTE_MAP[screen] ?? screen;
      try {
        ref.navigate(target as never, (params ?? {}) as never);
      } catch {
        // Route not in current role's nav — fall back to Notifikasi tab.
        try { ref.navigate('Notifikasi' as never); } catch {}
      }
    });
    return cleanup;
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg }}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }
  if (profile?.role === 'supervisor') return <AppNavigation />;
  if (profile?.role === 'principal') return <PrincipalNavigation />;
  // admin, estimator → full office dashboard
  return <OfficeNavigation />;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const shouldBlockForFonts = Platform.OS !== 'web';
  const [fontsLoaded, setFontsLoaded] = useState(!shouldBlockForFonts);

  useEffect(() => {
    let active = true;

    Font.loadAsync({
      SpaceGrotesk_300Light:   require('@expo-google-fonts/space-grotesk/300Light/SpaceGrotesk_300Light.ttf'),
      SpaceGrotesk_400Regular: require('@expo-google-fonts/space-grotesk/400Regular/SpaceGrotesk_400Regular.ttf'),
      SpaceGrotesk_500Medium:  require('@expo-google-fonts/space-grotesk/500Medium/SpaceGrotesk_500Medium.ttf'),
      SpaceGrotesk_600SemiBold: require('@expo-google-fonts/space-grotesk/600SemiBold/SpaceGrotesk_600SemiBold.ttf'),
      SpaceGrotesk_700Bold:    require('@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf'),
    }).then(() => {
      if (active && shouldBlockForFonts) setFontsLoaded(true);
    }).catch(() => {
      if (active && shouldBlockForFonts) setFontsLoaded(true);
    });

    return () => {
      active = false;
    };
  }, [shouldBlockForFonts]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error && /refresh token/i.test(error.message)) {
          await supabase.auth.signOut({ scope: 'local' });
          if (mounted) setSession(null);
          return;
        }

        if (mounted) {
          setSession(session);
        }
      } catch {
        if (mounted) setSession(null);
      } finally {
        if (mounted) setSessionLoading(false);
      }
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Wait for both session check and fonts
  if (sessionLoading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg }}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      {session ? (
        <ProjectProvider userId={session.user.id}>
          <View style={{ flex: 1 }}>
            <RoleRouter />
            <Suspense fallback={null}>
              <GlobalAIChatLauncher />
            </Suspense>
          </View>
        </ProjectProvider>
      ) : (
        <LoginScreen />
      )}
    </>
  );
}
