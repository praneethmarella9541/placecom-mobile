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
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { signInWithGoogle } from '../../lib/google-sign-in';
import { BrandLogo } from '../../components/BrandLogo';
import { AnalyticsTheme as T } from '../../constants/analyticsTheme';

const FEATURES = [
  { n: '01', label: 'Shared inbox for the whole placement team' },
  { n: '02', label: 'Auto-extract recruiter contacts from every email' },
  { n: '03', label: 'Outbound calls with recordings & AI transcripts' },
  { n: '04', label: 'Calendar sync + meeting summaries that write themselves' },
] as const;

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [showPassword, setShowPassword] = useState(false);

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
      await signInWithGoogle();
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
          { paddingBottom: insets.bottom + 28 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {/* Editorial hero */}
        <View style={[styles.hero, { paddingTop: insets.top + 20 }]}>
          <View style={styles.heroGlowTop} pointerEvents="none" />
          <View style={styles.heroGlowBottom} pointerEvents="none" />

          <BrandLogo size="md" layout="row" nameColor={T.bg} />

          <View style={styles.copperBar} />
          <Text style={styles.heroEyebrow}>Placement operations</Text>
          <Text style={styles.heroTitle}>Your team's workspace for mail, calls, and outreach.</Text>

          <View style={styles.featureList}>
            {FEATURES.map((item) => (
              <View key={item.n} style={styles.featureRow}>
                <Text style={styles.featureNum}>{item.n}</Text>
                <Text style={styles.featureLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Sign-in card */}
        <View style={styles.formSection}>
          <View style={styles.card}>
            <Text style={styles.cardEyebrow}>Workspace access</Text>
            <Text style={styles.cardTitle}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
            <Text style={styles.cardSubtitle}>
              {mode === 'signin'
                ? 'Use credentials from your admin, or continue with Google.'
                : 'Create an account with email and password.'}
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@company.com"
                placeholderTextColor={T.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={T.muted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.passwordToggle}
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={T.muted}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
              onPress={handleEmailAuth}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {mode === 'signin' ? 'Sign in' : 'Create account'}
                </Text>
              )}
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.googleBtn}
              onPress={handleGoogleSignIn}
              disabled={googleLoading}
              activeOpacity={0.85}
            >
              {googleLoading ? (
                <ActivityIndicator color={T.ink} />
              ) : (
                <>
                  <Ionicons name="logo-google" size={18} color="#EA4335" />
                  <Text style={styles.googleBtnText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
              style={styles.switchMode}
            >
              <Text style={styles.switchModeText}>
                {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
                <Text style={styles.switchModeLink}>
                  {mode === 'signin' ? 'Sign up' : 'Sign in'}
                </Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  scrollContent: { flexGrow: 1 },
  hero: {
    position: 'relative',
    backgroundColor: T.heroBg,
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  heroGlowTop: {
    position: 'absolute',
    right: -40,
    top: -30,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(228, 160, 76, 0.22)',
  },
  heroGlowBottom: {
    position: 'absolute',
    left: -60,
    bottom: -50,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(196, 92, 26, 0.12)',
  },
  copperBar: {
    width: 44,
    height: 3,
    borderRadius: 2,
    marginTop: 24,
    backgroundColor: T.copper,
  },
  heroEyebrow: {
    marginTop: 18,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: T.heroAccent,
  },
  heroTitle: {
    marginTop: 12,
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 34,
    letterSpacing: -0.3,
    color: T.bg,
  },
  featureList: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(245, 243, 239, 0.12)',
    gap: 14,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  featureNum: {
    width: 24,
    marginTop: 3,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    color: T.heroAccent,
    fontVariant: ['tabular-nums'],
  },
  featureLabel: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(245, 243, 239, 0.82)',
  },
  formSection: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  card: {
    backgroundColor: T.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: T.border,
    padding: 22,
    gap: 14,
    shadowColor: '#1a1612',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  cardEyebrow: {
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: T.muted,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: T.ink,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: T.inkSoft,
    textAlign: 'center',
    marginBottom: 4,
  },
  inputGroup: { gap: 6 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: T.muted,
  },
  input: {
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: T.ink,
    backgroundColor: T.bg,
  },
  passwordWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 10,
    paddingLeft: 14,
    paddingRight: 44,
    paddingVertical: 12,
    fontSize: 15,
    color: T.ink,
    backgroundColor: T.bg,
  },
  passwordToggle: {
    position: 'absolute',
    right: 10,
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    backgroundColor: T.copper,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 4,
  },
  primaryBtnDisabled: { opacity: 0.65 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: T.border },
  dividerText: { fontSize: 13, color: T.muted },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 10,
    paddingVertical: 13,
    minHeight: 48,
    backgroundColor: T.surface,
  },
  googleBtnText: { fontSize: 15, fontWeight: '600', color: T.ink },
  switchMode: { alignItems: 'center', marginTop: 4 },
  switchModeText: { fontSize: 13, color: T.inkSoft },
  switchModeLink: { color: T.copper, fontWeight: '700' },
});
