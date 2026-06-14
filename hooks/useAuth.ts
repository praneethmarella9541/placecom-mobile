import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { meApi } from '../lib/api';
import { Profile, UserRole } from '../lib/types';
import { resetAppSessionCaches } from '../lib/session-reset';

function normalizeRole(role: unknown): UserRole {
  if (role === 'admin' || role === 'staff' || role === 'committee') return role;
  return 'staff';
}

function mapSupabaseProfile(row: Record<string, unknown>, user: User): Profile {
  return {
    id: user.id,
    email: user.email ?? '',
    display_name:
      (row.display_username as string | null) ??
      (row.display_name as string | null) ??
      null,
    role: normalizeRole(row.role),
    restricted_features: (row.restricted_features as string[] | undefined) ?? [],
    mobile_phone: (row.mobile_phone as string | null) ?? null,
    exotel_virtual_number: (row.exotel_virtual_number as string | null) ?? null,
  };
}

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
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user ?? null;
      lastUserIdRef.current = nextUser?.id ?? null;
      setSession(data.session);
      setUser(nextUser);
      if (nextUser) fetchProfile(nextUser);
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      const prevUserId = lastUserIdRef.current;

      if (!nextUserId || (prevUserId && prevUserId !== nextUserId)) {
        void resetAppSessionCaches(prevUserId ?? undefined);
      }

      lastUserIdRef.current = nextUserId;
      setSession(session);
      setUser(nextUser);
      if (nextUser) fetchProfile(nextUser);
      else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function fetchProfile(user: User) {
    try {
      const { data: row } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      const fromDb = row ? mapSupabaseProfile(row as Record<string, unknown>, user) : null;

      try {
        const me = await meApi.mailbox();
        setProfile({
          ...(fromDb ?? {
            id: user.id,
            email: user.email ?? '',
            display_name: null,
            role: normalizeRole(me.role),
            restricted_features: me.restrictedFeatures ?? [],
            mobile_phone: null,
            exotel_virtual_number: me.exotelVirtualNumber ?? null,
          }),
          email: me.sessionEmail ?? fromDb?.email ?? user.email ?? '',
          display_name: me.displayUsername ?? fromDb?.display_name ?? null,
          role: fromDb?.role ?? normalizeRole(me.role),
          restricted_features: fromDb?.restricted_features ?? me.restrictedFeatures ?? [],
          exotel_virtual_number: me.exotelVirtualNumber ?? fromDb?.exotel_virtual_number ?? null,
        });
      } catch {
        setProfile(fromDb);
      }
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    const userId = user?.id;
    await resetAppSessionCaches(userId);
    await supabase.auth.signOut();
  }

  function hasFeature(feature: string): boolean {
    if (!profile) return false;
    if (profile.role === 'admin' || profile.role === 'staff') return true;
    return !profile.restricted_features.includes(feature);
  }

  return { session, user, profile, loading, signOut, hasFeature };
}
