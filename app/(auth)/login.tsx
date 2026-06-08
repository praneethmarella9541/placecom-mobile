import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { getMobileOAuthRedirect } from '../../lib/auth-redirect';
import { Colors } from '../../constants/colors';
import { BrandLogo } from '../../components/BrandLogo';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  // Captures the OAuth redirect URI on first Google-sign-in attempt so it can
  // be displayed and copy-pasted into the Supabase Redirect URLs allowlist.
  // Once sign-in works end-to-end this debug strip can be removed.
  const [oauthRedirect, setOauthRedirect] = useState<string | null>(null);

  async function handleEmailAuth() {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password.');
      return;
    }
    setLoading(true);
    try {
      const { error } =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (error) Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    try {
      // HTTPS /auth/mobile-callback — add to Supabase Redirect URLs (with www if used).
      // Custom thenucleus:// schemes are flaky in Android in-app browser; /auth/callback
      // on the website logs users into the web app instead.
      const redirectTo = getMobileOAuthRedirect();
      console.log('[OAuth] redirectTo =', redirectTo);
      setOauthRedirect(redirectTo);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
            scope:
              'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/forms',
          },
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error('Supabase did not return an OAuth URL.');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) {
        return; // user cancelled or the browser didn't return a URL
      }

      if (!result.url.includes('/auth/mobile-callback') && /\/auth\/callback|\/inbox/i.test(result.url)) {
        throw new Error(
          'Google sign-in opened the website inbox instead of the app. In Supabase → Redirect URLs add:\n\n' +
            `${redirectTo}\n\n` +
            'Deploy placecom (needs /auth/mobile-callback), rebuild the APK, then try again.'
        );
      }

      // PKCE: returned URL has ?code=…
      const url = new URL(result.url);
      const code = url.searchParams.get('code');
      if (!code) {
        // Some configurations (implicit/legacy) still put tokens in the hash.
        // Fall back to hash parsing so old sessions don't get stuck.
        const hash = result.url.split('#')[1] ?? '';
        const hashParams = new URLSearchParams(hash);
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          return;
        }
        throw new Error('No code or tokens returned from Supabase.');
      }

      const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeErr) throw exchangeErr;
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoSection}>
          <BrandLogo size="lg" layout="column" nameColor={Colors.surface} />
          <Text style={styles.tagline}>Placement & Communication CRM</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{mode === 'signin' ? 'Sign In' : 'Create Account'}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
            />
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleEmailAuth} disabled={loading}>
            {loading ? (
              <ActivityIndicator color={Colors.surface} />
            ) : (
              <Text style={styles.primaryBtnText}>{mode === 'signin' ? 'Sign In' : 'Create Account'}</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.googleBtn} onPress={handleGoogleSignIn} disabled={googleLoading}>
            {googleLoading ? (
              <ActivityIndicator color={Colors.text} />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color="#EA4335" />
                <Text style={styles.googleBtnText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Debug strip — shows the redirect URI Supabase needs allowlisted.
              Remove (or hide behind a long-press) once sign-in is working. */}
          {oauthRedirect && (
            <View style={styles.debugStrip}>
              <Text style={styles.debugLabel}>OAuth redirect URI (add to Supabase):</Text>
              <Text style={styles.debugValue} selectable>{oauthRedirect}</Text>
            </View>
          )}

          <TouchableOpacity onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')} style={styles.switchMode}>
            <Text style={styles.switchModeText}>
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <Text style={styles.switchModeLink}>{mode === 'signin' ? 'Sign Up' : 'Sign In'}</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 28,
  },
  logoSection: { alignItems: 'center', gap: 10 },
  tagline: { fontSize: 14, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  inputGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  primaryBtnText: { color: Colors.surface, fontSize: 15, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: 13, color: Colors.textMuted },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 13,
    minHeight: 46,
  },
  googleBtnText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  debugStrip: {
    marginTop: 8,
    padding: 10,
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FCD34D',
    gap: 4,
  },
  debugLabel: { fontSize: 10, fontWeight: '700', color: '#92400E' },
  debugValue: { fontSize: 11, color: '#78350F', fontFamily: 'monospace' },
  switchMode: { alignItems: 'center' },
  switchModeText: { fontSize: 13, color: Colors.textSecondary },
  switchModeLink: { color: Colors.primary, fontWeight: '700' },
});
