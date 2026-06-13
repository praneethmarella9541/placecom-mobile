import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthContext, useAuth, useAuthState } from '../hooks/useAuth';
import { useIncomingCallAlerts } from '../hooks/useIncomingCallAlerts';
import { usePushNotifications } from '../hooks/usePushNotifications';
import AppToastHost from '../components/AppToastHost';
import LoadingScreen from '../components/LoadingScreen';
import { OAuthLinkingHandler } from '../components/OAuthLinkingHandler';

// iOS: dismiss Safari auth sheet when the app opens via thenucleus:// callback.
// Must run at the root — not only on the login screen.
WebBrowser.maybeCompleteAuthSession();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  usePushNotifications(session);
  useIncomingCallAlerts(session);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    // thenucleus://auth/callback → app/auth/callback (outside the (auth) group)
    const onOAuthCallback = segments[0] === 'auth' && segments[1] === 'callback';
    const inAuthFlow = inAuthGroup || onOAuthCallback;

    if (!session && !inAuthFlow) router.replace('/(auth)/login');
    if (session && inAuthFlow) router.replace('/(workspace)/inbox');
  }, [session, loading, segments]);

  if (loading) return <LoadingScreen />;
  return <>{children}</>;
}

export default function RootLayout() {
  const auth = useAuthState();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <AuthContext.Provider value={auth}>
          <AuthGuard>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="auth" />
              <Stack.Screen name="(workspace)" />
            </Stack>
            <AppToastHost />
            <OAuthLinkingHandler />
          </AuthGuard>
        </AuthContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
