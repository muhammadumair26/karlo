import { useCallback, useState } from 'react';
import { BoardView } from './components/BoardView';
import { CardModal } from './components/CardModal';
import { AddForm, EditableText } from './components/Editable';
import { useStore } from './store';

export default function App() {
  const [state, dispatch] = useStore();
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
        <span className="brand">▦ Taskboard</span>
        {board && (
          <input
            className="search"
            placeholder="Filter cards…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
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
