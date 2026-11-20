import { Bell, BellOff, BellRing, CheckCheck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadNotifications, markRead, markUnread, type NotificationRow } from '../lib/notify';
import { uid } from '../lib/board';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push';
import { supabase } from '../supabase';
import { Avatar, timeAgo } from './ui';

const UNREAD_KEY = 'karlo-notif-unread-only';

/** Bell button with unread count + Trello-style slide-in panel. */
export function NotificationsBell({ userId, onOpenCard }: { userId: string; onOpenCard: (boardId: string, cardId: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(() => {
    try {
      return localStorage.getItem(UNREAD_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [push, setPush] = useState<PushState>('unsupported');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushErr, setPushErr] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    pushState().then((st) => mounted.current && setPush(st)).catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);

  const togglePush = async () => {
    setPushBusy(true);
    setPushErr(null);
    try {
      setPush(push === 'on' ? await disablePush() : await enablePush());
    } catch (e) {
      setPushErr((e as Error).message);
    }
    setPushBusy(false);
  };

  // (System pop-ups now come from push via the service worker, even when Karlo is closed.)
  const reload = useCallback(async () => {
    try {
      setItems(await loadNotifications());
    } catch {
      /* table not set up yet / offline */
    }
  }, []);

  useEffect(() => {
    void reload();
    if (!supabase) return;
    const sb = supabase;
    const ch = sb
      .channel(`notifications:${userId}:${uid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => void reload())
      .subscribe();
    const onVisible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      sb.removeChannel(ch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, reload]);

  // Share with the open board (red bell badges on cards) and reload when asked.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('karlo:notifs', { detail: items }));
  }, [items]);
  useEffect(() => {
    const again = () => void reload();
    window.addEventListener('karlo:notifs-refresh', again);
    return () => window.removeEventListener('karlo:notifs-refresh', again);
  }, [reload]);

  const unread = items.filter((n) => !n.read_at).length;
  useEffect(() => {
    document.title = unread ? `(${unread}) Karlo` : 'Karlo';
  }, [unread]);

  // Group consecutive notifications about the same card, like Trello.
  const groups = useMemo(() => {
    const list = unreadOnly ? items.filter((n) => !n.read_at) : items;
    const out: { key: string; head: NotificationRow; rows: NotificationRow[] }[] = [];
    for (const n of list) {
      const key = `${n.board_id}:${n.card_id}`;
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(n);
      else out.push({ key, head: n, rows: [n] });
    }
    return out;
  }, [items, unreadOnly]);

  const setRead = async (ids: string[]) => {
    const now = new Date().toISOString();
    setItems((xs) => xs.map((x) => (ids.includes(x.id) && !x.read_at ? { ...x, read_at: now } : x)));
    await markRead(ids);
  };

  return (
    <>
      <button className={`icon-btn light bell ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        <Bell size={19} />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {/* Rendered at the page root: the top bar's blur (on photo backgrounds) would otherwise trap this fixed panel inside the bar. */}
      {open &&
        createPortal(
        <>
          <div className="notif-scrim" onClick={() => setOpen(false)} />
          <aside className="notif-panel" role="dialog" aria-label="Notifications">
            <div className="notif-head">
              <h3>Notifications</h3>
              <label className="switch-row">
                <span>Only show unread</span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={unreadOnly}
                  onChange={(e) => {
                    setUnreadOnly(e.target.checked);
                    try {
                      localStorage.setItem(UNREAD_KEY, e.target.checked ? '1' : '0');
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              </label>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close notifications">
                <X size={18} />
              </button>
            </div>
            <div className="notif-tools">
              {push === 'on' && (
                <button className="link-btn" onClick={togglePush} disabled={pushBusy} title="Stop push notifications on this device">
                  <BellRing size={13} /> Push is on · turn off
                </button>
              )}
              {push === 'denied' && (
                <span className="muted push-note">
                  <BellOff size={13} /> Notifications are blocked for Karlo in this browser's site settings
                </span>
              )}
              <span className="header-spacer" />
              {unread > 0 && (
                <button className="link-btn" onClick={() => setRead(items.filter((n) => !n.read_at).map((n) => n.id))}>
                  <CheckCheck size={14} /> Mark all as read
                </button>
              )}
            </div>

            <div className="notif-list">
              {push === 'off' && (
                <div className="push-cta">
                  <BellRing size={22} />
                  <div>
                    <strong>Get notified even when Karlo is closed</strong>
                    <span className="muted">Mentions, new cards assigned to you and updates — as pop-ups on this device.</span>
                    {pushErr && <span className="error-text">{pushErr}</span>}
                  </div>
                  <button className="btn primary" onClick={togglePush} disabled={pushBusy}>
                    {pushBusy ? 'Turning on…' : 'Turn on'}
                  </button>
                </div>
              )}
              {push === 'ios-needs-home-screen' && (
                <div className="push-cta">
                  <BellRing size={22} />
                  <div>
                    <strong>Want notifications on your iPhone?</strong>
                    <span className="muted">Tap Share → “Add to Home Screen”, open Karlo from there, then turn on notifications here.</span>
                  </div>
                </div>
              )}
              {groups.map((g) => (
                <div key={g.head.id + g.key} className="notif-group">
                  <button
                    className="notif-card"
                    style={{ ['--nb' as string]: g.head.board?.color ?? '#2563eb' }}
                    onClick={() => {
                      void setRead(g.rows.map((r) => r.id));
                      setOpen(false);
                      onOpenCard(g.head.board_id, g.head.card_id);
                    }}
                  >
                    <span className="notif-card-title">{g.head.card_title || 'Card'}</span>
                    <span className="notif-card-where">
                      <strong>{g.head.board?.title ?? 'Board'}:</strong> {g.head.list_title}
                    </span>
                  </button>
                  {g.rows.map((n) => (
                    <div
                      key={n.id}
                      className={`notif-row ${n.read_at ? '' : 'unread'}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        void setRead([n.id]);
                        setOpen(false);
                        onOpenCard(n.board_id, n.card_id);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLElement).click()}
                    >
                      <Avatar id={n.actor_id} name={n.actor?.name ?? '?'} src={n.actor?.avatar_url} size={28} />
                      <div className="notif-text">
                        <strong>{n.actor?.name ?? 'Someone'}</strong>
                        <div>
                          {n.body} <span className="muted">{timeAgo(Date.parse(n.created_at))}</span>
                        </div>
                      </div>
                      <button
                        className={`unread-dot ${n.read_at ? 'read' : ''}`}
                        title={n.read_at ? 'Mark as unread' : 'Mark as read'}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (n.read_at) {
                            setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read_at: null } : x)));
                            await markUnread(n.id);
                          } else await setRead([n.id]);
                        }}
                      />
                    </div>
                  ))}
                </div>
              ))}
              {groups.length === 0 && (
                <div className="notif-empty">
                  <Bell size={36} />
                  <p>{unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}</p>
                  <p className="muted">You'll be notified when someone @mentions you, adds you to a card, or updates a card you're on.</p>
                </div>
              )}
            </div>
          </aside>
        </>,
        document.body,
      )}
    </>
  );
}
