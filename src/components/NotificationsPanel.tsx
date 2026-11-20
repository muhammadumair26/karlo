import { Bell, BellRing, CheckCheck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadNotifications, markRead, markUnread, type NotificationRow } from '../lib/notify';
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
  const [desktop, setDesktop] = useState(() => (typeof Notification !== 'undefined' ? Notification.permission : 'denied'));
  const seen = useRef<Set<string>>(new Set());
  const first = useRef(true);

  const reload = useCallback(async () => {
    try {
      const rows = await loadNotifications();
      // Desktop pop-up for brand-new notifications while the tab is in the background.
      if (!first.current && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        for (const n of rows.filter((r) => !r.read_at && !seen.current.has(r.id)).slice(0, 3)) {
          const note = new Notification(`${n.actor?.name ?? 'Someone'} · ${n.card_title}`, { body: n.body, tag: n.id, icon: '/icon-192.png' });
          note.onclick = () => {
            window.focus();
            onOpenCard(n.board_id, n.card_id);
          };
        }
      }
      rows.forEach((r) => seen.current.add(r.id));
      first.current = false;
      setItems(rows);
    } catch {
      /* table not set up yet / offline */
    }
  }, [onOpenCard]);

  useEffect(() => {
    void reload();
    if (!supabase) return;
    const sb = supabase;
    const ch = sb
      .channel(`notifications:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => void reload())
      .subscribe();
    const onVisible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      sb.removeChannel(ch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, reload]);

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

      {open && (
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
              {desktop === 'default' && (
                <button
                  className="link-btn"
                  onClick={async () => setDesktop(await Notification.requestPermission())}
                  title="Show a pop-up on your computer when something happens while Karlo is in the background"
                >
                  <BellRing size={13} /> Turn on desktop alerts
                </button>
              )}
              <span className="header-spacer" />
              {unread > 0 && (
                <button className="link-btn" onClick={() => setRead(items.filter((n) => !n.read_at).map((n) => n.id))}>
                  <CheckCheck size={14} /> Mark all as read
                </button>
              )}
            </div>

            <div className="notif-list">
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
                    <div key={n.id} className={`notif-row ${n.read_at ? '' : 'unread'}`}>
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
                        onClick={async () => {
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
        </>
      )}
    </>
  );
}
