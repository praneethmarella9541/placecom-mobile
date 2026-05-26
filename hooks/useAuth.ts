import { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Profile } from '../lib/types';

interface AuthCtx {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  hasFeature: (feature: string) => boolean;
}

export const AuthContext = createContext<AuthCtx>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  hasFeature: () => false,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function useAuthState(): AuthCtx {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) fetchProfile(data.session.user.id);
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile(data);
    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  function hasFeature(feature: string): boolean {
    if (!profile) return false;
    if (profile.role === 'admin' || profile.role === 'staff') return true;
    return !profile.restricted_features.includes(feature);
  }

  return { session, user, profile, loading, signOut, hasFeature };
}
