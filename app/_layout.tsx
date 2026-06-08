import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthContext, useAuth, useAuthState } from '../hooks/useAuth';
import { usePushNotifications } from '../hooks/usePushNotifications';
import LoadingScreen from '../components/LoadingScreen';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  usePushNotifications(session);

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === '(auth)';
    if (!session && !inAuth) router.replace('/(auth)/login');
    if (session && inAuth) router.replace('/(workspace)/inbox');
  }, [session, loading, segments]);

  if (loading) return <LoadingScreen />;
  return <>{children}</>;
}

export default function RootLayout() {
  const auth = useAuthState();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <AuthContext.Provider value={auth}>
            <AuthGuard>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(workspace)" />
              </Stack>
            </AuthGuard>
          </AuthContext.Provider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
