import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import * as storage from '@/lib/storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/store/auth';
import { getCachedSession } from '@/lib/api';
import { activateKeepAwakeAsync } from 'expo-keep-awake';
import { startAutoSync } from '@/lib/offlineQueue';

SplashScreen.preventAutoHideAsync();
startAutoSync();
// Keep the phone screen awake while testing — dev builds only, so
// production field use doesn't drain the battery. (Native only: the web
// WakeLock API throws when the preview tab isn't visible.)
if (__DEV__ && Platform.OS !== 'web') activateKeepAwakeAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

// Redirect unauthenticated users to login, authenticated users away from auth screens
function AuthGuard() {
  const { isAuthenticated, setSession } = useAuthStore();
  const segments = useSegments();
  const router   = useRouter();
  const navState = useRootNavigationState();

  // Restore session from secure storage on app start
  useEffect(() => {
    async function restore() {
      try {
        const token = await storage.getItem('crm_access_token');
        if (token) {
          const cached = await getCachedSession();
          if (cached) setSession({ token, user: cached.user, tenant: cached.tenant });
        }
      } catch {
        // Token expired or invalid — stay on login
      } finally {
        SplashScreen.hideAsync();
      }
    }
    restore();
  }, []);

  useEffect(() => {
    // Navigating before the root navigator has mounted crashes expo-router;
    // wait until it reports a key.
    if (!navState?.key) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Field staff land on their assigned work first
      router.replace('/(tabs)/tasks');
    }
  }, [isAuthenticated, segments, navState?.key]);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <AuthGuard />
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
