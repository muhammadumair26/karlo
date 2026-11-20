import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { AuthScreen, SetPasswordScreen } from './components/AuthScreen';
import { BoardView } from './components/BoardView';
import { CardModal } from './components/CardModal';
import { AddForm, EditableText } from './components/Editable';
import { useStore } from './store';
import { openedFromSetPasswordLink, supabase } from './supabase';
import { useCloudSync, type SyncStatus } from './sync';

const STATUS_TEXT: Record<SyncStatus, string> = {
  local: 'Saved on this device',
  connecting: 'Connecting…',
  saving: 'Saving…',
  saved: '✓ Synced',
  offline: '⚠ Offline – will retry',
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [needsPassword, setNeedsPassword] = useState(openedFromSetPasswordLink);

  useEffect(() => {
    if (!supabase) return;
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

  if (!authReady) return <div className="auth-page" />;
  if (supabase && !session) return <AuthScreen />;
  if (session && needsPassword)
    return <SetPasswordScreen email={session.user.email ?? ''} onDone={() => setNeedsPassword(false)} />;
  const userId = session?.user.id ?? null;
  // Remount per user so each account gets its own state.
  return <Workspace key={userId ?? 'local'} userId={userId} email={session?.user.email ?? null} />;
}

function Workspace({ userId, email }: { userId: string | null; email: string | null }) {
  const [state, dispatch] = useStore(userId);
  const syncStatus = useCloudSync(userId, state, dispatch);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const closeModal = useCallback(() => setOpenCardId(null), []);

  const board = state.activeBoardId ? state.boards[state.activeBoardId] : null;
  const openCard = openCardId ? state.cards[openCardId] : null;
  const openCardList = openCard ? Object.values(state.lists).find((l) => l.cardIds.includes(openCard.id)) : null;

  return (
    <div className="app" style={{ ['--board-color' as string]: board?.color ?? '#0079bf' }}>
      <header className="topbar">
        <button className="icon-btn light" onClick={() => setSidebarOpen((o) => !o)} title="Toggle boards">
          ☰
        </button>
        <span className="brand"><img className="brand-logo" src={`${import.meta.env.BASE_URL}karlo-logo.svg`} alt="" />Karlo</span>
        {board && (
          <input
            className="search"
            placeholder="Filter cards…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        <span className={`sync-status sync-${syncStatus}`}>{STATUS_TEXT[syncStatus]}</span>
        {email && (
          <button className="btn translucent signout" onClick={() => supabase?.auth.signOut()} title={email}>
            Sign out
          </button>
        )}
      </header>

      <div className="body">
        {sidebarOpen && (
          <aside className="sidebar">
            <h3>Your boards</h3>
            <ul>
              {state.boardOrder.map((id) => {
                const b = state.boards[id];
                return (
                  <li key={id} className={id === state.activeBoardId ? 'active' : ''}>
                    <button onClick={() => dispatch({ type: 'SELECT_BOARD', boardId: id })}>
                      <span className="swatch" style={{ background: b.color }} />
                      {b.title}
                    </button>
                  </li>
                );
              })}
            </ul>
            <AddForm
              label="New board"
              placeholder="Board title…"
              submitLabel="Create"
              onAdd={(title) => dispatch({ type: 'ADD_BOARD', title })}
            />
          </aside>
        )}

        <main className="main">
          {board ? (
            <>
              <div className="board-header">
                <EditableText
                  className="board-title"
                  value={board.title}
                  onSave={(title) => dispatch({ type: 'RENAME_BOARD', boardId: board.id, title })}
                />
                <button
                  className="btn translucent"
                  onClick={() => {
                    if (confirm(`Delete board "${board.title}"? This cannot be undone.`))
                      dispatch({ type: 'DELETE_BOARD', boardId: board.id });
                  }}
                >
                  Delete board
                </button>
              </div>
              <BoardView board={board} state={state} dispatch={dispatch} filter={filter} onOpenCard={setOpenCardId} />
            </>
          ) : (
            <div className="empty">
              <h2>No boards yet</h2>
              <p>Create your first board from the sidebar.</p>
            </div>
          )}
        </main>
      </div>

      {openCard && (
        <CardModal
          key={openCard.id}
          card={openCard}
          listTitle={openCardList?.title ?? ''}
          dispatch={dispatch}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
