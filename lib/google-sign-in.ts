import { AppState, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';
import {
  getExpoGoReturnUri,
  getMobileOAuthRedirect,
  getOAuthBridgeUrl,
  isExpoGo,
  isHttpsMobileCallback,
  isMobileOAuthCallbackUrl,
  supabaseRedirectIsMobile,
} from './auth-redirect';

export { getMobileOAuthRedirect, isMobileOAuthCallbackUrl, isExpoGo };

const GOOGLE_SCOPES =
  'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/forms';

const OAUTH_WAIT_MS = 60_000;

let exchangeInFlight: Promise<void> | null = null;

export function parseOAuthCallback(url: string): {
  code: string | null;
  error: string | null;
  errorDescription: string | null;
} {
  const queryPart = url.includes('?') ? (url.split('?')[1]?.split('#')[0] ?? '') : '';
  const query = new URLSearchParams(queryPart);
  return {
    code: query.get('code'),
    error: query.get('error'),
    errorDescription: query.get('error_description'),
  };
}

export function finishOAuthBrowser(): void {
  WebBrowser.maybeCompleteAuthSession();
}

async function exchangeCallbackUrl(callbackUrl: string): Promise<void> {
  const { code, error, errorDescription } = parseOAuthCallback(callbackUrl);
  if (error) throw new Error(errorDescription?.trim() || error);
  if (!code) throw new Error('No authorization code returned from Google.');
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr) throw exchangeErr;
}

export async function completeOAuthFromUrl(callbackUrl: string): Promise<void> {
  if (!isMobileOAuthCallbackUrl(callbackUrl) && !isHttpsMobileCallback(callbackUrl)) return;
  if (!exchangeInFlight) {
    exchangeInFlight = exchangeCallbackUrl(callbackUrl).finally(() => {
      exchangeInFlight = null;
    });
  }
  await exchangeInFlight;
  finishOAuthBrowser();
}

function urlIsOAuthCallback(url: string): boolean {
  if (isMobileOAuthCallbackUrl(url)) return true;
  if (isHttpsMobileCallback(url)) return true;
  const expPrefix = getExpoGoReturnUri().split('?')[0]!;
  return url.startsWith(expPrefix);
}

function httpsCapturePrefix(redirectParam: string, redirectTo: string): string {
  return (redirectParam || redirectTo).split('?')[0]!;
}

function waitForOAuthCallback(): { promise: Promise<string | null>; cancel: () => void } {
  let settled = false;
  let linkSub: { remove: () => void } | null = null;
  let appSub: { remove: () => void } | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    linkSub?.remove();
    appSub?.remove();
    if (pollTimer) clearInterval(pollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  };

  const promise = new Promise<string | null>((resolve) => {
    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(url);
    };

    const tryUrl = (url: string | null) => {
      if (url && urlIsOAuthCallback(url)) finish(url);
    };

    const trySession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        finishOAuthBrowser();
        finish(null);
      }
    };

    linkSub = Linking.addEventListener('url', ({ url }) => tryUrl(url));
    appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void Linking.getInitialURL().then(tryUrl);
        void trySession();
      }
    });
    pollTimer = setInterval(() => void trySession(), 300);
    timeoutTimer = setTimeout(() => finish(null), OAUTH_WAIT_MS);

    void Linking.getInitialURL().then(tryUrl);
    void trySession();
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

/**
 * Expo Go: bridge → Google → mobile-callback?code= → browser closes → app inbox.
 * HTTPS URL is captured first; exp:// is only a delayed fallback on the server page.
 */
export async function signInWithGoogle(): Promise<void> {
  const redirectTo = getMobileOAuthRedirect();
  const oauthWaiter = waitForOAuthCallback();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
        scope: GOOGLE_SCOPES,
      },
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase did not return an OAuth URL.');

  const redirectParam = decodeURIComponent(
    new URL(data.url).searchParams.get('redirect_to') ?? ''
  );

  if (isExpoGo() && !supabaseRedirectIsMobile(redirectParam)) {
    oauthWaiter.cancel();
    throw new Error(
      `Supabase is redirecting to the website instead of the app.\n\n` +
        `Expected:\n${redirectTo}\n\n` +
        `Got:\n${redirectParam || '(empty)'}\n\n` +
        `Add ${redirectTo} to Supabase → Authentication → Redirect URLs.`
    );
  }

  const browserStartUrl = isExpoGo() ? getOAuthBridgeUrl(data.url) : data.url;
  const httpsCapture = httpsCapturePrefix(redirectParam, redirectTo);
  const authSessionReturn = isExpoGo() ? httpsCapture : redirectTo.split('?')[0]!;

  if (Platform.OS === 'android') {
    try {
      await WebBrowser.warmUpAsync();
    } catch {
      /* optional */
    }
  }

  try {
    const result = await WebBrowser.openAuthSessionAsync(browserStartUrl, authSessionReturn, {
      preferEphemeralSession: false,
      createTask: false,
    });

    if (result.type === 'cancel') return;

    let callbackUrl: string | null = null;

    if (result.type === 'success' && result.url && urlIsOAuthCallback(result.url)) {
      callbackUrl = result.url;
    } else {
      callbackUrl = await oauthWaiter.promise;
    }

    oauthWaiter.cancel();

    if (callbackUrl) {
      await completeOAuthFromUrl(callbackUrl);
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      throw new Error('Google sign-in did not finish. Please try again.');
    }

    finishOAuthBrowser();
  } finally {
    oauthWaiter.cancel();
    finishOAuthBrowser();
    if (Platform.OS === 'android') {
      try {
        await WebBrowser.coolDownAsync();
      } catch {
        /* optional */
      }
    }
  }
}
