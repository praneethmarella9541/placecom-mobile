import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { AppState } from 'react-native';
import { isMobileOAuthCallbackUrl } from '../lib/auth-redirect';
import { completeOAuthFromUrl } from '../lib/google-sign-in';
import { supabase } from '../lib/supabase';

/**
 * Catches OAuth callbacks delivered via deep link when the browser hands off
 * to the app outside openAuthSessionAsync (common on Android).
 */
export function OAuthLinkingHandler() {
  useEffect(() => {
    let busy = false;

    async function handle(url: string | null) {
      if (!url || !isMobileOAuthCallbackUrl(url) || busy) return;
      busy = true;
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) return;
        await completeOAuthFromUrl(url);
      } catch (e) {
        console.warn('[OAuthLinkingHandler]', e);
      } finally {
        busy = false;
      }
    }

    const sub = Linking.addEventListener('url', ({ url }) => {
      void handle(url);
    });

    void Linking.getInitialURL().then(handle);

    const appSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void Linking.getInitialURL().then(handle);
    });

    return () => {
      sub.remove();
      appSub.remove();
    };
  }, []);

  return null;
}
