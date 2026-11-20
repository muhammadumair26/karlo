import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';

/**
 * Who is online right now: everyone signed in with Karlo open joins one shared
 * Realtime presence channel, keyed by their user id. Leaving the app (closing the
 * tab, signing out, losing connection) drops them within a few seconds.
 */
let online = new Set<string>();
const listeners = new Set<() => void>();
let channel: RealtimeChannel | null = null;

const emit = () => listeners.forEach((l) => l());

export function startPresence(userId: string) {
  if (!supabase || channel) return () => {};
  const sb = supabase;
  const ch = sb.channel('karlo-online', { config: { presence: { key: userId } } });
  channel = ch;
  ch.on('presence', { event: 'sync' }, () => {
    online = new Set(Object.keys(ch.presenceState()));
    emit();
  }).subscribe((status) => {
    if (status === 'SUBSCRIBED') ch.track({ at: Date.now() });
  });
  return () => {
    sb.removeChannel(ch);
    if (channel === ch) channel = null;
    online = new Set();
    emit();
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** True while this person has Karlo open somewhere. */
export function useOnline(id: string) {
  return useSyncExternalStore(subscribe, () => online.has(id));
}
