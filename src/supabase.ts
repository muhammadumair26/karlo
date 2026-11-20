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
/** "Remember me": when off, the sign-in lives only until the browser is closed (sessionStorage). */
export const REMEMBER_KEY = 'karlo-remember';
export const rememberMe = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
};
const authStorage = {
  getItem: (k: string) => {
    try {
      return (rememberMe() ? localStorage : sessionStorage).getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      (rememberMe() ? localStorage : sessionStorage).setItem(k, v);
    } catch {
      /* storage blocked */
    }
  },
  removeItem: (k: string) => {
    try {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    } catch {
      /* storage blocked */
    }
  },
};

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, typeof window === 'undefined' ? undefined : { auth: { storage: authStorage } }) : null;
