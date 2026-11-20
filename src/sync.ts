import { useEffect, useRef, useState } from 'react';
import type { Action } from './store';
import { uid } from './store';
import { supabase } from './supabase';
import type { State } from './types';

export type SyncStatus = 'local' | 'connecting' | 'saving' | 'saved' | 'offline';

/** Identifies this browser tab so we can ignore our own realtime echoes. */
const CLIENT_ID = uid();
const TABLE = 'user_state';

/** Which board is open is per-device, so it is never synced. */
const serialize = (s: State) => JSON.stringify({ ...s, activeBoardId: null });

/**
 * Keeps the user's state in one Supabase row (user_state.data):
 * - on start: pull the cloud copy (or upload the local one if this is a new account)
 * - on every local change: push (debounced)
 * - realtime: apply changes made on other devices instantly
 * Conflicts are last-write-wins.
 */
export function useCloudSync(userId: string | null, state: State, dispatch: React.Dispatch<Action>): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(userId ? 'connecting' : 'local');
  const ready = useRef(false);
  const lastSynced = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pushTimer = useRef<number | undefined>(undefined);

  const push = async () => {
    if (!supabase || !userId) return;
    const json = serialize(stateRef.current);
    if (json === lastSynced.current) {
      setStatus('saved');
      return;
    }
    setStatus('saving');
    const { error } = await supabase.from(TABLE).upsert({
      user_id: userId,
      data: JSON.parse(json),
      client_id: CLIENT_ID,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setStatus('offline');
      window.clearTimeout(pushTimer.current);
      pushTimer.current = window.setTimeout(push, 5000); // retry
    } else {
      lastSynced.current = json;
      setStatus(serialize(stateRef.current) === json ? 'saved' : 'saving');
    }
  };

  const pull = async () => {
    if (!supabase || !userId) return false;
    const { data, error } = await supabase.from(TABLE).select('data').eq('user_id', userId).maybeSingle();
    if (error) {
      setStatus('offline');
      return false;
    }
    if (data?.data) {
      const remote = data.data as State;
      const json = serialize(remote);
      const hasUnsavedLocal = lastSynced.current !== null && serialize(stateRef.current) !== lastSynced.current;
      if (json !== lastSynced.current && !hasUnsavedLocal) {
        lastSynced.current = json;
        dispatch({ type: 'REPLACE', data: remote });
      }
      setStatus('saved');
    } else {
      await push(); // brand-new account: upload what's on this device
    }
    return true;
  };

  // Initial load + realtime subscription + resume handling.
  useEffect(() => {
    if (!supabase || !userId) return;
    const sb = supabase;
    let cancelled = false;

    pull().then((ok) => {
      if (!cancelled && ok) ready.current = true;
    });

    const channel = sb
      .channel(`user_state:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: TABLE, filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { data?: State; client_id?: string };
          if (!row?.data || row.client_id === CLIENT_ID) return;
          lastSynced.current = serialize(row.data);
          dispatch({ type: 'REPLACE', data: row.data });
          setStatus('saved');
        },
      )
      .subscribe();

    // Phones suspend background tabs/apps — catch up when we come back.
    const onVisible = () => document.visibilityState === 'visible' && pull();
    const onOnline = () => (ready.current ? push() : pull().then((ok) => ok && (ready.current = true)));
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      window.clearTimeout(pushTimer.current);
      sb.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Push local changes (debounced).
  useEffect(() => {
    if (!ready.current) return;
    if (serialize(state) === lastSynced.current) return;
    setStatus('saving');
    window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(push, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return status;
}
