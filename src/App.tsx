import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthScreen, SetPasswordScreen } from './components/AuthScreen';
import { BoardPage } from './components/BoardPage';
import { BoardSwitcher, rememberBoard } from './components/BoardSwitcher';
import { ImportModal } from './components/ImportModal';
import { NotificationsBell } from './components/NotificationsPanel';
import { SearchBar } from './components/SearchBar';
import { Sidebar } from './components/Sidebar';
import { Avatar, download, Menu, Modal } from './components/ui';
import { ProfileModal } from './components/ProfileModal';
import { CalendarSyncModal } from './components/CalendarSync';
import { ReminderSettingsModal } from './components/ReminderSettings';
import { SecondStepScreen, SecurityModal } from './components/SecuritySettings';
import { needsSecondStep } from './lib/security';
import { WorkspaceModal } from './components/WorkspaceModal';
import * as api from './lib/api';
import { starterBoard, uid } from './lib/board';
import { karloExport } from './lib/importers';
import { startPresence } from './lib/presence';
import { loadPrefs } from './lib/prefs';
import { registerServiceWorker } from './lib/push';
import { parseCardLink } from './lib/recent';
import type { BoardMeta, Me, Workspace } from './lib/types';
import { BOARD_COLORS } from './lib/types';
import { openedFromSetPasswordLink, supabase } from './supabase';
import { showAlert } from './components/dialog';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(openedFromSetPasswordLink);
  // Two-step sign-in: after the password, ask for the authenticator code (null = still checking).
  const [secondStep, setSecondStep] = useState<boolean | null>(null);
  useEffect(() => {
    if (!session) {
      setSecondStep(null);
      return;
    }
    let live = true;
    needsSecondStep()
      .then((v) => live && setSecondStep(v))
      .catch(() => live && setSecondStep(false));
    return () => {
      live = false;
    };
  }, [session?.user.id, session?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

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
  if (secondStep === null) return <div className="auth-page" />;
  if (secondStep) return <SecondStepScreen onDone={() => setSecondStep(false)} />;
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
  const [newWsOpen, setNewWsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [calSync, setCalSync] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [security, setSecurity] = useState(false);
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
    if (id) rememberBoard(id);
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

  // Show me as "active now" to others while Karlo is open.
  useEffect(() => startPresence(userId), [userId]);
  // Personal preferences (e.g. Views menu order), same on every device.
  useEffect(() => {
    void loadPrefs(userId);
  }, [userId]);

  // Live updates to the board list and memberships.
  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    const ch = sb
      .channel(`nav:${userId}:${uid()}`)
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
        void showAlert({ title: 'Board not available', message: 'That board was deleted, or you no longer have access to it.' });
        return;
      }
      select(boardId);
      setOpenRequest(cardId ? { boardId, cardId, nonce: Date.now() } : null);
    },
    [select],
  );

  // "Edit profile" from a member card.
  useEffect(() => {
    const open = () => setProfileModal(true);
    window.addEventListener('karlo:edit-profile', open);
    return () => window.removeEventListener('karlo:edit-profile', open);
  }, []);

  // Clicking a push notification while Karlo is open: the service worker asks this tab to open the card.
  useEffect(() => {
    void registerServiceWorker();
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== 'karlo:open-url') return;
      const target = parseCardLink(e.data.url);
      if (target) openFromAnywhere(target.boardId, target.cardId);
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [openFromAnywhere]);

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
      void showAlert({ title: 'Something went wrong', message: (e as Error).message, tone: 'danger' });
    }
  };

  const newWorkspace = async (name: string) => {
    try {
      const id = await api.createWorkspace(name);
      await reload();
      setWsModal(id);
    } catch (e) {
      void showAlert({ title: 'Something went wrong', message: (e as Error).message, tone: 'danger' });
    }
  };

  const exportAll = async () => {
    try {
      const all = await Promise.all(boards.map((b) => api.getBoardData(b.id)));
      download(`karlo-backup-${new Date().toISOString().slice(0, 10)}.json`, karloExport(all));
    } catch (e) {
      void showAlert({ title: 'Something went wrong', message: (e as Error).message, tone: 'danger' });
    }
  };

  if (!me || !ready) {
    return (
      <div className="auth-page splash">
        <div className="splash-box" role="status" aria-live="polite">
          <div className="splash-tile">
            <img src={`${import.meta.env.BASE_URL}karlo-icon.png`} alt="" />
          </div>
          <span className="splash-word">Karlo</span>
          {error ? (
            <div className="auth-error">{error}</div>
          ) : (
            <>
              <div className="splash-bar" aria-hidden>
                <span />
              </div>
              <span className="splash-text">Loading your workspace…</span>
            </>
          )}
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
          <img className="brand-logo" src={`${import.meta.env.BASE_URL}karlo-icon.png`} alt="" />
          <span className="brand-text">Karlo</span>
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
            <button onClick={() => (setProfileOpen(false), setCalSync(true))}>Sync with Google Calendar</button>
            <button onClick={() => (setProfileOpen(false), setReminders(true))}>Reminders & daily digest</button>
            <button onClick={() => (setProfileOpen(false), setSecurity(true))}>Security & sign-in</button>
            <button onClick={() => supabase?.auth.signOut()}>Sign out</button>
          </Menu>
        </span>
      </header>

      {error && <div className="banner-error">⚠ {error}</div>}

      <div className="body">
        {/* Phones: tap outside the sidebar to close it. */}
        {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}
        {sidebarOpen && (
          <Sidebar
            onClose={() => setSidebarOpen(false)}
            workspaces={workspaces}
            boards={boards}
            activeBoardId={activeId}
            starred={starred}
            onSelect={select}
            onNewBoard={newBoard}
            onOpenWorkspace={setWsModal}
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
              onNewWorkspace={() => setNewWsOpen(true)}
              onImport={() => setImportOpen(true)}
              onExportAll={exportAll}
              switcher={<BoardSwitcher boards={boards} workspaces={workspaces} starred={starred} activeId={activeId} onSelect={select} />}
              onBoardGone={async () => {
                select(null);
                await reload();
              }}
            />
          ) : (
            <div className="empty">
              <h2>No boards yet</h2>
              <p>Create a board from the sidebar, or import from Trello or ClickUp.</p>
              <div className="empty-actions">
                <button className="btn translucent" onClick={() => setImportOpen(true)}>
                  Import (Trello, ClickUp, CSV)
                </button>
                <button className="btn translucent" onClick={() => setNewWsOpen(true)}>
                  New workspace
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {wsForModal && <WorkspaceModal workspace={wsForModal} me={me} onClose={() => setWsModal(null)} onChanged={reload} />}
      {newWsOpen && (
        <Modal title="New workspace" onClose={() => setNewWsOpen(false)}>
          <form
            className="profile-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
              if (!name) return;
              setNewWsOpen(false);
              await newWorkspace(name);
            }}
          >
            <label>
              <span className="muted">Workspace name — e.g. your team or company</span>
              <input className="text-input" name="name" autoFocus required maxLength={60} placeholder="Orion Soft Sol" />
            </label>
            <div>
              <button className="btn primary">Create workspace</button>
            </div>
          </form>
        </Modal>
      )}
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
      {calSync && <CalendarSyncModal onClose={() => setCalSync(false)} />}
      {reminders && <ReminderSettingsModal onClose={() => setReminders(false)} />}
      {security && <SecurityModal onClose={() => setSecurity(false)} />}
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
