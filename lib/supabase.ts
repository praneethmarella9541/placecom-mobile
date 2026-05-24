import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // PKCE: Supabase returns ?code=… in the deep-link redirect (no fragment),
    // we exchange it via supabase.auth.exchangeCodeForSession() in our
    // callback handler. Cleaner + more secure than implicit on mobile.
    flowType: 'pkce',
    detectSessionInUrl: false,
  },
});
