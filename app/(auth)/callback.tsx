import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';

/**
 * Deep-link landing for `thenucleus://auth/callback?code=…`.
 *
 * Most of the time the sign-in flow finishes inside
 * `WebBrowser.openAuthSessionAsync` and never opens this screen — the
 * promise resolves with the redirect URL and the login handler exchanges
 * the code itself. This route is the fallback when the auth browser is
 * dismissed early (some Android variants) or the app is cold-started
 * by the OS opening the deep link.
 */
export default function AuthCallback() {
  const params = useLocalSearchParams<{ code?: string; error?: string; error_description?: string }>();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      if (params.error) {
        console.warn('[auth/callback] OAuth error:', params.error, params.error_description);
        router.replace('/(auth)/login');
        return;
      }
      const code = typeof params.code === 'string' ? params.code : undefined;
      if (!code) {
        // Nothing to do — either already authed (AuthGuard will route us)
        // or genuinely missing the code. Bounce back to login as a safe default.
        router.replace('/(auth)/login');
        return;
      }
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.warn('[auth/callback] exchangeCodeForSession failed:', error.message);
        router.replace('/(auth)/login');
        return;
      }
      // AuthGuard in the root layout will detect the new session and route
      // us into the workspace — no explicit push needed here.
    })();
  }, [params.code, params.error, params.error_description, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={Colors.primary} />
      <Text style={styles.text}>Signing you in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  text: { fontSize: 14, color: Colors.textSecondary },
});
