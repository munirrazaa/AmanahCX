import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import * as SecureStore from 'expo-secure-store';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';

SplashScreen.preventAutoHideAsync();

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

  // Restore session from secure storage on app start
  useEffect(() => {
    async function restore() {
      try {
        const token = await SecureStore.getItemAsync('crm_access_token');
        if (token) {
          const me = await api.get<{ user: any; tenant: any }>('/api/v1/auth/me');
          setSession({ token, user: me.user, tenant: me.tenant });
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
    const inAuthGroup = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)/dashboard');
    }
  }, [isAuthenticated, segments]);

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
