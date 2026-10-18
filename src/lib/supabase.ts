import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { currentFirebaseUser } from '@/lib/firebase';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseUrl = url ?? '';
export const supabaseAnonKey = anonKey ?? '';
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-anon-key',
  {
    // Identity comes from Firebase Auth (Google sign-in). Supabase validates the
    // Firebase ID token against Google's public keys via a third-party auth
    // integration pinned to the `krishna-vilas` Firebase project.
    accessToken: async () => {
      const user = currentFirebaseUser();
      if (!user) return null;
      try {
        return await user.getIdToken(/* forceRefresh */ false);
      } catch {
        return null;
      }
    },
  },
);

export function publicImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const { data } = supabase.storage.from('food-images').getPublicUrl(path);
  return data.publicUrl;
}
