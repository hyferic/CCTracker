import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

export const configurationError =
  !url || !publishableKey
    ? 'This deployment is not connected to Supabase. Add the browser-safe project URL and publishable key.'
    : null;

export const supabase: SupabaseClient | null = configurationError
  ? null
  : createClient(url, publishableKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        // Supabase requires an explicit opt-in while its WebAuthn passkey API is experimental.
        experimental: { passkey: true },
      },
    });

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error(configurationError ?? 'Supabase is unavailable.');
  return supabase;
}

export function applicationBaseUrl() {
  const configured = import.meta.env.VITE_APP_BASE_URL?.trim();
  if (configured) return configured.endsWith('/') ? configured : `${configured}/`;
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}
