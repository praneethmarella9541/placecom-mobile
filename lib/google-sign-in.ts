import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';
import { getMobileOAuthRedirect, isMobileOAuthCallbackUrl, isWebSiteOAuthRedirect, MOBILE_OAUTH_REDIRECT_SCHEME, isExpoGo } from './auth-redirect';

const GOOGLE_SCOPES =
  'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/forms';

let exchangeInFlight: Promise<void> | null = null;

/** Parse ?query and #hash params from any callback URL (custom schemes included). */
export function parseOAuthCallback(url: string): {
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorDescription: string | null;
} {
  const queryPart = url.includes('?') ? (url.split('?')[1]?.split('#')[0] ?? '') : '';
  const hashPart = url.includes('#') ? (url.split('#')[1] ?? '') : '';
  const query = new URLSearchParams(queryPart);
  const hash = new URLSearchParams(hashPart);
  return {
    code: query.get('code'),
    accessToken: hash.get('access_token'),
    refreshToken: hash.get('refresh_token'),
    error: query.get('error') ?? hash.get('error'),
    errorDescription: query.get('error_description') ?? hash.get('error_description'),
  };
}

function redirectPrefix(redirectTo: string): string {
  return redirectTo.split('?')[0]!;
}

function matchesRedirect(url: string, redirectTo: string): boolean {
  const prefix = redirectPrefix(redirectTo);
  return url === prefix || url.startsWith(`${prefix}?`) || url.startsWith(`${prefix}#`);
}

/** Wait for the OS to open the app via deep link (custom-scheme fallback). */
function createDeepLinkWaiter(redirectTo: string, timeoutMs = 45_000) {
  let settled = false;
  let sub: { remove: () => void } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    sub?.remove();
    if (timer) clearTimeout(timer);
  };

  const promise = new Promise<string>((resolve, reject) => {
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    sub = Linking.addEventListener('url', ({ url }) => {
      if (isMobileOAuthCallbackUrl(url) || matchesRedirect(url, redirectTo)) {
        finish(() => resolve(url));
      }
    });

    timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            'Sign-in timed out. Close the browser tab completely, reopen the app, and try again.'
          )
        )
      );
    }, timeoutMs);

    void Linking.getInitialURL().then((initial) => {
      if (initial && (isMobileOAuthCallbackUrl(initial) || matchesRedirect(initial, redirectTo))) {
        finish(() => resolve(initial));
      }
    });
  });

  return {
    promise,
    cancel: () => {
      if (!settled) {
        settled = true;
        cleanup();
      }
    },
  };
}

async function exchangeCallbackUrl(callbackUrl: string): Promise<void> {
  const { code, accessToken, refreshToken, error, errorDescription } = parseOAuthCallback(callbackUrl);
  if (error) {
    throw new Error(errorDescription?.trim() || error);
  }
  if (code) {
    const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeErr) throw exchangeErr;
    return;
  }
  if (accessToken && refreshToken) {
    const { error: sessionErr } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionErr) throw sessionErr;
    return;
  }
  throw new Error('No authorization code returned from Google.');
}

/** Exchange a callback URL into a Supabase session (deduped across handlers). */
export async function completeOAuthFromUrl(callbackUrl: string): Promise<void> {
  if (!isMobileOAuthCallbackUrl(callbackUrl)) return;
  if (!exchangeInFlight) {
    exchangeInFlight = exchangeCallbackUrl(callbackUrl).finally(() => {
      exchangeInFlight = null;
    });
  }
  return exchangeInFlight;
}

/**
 * Google sign-in via in-app browser sheet.
 * HTTPS /auth/mobile-callback closes the sheet and returns ?code= to this app.
 */
export async function signInWithGoogle(): Promise<void> {
  const redirectTo = getMobileOAuthRedirect();
  const usesDeepLink =
    !redirectTo.startsWith('http') &&
    (redirectTo.startsWith('thenucleus://') || redirectTo.startsWith('exp://'));
  const deepLinkTarget = redirectTo.startsWith('http') ? MOBILE_OAUTH_REDIRECT_SCHEME : redirectTo;
  const deepLinkWaiter = usesDeepLink
    ? createDeepLinkWaiter(deepLinkTarget, isExpoGo() ? 90_000 : Platform.OS === 'ios' ? 60_000 : 45_000)
    : null;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
        scope: GOOGLE_SCOPES,
      },
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase did not return an OAuth URL.');

  const authUrl = new URL(data.url);
  const redirectParam = decodeURIComponent(authUrl.searchParams.get('redirect_to') ?? '');

  if (isWebSiteOAuthRedirect(redirectParam)) {
    throw new Error(
      `Supabase is redirecting to the website instead of the app.\n\n` +
        `Add this exact URL to Supabase → Authentication → Redirect URLs:\n${redirectTo}`
    );
  }

  if (
    isExpoGo() &&
    redirectTo.startsWith('http') &&
    !redirectParam.includes('/auth/mobile-callback')
  ) {
    throw new Error(
      `OAuth redirect mismatch.\n\n` +
        `Expected:\n${redirectTo}\n\n` +
        `Got:\n${redirectParam || '(empty — check Supabase Site URL)'}`
    );
  }

  if (
    !isExpoGo() &&
    Platform.OS === 'ios' &&
    !redirectParam.includes('thenucleus://') &&
    !redirectParam.includes('auth/callback')
  ) {
    throw new Error(
      'OAuth is misconfigured: Supabase must redirect to thenucleus://auth/callback on iOS.'
    );
  }

  if (Platform.OS === 'android') {
    try {
      await WebBrowser.warmUpAsync();
    } catch {
      /* optional */
    }
  }

  try {
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, {
      preferEphemeralSession: true,
      createTask: false,
    });

    if (result.type === 'cancel') return;

    let callbackUrl: string | null = null;

    if (result.type === 'success' && result.url) {
      deepLinkWaiter?.cancel();
      callbackUrl = result.url;
    } else if (result.type === 'dismiss') {
      if (deepLinkWaiter) {
        try {
          callbackUrl = await deepLinkWaiter.promise;
        } catch (e) {
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData.session) return;
          throw e;
        }
      } else {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session) return;
        throw new Error(
          'Google sign-in did not finish in the app. Close the browser tab and try again.'
        );
      }
    } else {
      deepLinkWaiter?.cancel();
      throw new Error('Google sign-in did not return to the app.');
    }

    if (!callbackUrl || !isMobileOAuthCallbackUrl(callbackUrl)) {
      throw new Error('Unexpected OAuth callback URL. Please try again.');
    }

    await completeOAuthFromUrl(callbackUrl);

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      throw new Error('Sign-in completed but no session was created. Please try again.');
    }
  } finally {
    deepLinkWaiter?.cancel();
    if (Platform.OS === 'android') {
      try {
        await WebBrowser.coolDownAsync();
      } catch {
        /* optional */
      }
    }
  }
}
