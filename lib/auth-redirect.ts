import Constants from 'expo-constants';
import * as Linking from 'expo-linking';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://www.rideasy.co.in').replace(
  /\/$/,
  ''
);

export const MOBILE_OAUTH_REDIRECT_SCHEME = 'thenucleus://auth/callback';

export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

export function getMobileOAuthRedirect(): string {
  if (isExpoGo()) {
    return `${API_BASE}/auth/mobile-callback`;
  }
  return MOBILE_OAUTH_REDIRECT_SCHEME;
}

export function getOAuthBridgeUrl(supabaseAuthUrl: string): string {
  const expReturn = getExpoGoReturnUri();
  return `${API_BASE}/auth/mobile-bridge?return=${encodeURIComponent(expReturn)}&auth=${encodeURIComponent(supabaseAuthUrl)}`;
}

export function getExpoGoReturnUri(): string {
  return Linking.createURL('auth/callback');
}

export function isMobileOAuthCallbackUrl(url: string): boolean {
  const bare = url.split('#')[0]!;
  if (/\/auth\/mobile-callback(\?|$)/.test(bare)) return true;
  if (bare.startsWith('exp://') && bare.includes('callback')) return true;
  if (bare.startsWith('thenucleus://') && bare.includes('auth/callback')) return true;
  return false;
}

export function supabaseRedirectIsMobile(redirectParam: string): boolean {
  const p = redirectParam.trim();
  return (
    p.includes('/auth/mobile-callback') ||
    p.startsWith('exp://') ||
    p.includes('thenucleus://auth/callback')
  );
}

/** Match https mobile-callback on www or non-www. */
export function isHttpsMobileCallback(url: string): boolean {
  return /https:\/\/(www\.)?rideasy\.co\.in\/auth\/mobile-callback(\?|$)/.test(url.split('#')[0]!);
}
