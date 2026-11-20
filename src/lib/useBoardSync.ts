import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { boardReducer, normalize, uid, type BoardAction, type BoardActionBody } from './board';
import type { BoardData, Me } from './types';

export type SyncStatus = 'loading' | 'saving' | 'saved' | 'offline' | 'error';

interface Confirmed {
  data: BoardData;
  version: number;
}

/**
 * Loads one board and keeps it in sync.
 * - Local edits are queued as actions and shown immediately.
 * - Saves use optimistic locking on `version`; if someone else saved first, we fetch
 *   their copy and replay our queued actions on top, so nobody's edits get lost.
 * - Realtime pushes other people's saves to us instantly.
 */
export function useBoardSync(boardId: string, me: Me) {
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [pending, setPending] = useState<BoardAction[]>([]);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const confirmedRef = useRef<Confirmed | null>(null);
  const pendingRef = useRef<BoardAction[]>([]);
  const inflight = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);

  const applyConfirmed = (c: Confirmed) => {
    confirmedRef.current = c;
    setConfirmed(c);
  };
  const applyPending = (p: BoardAction[]) => {
    pendingRef.current = p;
    setPending(p);
  };

  const fetchLatest = useCallback(async (): Promise<Confirmed | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.from('boards').select('data, version').eq('id', boardId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { data: normalize(data.data), version: data.version as number };
  }, [boardId]);

  const flush = useCallback(async () => {
    if (!supabase || inflight.current || !alive.current) return;
    const base = confirmedRef.current;
    const queue = pendingRef.current;
    if (!base || queue.length === 0) return;
    inflight.current = true;
    setStatus('saving');
    const n = queue.length;
    const next = queue.reduce(boardReducer, base.data);
    try {
      const { data: rows, error } = await supabase
        .from('boards')
        .update({ data: next, version: base.version + 1, updated_at: new Date().toISOString(), updated_by: me.id })
        .eq('id', boardId)
        .eq('version', base.version)
        .select('version');
      if (error) throw error;
      if (!rows || rows.length === 0) {
        // Someone saved first: rebase our queue on their copy and try again.
        const latest = await fetchLatest();
        if (latest) applyConfirmed(latest);
      } else {
        applyConfirmed({ data: next, version: base.version + 1 });
        applyPending(pendingRef.current.slice(n));
      }
      inflight.current = false;
      if (pendingRef.current.length) void flush();
      else setStatus('saved');
    } catch {
      inflight.current = false;
      setStatus('offline');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 4000);
    }
  }, [boardId, me.id, fetchLatest]);

  const dispatch = useCallback(
    (body: BoardActionBody) => {
      const action = { ...body, meta: { id: uid(), at: Date.now(), by: { id: me.id, name: me.name } } } as BoardAction;
      applyPending([...pendingRef.current, action]);
      setStatus('saving');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 350);
    },
    [me.id, me.name, flush],
  );

  // Initial load + realtime.
  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    alive.current = true;
    confirmedRef.current = null;
    setConfirmed(null);
    applyPending([]);
    setStatus('loading');
    setLoadError(null);

    fetchLatest()
      .then((c) => {
        if (!alive.current) return;
        if (!c) {
          setLoadError('This board was deleted or you no longer have access.');
          setStatus('error');
          return;
        }
        applyConfirmed(c);
        setStatus('saved');
      })
      .catch(() => alive.current && setStatus('offline'));

    const channel = sb
      .channel(`board:${boardId}:${uid()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'boards', filter: `id=eq.${boardId}` }, (payload) => {
        const row = payload.new as { data?: unknown; version?: number };
        const cur = confirmedRef.current;
        if (row.version && (!cur || row.version > cur.version) && row.data) {
          applyConfirmed({ data: normalize(row.data), version: row.version });
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'boards', filter: `id=eq.${boardId}` }, () => {
        setLoadError('This board was deleted.');
        setStatus('error');
      })
      .subscribe();

    const catchUp = async () => {
      if (document.visibilityState !== 'visible' || inflight.current) return;
      try {
        const latest = await fetchLatest();
        const cur = confirmedRef.current;
        if (latest && (!cur || latest.version > cur.version)) applyConfirmed(latest);
        if (pendingRef.current.length) void flush();
      } catch {
        /* offline */
      }
    };
    document.addEventListener('visibilitychange', catchUp);
    window.addEventListener('online', catchUp);

    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
      sb.removeChannel(channel);
      document.removeEventListener('visibilitychange', catchUp);
      window.removeEventListener('online', catchUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  // Save before the tab closes if possible.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pendingRef.current.length) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const data = useMemo(() => (confirmed ? pending.reduce(boardReducer, confirmed.data) : null), [confirmed, pending]);

  return { data, status, loadError, dispatch };
}
