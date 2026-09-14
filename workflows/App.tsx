import React, { Suspense, useEffect, useRef, useState } from 'react';
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
// Role-aware deeplink→route resolution (fixes the supervisor Approvals
// dead-end — see tools/notificationRouting.ts for the role×route matrix).
import { resolveNotificationRoute } from '../tools/notificationRouting';
import { queueDeeplink, routeDeeplink, takeDeeplink } from './pendingDeeplink';
import { startCaptureQueueWorker, stopCaptureQueueWorker } from '../tools/captureQueueWorker';

// Module-scoped so all three role-based NavigationContainers share the same ref.
// The push-notification tap listener navigates through this ref from outside the React tree.
export const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

const AppNavigation = lazyScreen(() => import('./navigation'));
const LoginScreen = lazyScreen(() => import('./screens/LoginScreen'));
const OfficeNavigation = lazyScreen(() => import('../office/navigation'));
const PrincipalNavigation = lazyScreen(() => import('../office/PrincipalNavigation'));
const GlobalAIChatLauncher = React.lazy(() => import('./components/GlobalAIChatLauncher'));

// Navigates through the shared ref, or queues the deeplink when no navigator
// is mounted yet: a cold start from a tap, or a project switch still loading.
function navigateShared(screen: string, params: Record<string, unknown>): void {
  const ref = navigationRef.current;
  if (!ref?.isReady()) {
    queueDeeplink(screen, params);
    return;
  }
  try {
    (ref.navigate as unknown as (screen: string, params?: object) => void)(screen, params);
  } catch {
    // Route not in current role's nav — fall back to Notifikasi tab.
    try { ref.navigate('Notifikasi' as never); } catch {}
  }
}

interface ProjectRefs {
  id: { current: string | undefined };
  ids: { current: string[] };
  select: { current: (projectId: string) => void };
}

// Opens a resolved deeplink against the latest project, read from refs at
// call time, so a listener attached once never routes with a stale project.
function openDeeplink(screen: string, params: Record<string, unknown> | null | undefined, project: ProjectRefs): void {
  routeDeeplink(screen, params, {
    currentProjectId: project.id.current,
    visibleProjectIds: project.ids.current,
    setActiveProject: (projectId) => project.select.current(projectId),
    navigate: navigateShared,
  });
}

// Routes to supervisor app or office dashboard based on profile role.
// Must be rendered inside ProjectProvider so useProject() works.
function RoleRouter() {
  const { profile, loading, project, projects, dataProjectId, setActiveProject } = useProject();

  // The tap listener attaches once (empty deps) but must resolve routes with
  // the CURRENT role and project, which load after the listener is wired. Refs
  // keep the listener closure reading the latest values without re-attaching.
  const roleRef = useRef<string | undefined>(profile?.role);
  const projectIdRef = useRef<string | undefined>(project?.id);
  const projectIdsRef = useRef<string[]>([]);
  const setActiveProjectRef = useRef(setActiveProject);
  useEffect(() => {
    roleRef.current = profile?.role;
  }, [profile?.role]);
  useEffect(() => {
    projectIdRef.current = project?.id;
    projectIdsRef.current = projects.map((p) => p.id);
    setActiveProjectRef.current = setActiveProject;
  }, [project?.id, projects, setActiveProject]);

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
      const target = resolveNotificationRoute(screen, roleRef.current);
      openDeeplink(target, params, { id: projectIdRef, ids: projectIdsRef, select: setActiveProjectRef });
    });
    return cleanup;
  }, []);

  // Block on the spinner until the first load finishes, and while a project
  // switch loads. The switch deliberately unmounts the navigator, so every
  // screen drops its in-memory state (a half-built material request, cached
  // envelopes) instead of carrying it into the new project. A refresh of the
  // same project keeps the navigator mounted, so the user stays on their tab.
  const firstLoadDone = useRef(false);
  if (!loading) firstLoadDone.current = true;
  const switchingProject = !!project && dataProjectId !== project.id;
  const blocked = (loading && !firstLoadDone.current) || switchingProject;

  // Replay a deeplink queued during a project switch or a cold start once the
  // lazily loaded navigator is ready.
  useEffect(() => {
    if (blocked) return undefined;
    let cancelled = false;
    let tries = 0;
    const replay = () => {
      if (cancelled) return;
      if (navigationRef.current?.isReady()) {
        const next = takeDeeplink();
        // Routed again rather than navigated: a deeplink queued on a cold start
        // can name another project, which then switches and queues it once more.
        if (next) openDeeplink(next.screen, next.params, { id: projectIdRef, ids: projectIdsRef, select: setActiveProjectRef });
        return;
      }
      if (tries++ < 100) setTimeout(replay, 50);
    };
    replay();
    return () => {
      cancelled = true;
    };
  }, [blocked]);

  if (blocked) {
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

  // Drain the offline capture queue for whichever user is signed in, and
  // stop touching it the moment they sign out (tools/captureQueueWorker.ts).
  useEffect(() => {
    if (session?.user.id) {
      startCaptureQueueWorker(session.user.id);
    } else {
      stopCaptureQueueWorker();
    }
  }, [session?.user.id]);

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
