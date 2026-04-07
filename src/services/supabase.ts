import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
// NOTE: react-native-url-polyfill is intentionally removed.
// React Native 0.73+ has native URL support; the polyfill causes
// recursive stack overflow on RN 0.81 (RangeError: Maximum call stack size exceeded).
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../constants';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
