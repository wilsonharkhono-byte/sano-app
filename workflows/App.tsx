import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import * as Font from 'expo-font';
import { supabase } from '../tools/supabase';
import { Session } from '@supabase/supabase-js';
import AppNavigation from './navigation';
import GlobalAIChatLauncher from './components/GlobalAIChatLauncher';
import LoginScreen from './screens/LoginScreen';
import { ProjectProvider, useProject } from './hooks/useProject';
import OfficeNavigation from '../office/navigation';
import PrincipalNavigation from '../office/PrincipalNavigation';
import { COLORS } from './theme';

// Routes to supervisor app or office dashboard based on profile role.
// Must be rendered inside ProjectProvider so useProject() works.
function RoleRouter() {
  const { profile, loading } = useProject();
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

  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    Font.loadAsync({
      SpaceGrotesk_300Light:   require('@expo-google-fonts/space-grotesk/300Light/SpaceGrotesk_300Light.ttf'),
      SpaceGrotesk_400Regular: require('@expo-google-fonts/space-grotesk/400Regular/SpaceGrotesk_400Regular.ttf'),
      SpaceGrotesk_500Medium:  require('@expo-google-fonts/space-grotesk/500Medium/SpaceGrotesk_500Medium.ttf'),
      SpaceGrotesk_600SemiBold: require('@expo-google-fonts/space-grotesk/600SemiBold/SpaceGrotesk_600SemiBold.ttf'),
      SpaceGrotesk_700Bold:    require('@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf'),
    }).then(() => setFontsLoaded(true))
      .catch(() => setFontsLoaded(true)); // fallback to system fonts if loading fails
  }, []);

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
            <GlobalAIChatLauncher />
          </View>
        </ProjectProvider>
      ) : (
        <LoginScreen />
      )}
    </>
  );
}
