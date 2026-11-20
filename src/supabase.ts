import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Vite replaces these exact expressions at build time; in plain Node (tests) they throw, so default to undefined.
let url: string | undefined;
let anonKey: string | undefined;
try {
  url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
} catch {
  /* not running under Vite */
}

/**
 * Read before the client consumes the URL: invite and password-reset links
 * arrive as "#...&type=invite" / "type=recovery", and those users must set a password.
 */
const linkType = typeof window === 'undefined' ? null : new URLSearchParams(window.location.hash.slice(1)).get('type');
export const openedFromSetPasswordLink = linkType === 'invite' || linkType === 'recovery';

/** Null when no Supabase project is configured — the app then runs in local-only mode. */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;
