import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

/** Deep-link callback for standalone / dev-client builds. */
export const MOBILE_OAUTH_REDIRECT_SCHEME = 'thenucleus://auth/callback';

export function mobileHttpsCallback(): string | null {
  if (!API_BASE) return null;
  return `${API_BASE}/auth/mobile-callback`;
}

/** True when running inside Expo Go (custom URL schemes are unavailable). */
export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

function nativeRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: 'thenucleus',
    path: 'auth/callback',
  });
}

/**
 * OAuth redirect passed to Supabase + openAuthSessionAsync.
 *
 * Expo Go: HTTPS /auth/mobile-callback (stable; exp:// is unreliable).
 * iOS dev/prod: thenucleus://auth/callback.
 * Android dev/prod: HTTPS /auth/mobile-callback when API_BASE is set.
 */
export function getMobileOAuthRedirect(): string {
  const httpsCallback = mobileHttpsCallback();

  // Expo Go cannot open thenucleus:// — use HTTPS so the auth sheet returns ?code=.
  if (isExpoGo() && httpsCallback) {
    return httpsCallback;
  }

  if (Platform.OS === 'ios') {
    return MOBILE_OAUTH_REDIRECT_SCHEME;
  }
  if (httpsCallback) return httpsCallback;
  return MOBILE_OAUTH_REDIRECT_SCHEME;
}

export function isMobileOAuthCallbackUrl(url: string): boolean {
  const bare = url.split('#')[0]!;
  if (/\/auth\/mobile-callback(\?|$)/.test(bare)) {
    return true;
  }
  if (/auth\/callback(\?|$)/.test(bare) || /--\/auth\/callback(\?|$)/.test(bare)) {
    return true;
  }
  if (bare.startsWith('exp://') && bare.includes('callback')) {
    return true;
  }
  return false;
}

/** True when Supabase OAuth URL is pointing at the web app instead of mobile. */
export function isWebSiteOAuthRedirect(redirectParam: string): boolean {
  return /rideasy\.co\.in/i.test(redirectParam) && !redirectParam.includes('/auth/mobile-callback');
}
