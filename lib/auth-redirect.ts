const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

/** Deep link fallback when no API base URL is configured. */
export const MOBILE_OAUTH_REDIRECT_SCHEME = 'thenucleus://auth/callback';

/**
 * HTTPS callback is more reliable on Android than custom URI schemes
 * (Chrome Custom Tab captures https:// redirects; thenucleus:// often fails).
 */
export function getMobileOAuthRedirect(): string {
  if (API_BASE) return `${API_BASE}/auth/mobile-callback`;
  return MOBILE_OAUTH_REDIRECT_SCHEME;
}
