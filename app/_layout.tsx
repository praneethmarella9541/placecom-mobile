import { useEffect } from 'react';
import { Text, TextInput } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Sora_600SemiBold, Sora_700Bold, Sora_800ExtraBold } from '@expo-google-fonts/sora';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { FONTS } from '../constants/fonts';
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

let defaultFontApplied = false;
function applyDefaultFont() {
  if (defaultFontApplied) return;
  defaultFontApplied = true;

  const anyText = Text as any;
  anyText.defaultProps = anyText.defaultProps || {};
  anyText.defaultProps.style = [{ fontFamily: FONTS.body }, anyText.defaultProps.style];

  const anyTextInput = TextInput as any;
  anyTextInput.defaultProps = anyTextInput.defaultProps || {};
  anyTextInput.defaultProps.style = [{ fontFamily: FONTS.body }, anyTextInput.defaultProps.style];
}

export default function RootLayout() {
  const auth = useAuthState();
  const [fontsLoaded] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Sora_800ExtraBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (fontsLoaded) applyDefaultFont();
  if (!fontsLoaded) return <LoadingScreen />;

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
