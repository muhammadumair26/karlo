import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthScreen, SetPasswordScreen } from './components/AuthScreen';
import { BoardPage } from './components/BoardPage';
import { ImportModal } from './components/ImportModal';
import { NotificationsBell } from './components/NotificationsPanel';
import { SearchBar } from './components/SearchBar';
import { Sidebar } from './components/Sidebar';
import { Avatar, download, Menu } from './components/ui';
import { ProfileModal } from './components/ProfileModal';
import { WorkspaceModal } from './components/WorkspaceModal';
import * as api from './lib/api';
import { starterBoard } from './lib/board';
import { karloExport } from './lib/importers';
import type { BoardMeta, Me, Workspace } from './lib/types';
import { BOARD_COLORS } from './lib/types';
import { openedFromSetPasswordLink, supabase } from './supabase';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(openedFromSetPasswordLink);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabase) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h2>Karlo isn't configured</h2>
          <p className="muted">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).</p>
        </div>
      </div>
    );
  }
  if (!authReady) return <div className="auth-page" />;
  if (!session) return <AuthScreen />;
  if (needsPassword) return <SetPasswordScreen email={session.user.email ?? ''} onDone={() => setNeedsPassword(false)} />;
  return <Home key={session.user.id} userId={session.user.id} email={session.user.email ?? ''} />;
}

const ACTIVE_KEY = 'karlo-active-board';

// Avoid running first-sign-in setup twice (React StrictMode runs effects twice in dev).
const bootstraps = new Map<string, Promise<void>>();

function Home({ userId, email }: { userId: string; email: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 720);
  const [wsModal, setWsModal] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [starred, setStarred] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`karlo-starred:${userId}`) ?? '[]');
    } catch {
      return [];
    }
  });
  const toggleStar = (id: string) => {
    const next = starred.includes(id) ? starred.filter((x) => x !== id) : [...starred, id];
    setStarred(next);
    try {
      localStorage.setItem(`karlo-starred:${userId}`, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const [openRequest, setOpenRequest] = useState<{ boardId: string; cardId: string; nonce: number } | null>(null);
  const reloadTimer = useRef<number | undefined>(undefined);
  const boardsRef = useRef<BoardMeta[]>([]);
  boardsRef.current = boards;

  const select = useCallback((id: string | null) => {
    setActiveId(id);
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
    if (window.innerWidth <= 720) setSidebarOpen(false);
  }, []);

  const reload = useCallback(async () => {
    try {
      const r = await api.loadWorkspacesAndBoards(userId);
      setWorkspaces(r.workspaces);
      setBoards(r.boards);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [userId]);

  const reloadSoon = useCallback(() => {
    window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => void reload(), 300);
  }, [reload]);

  // First load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await api.loadMe(userId, email);
        if (cancelled) return;
        setMe(m);
        if (!bootstraps.has(userId)) bootstraps.set(userId, api.bootstrap(m));
        await bootstraps.get(userId);
        await reload();
      } catch (e) {
        setError((e as Error).message);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, email, reload]);

  // Live updates to the board list and memberships.
  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    const ch = sb
      .channel(`nav:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, (p) => {
        // Content-only saves are handled by the open board; only reload for title/colour/new/deleted boards.
        const n = p.new as Partial<BoardMeta> | undefined;
        const o = boardsRef.current.find((b) => b.id === n?.id);
        if (p.eventType === 'UPDATE' && o && n && o.title === n.title && o.color === n.color && o.workspace_id === n.workspace_id) return;
        reloadSoon();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_members', filter: `user_id=eq.${userId}` }, reloadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_members', filter: `user_id=eq.${userId}` }, reloadSoon)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workspaces' }, reloadSoon)
      .subscribe();
    const onVisible = () => document.visibilityState === 'visible' && reloadSoon();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      sb.removeChannel(ch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, reloadSoon]);

  // Keep a valid board selected.
  useEffect(() => {
    if (!ready) return;
    if (!activeId || !boards.some((b) => b.id === activeId)) {
      const first = boards[0]?.id ?? null;
      if (first !== activeId) select(first);
    }
  }, [ready, boards, activeId, select]);

  const active = boards.find((b) => b.id === activeId) ?? null;

  /** Jump to a board (and optionally a card) — used by search and notifications. */
  const openFromAnywhere = useCallback(
    (boardId: string, cardId: string | null) => {
      if (!boardsRef.current.some((b) => b.id === boardId)) {
        alert('That board is no longer available to you.');
        return;
      }
      select(boardId);
      setOpenRequest(cardId ? { boardId, cardId, nonce: Date.now() } : null);
    },
    [select],
  );

  // Card links (attachments) and shared URLs like /?board=…&card=… open the card.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { boardId, cardId } = (e as CustomEvent<{ boardId: string; cardId: string }>).detail;
      openFromAnywhere(boardId, cardId);
    };
    window.addEventListener('karlo:open', onOpen);
    return () => window.removeEventListener('karlo:open', onOpen);
  }, [openFromAnywhere]);
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams(window.location.search);
    const b = q.get('board');
    if (!b) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (boardsRef.current.some((x) => x.id === b)) openFromAnywhere(b, q.get('card'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const wsForModal = workspaces.find((w) => w.id === wsModal) ?? null;

  const newBoard = async (workspaceId: string, title: string) => {
    try {
      const color = BOARD_COLORS[boards.length % BOARD_COLORS.length];
      const id = await api.createBoard(workspaceId, title, color, starterBoard());
      await reload();
      select(id);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const newWorkspace = async (name: string) => {
    try {
      const id = await api.createWorkspace(name);
      await reload();
      setWsModal(id);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const exportAll = async () => {
    try {
      const all = await Promise.all(boards.map((b) => api.getBoardData(b.id)));
      download(`karlo-backup-${new Date().toISOString().slice(0, 10)}.json`, karloExport(all));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  if (!me || !ready) {
    return (
      <div className="auth-page">
        <div className="loading-logo">
          <img src={`${import.meta.env.BASE_URL}karlo-logo.svg`} alt="" />
          {error ? <div className="auth-error">{error}</div> : <span>Loading your workspace…</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="app" style={{ ['--board-color' as string]: active?.color ?? '#2563eb' }}>
      <header className="topbar">
        <button className="icon-btn light" onClick={() => setSidebarOpen((o) => !o)} title="Toggle sidebar">
          ☰
        </button>
        <span className="brand">
          <img className="brand-logo" src={`${import.meta.env.BASE_URL}karlo-logo.svg`} alt="" />
          Karlo
        </span>
        <SearchBar boards={boards} onOpen={openFromAnywhere} />
        <NotificationsBell userId={userId} onOpenCard={openFromAnywhere} />
        <span className="menu-anchor">
          <button className="profile-btn" onClick={() => setProfileOpen(!profileOpen)} title={me.email}>
            <Avatar id={me.id} name={me.name} src={me.avatar_url} size={30} />
          </button>
          <Menu open={profileOpen} onClose={() => setProfileOpen(false)}>
            <div className="menu-head profile-head">
              <Avatar id={me.id} name={me.name} src={me.avatar_url} size={40} />
              <div>
                <strong>{me.name}</strong>
                {me.title && <div className="muted">{me.title}</div>}
                <div className="muted">{me.email}</div>
              </div>
            </div>
            <button onClick={() => (setProfileOpen(false), setProfileModal(true))}>Edit profile & password</button>
            <button onClick={() => supabase?.auth.signOut()}>Sign out</button>
          </Menu>
        </span>
      </header>

      {error && <div className="banner-error">⚠ {error}</div>}

      <div className="body">
        {sidebarOpen && (
          <Sidebar
            workspaces={workspaces}
            boards={boards}
            activeBoardId={activeId}
            starred={starred}
            onSelect={select}
            onNewBoard={newBoard}
            onNewWorkspace={newWorkspace}
            onOpenWorkspace={setWsModal}
            onImport={() => setImportOpen(true)}
            onExportAll={exportAll}
          />
        )}
        <main className="main">
          {active ? (
            <BoardPage
              key={active.id}
              meta={active}
              me={me}
              openCardRequest={openRequest?.boardId === active.id ? openRequest : null}
              starred={starred.includes(active.id)}
              onToggleStar={() => toggleStar(active.id)}
              onMetaChanged={reload}
              onBoardGone={async () => {
                select(null);
                await reload();
              }}
            />
          ) : (
            <div className="empty">
              <h2>No boards yet</h2>
              <p>Create a board from the sidebar, or import from Trello or ClickUp.</p>
            </div>
          )}
        </main>
      </div>

      {wsForModal && <WorkspaceModal workspace={wsForModal} me={me} onClose={() => setWsModal(null)} onChanged={reload} />}
      {importOpen && (
        <ImportModal
          workspaces={workspaces}
          onClose={() => setImportOpen(false)}
          onImported={async (id) => {
            setImportOpen(false);
            await reload();
            if (id) select(id);
          }}
        />
      )}
      {profileModal && (
        <ProfileModal
          me={me}
          onClose={() => setProfileModal(false)}
          onSaved={(m) => setMe(m)}
        />
      )}
    </div>
  );
}
