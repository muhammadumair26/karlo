import { useCallback, useState } from 'react';
import type { Action } from '../store';
import type { Board, Card, State } from '../types';
import { CardItem } from './CardItem';
import { AddForm, EditableText } from './Editable';

type Drag = { kind: 'card'; id: string } | { kind: 'list'; id: string } | null;

export function BoardView({
  board,
  state,
  dispatch,
  filter,
  onOpenCard,
}: {
  board: Board;
  state: State;
  dispatch: React.Dispatch<Action>;
  filter: string;
  onOpenCard: (cardId: string) => void;
}) {
  const [drag, setDrag] = useState<Drag>(null);
  const [cardTarget, setCardTarget] = useState<{ listId: string; index: number } | null>(null);
  const [listTarget, setListTarget] = useState<number | null>(null);
  const [editingList, setEditingList] = useState(false);
  const onEditingChange = useCallback((e: boolean) => setEditingList(e), []);

  const q = filter.trim().toLowerCase();
  const matches = (c: Card) =>
    !q || c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);

  const endDrag = () => {
    setDrag(null);
    setCardTarget(null);
    setListTarget(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (drag?.kind === 'card' && cardTarget) {
      dispatch({ type: 'MOVE_CARD', cardId: drag.id, toListId: cardTarget.listId, toIndex: cardTarget.index });
    } else if (drag?.kind === 'list' && listTarget !== null) {
      dispatch({ type: 'MOVE_LIST', boardId: board.id, listId: drag.id, toIndex: listTarget });
    }
    endDrag();
  };

  return (
    <div className="board-canvas" onDrop={onDrop} onDragOver={(e) => drag && e.preventDefault()}>
      {board.listIds.map((listId, listIndex) => {
        const list = state.lists[listId];
        if (!list) return null;
        const visible = list.cardIds.map((id) => state.cards[id]).filter((c): c is Card => !!c && matches(c));
        const target = cardTarget?.listId === list.id ? cardTarget.index : null;
        const placeholderAtEnd =
          target !== null && !visible.some((c) => list.cardIds.indexOf(c.id) === target);

        return (
          <div
            key={list.id}
            className={`list ${drag?.kind === 'list' && drag.id === list.id ? 'dragging' : ''} ${
              listTarget === listIndex ? 'drop-before' : ''
            } ${listTarget === listIndex + 1 && listIndex === board.listIds.length - 1 ? 'drop-after' : ''}`}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              if (drag.kind === 'list') {
                const r = e.currentTarget.getBoundingClientRect();
                setListTarget(e.clientX < r.left + r.width / 2 ? listIndex : listIndex + 1);
              } else {
                // Hovering the list but not a specific card → drop at the end.
                setCardTarget({ listId: list.id, index: list.cardIds.length });
              }
            }}
          >
            <div
              className="list-header"
              draggable={!editingList}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', list.id);
                setDrag({ kind: 'list', id: list.id });
              }}
              onDragEnd={endDrag}
            >
              <EditableText
                className="list-title"
                value={list.title}
                onSave={(title) => dispatch({ type: 'RENAME_LIST', listId: list.id, title })}
                onEditingChange={onEditingChange}
              />
              <span className="list-count">{list.cardIds.length}</span>
              <button
                className="icon-btn"
                title="Delete list"
                onClick={() => {
                  if (confirm(`Delete list "${list.title}" and its ${list.cardIds.length} card(s)?`))
                    dispatch({ type: 'DELETE_LIST', boardId: board.id, listId: list.id });
                }}
              >
                🗑
              </button>
            </div>

            <div className="list-cards">
              {visible.map((card) => {
                const realIndex = list.cardIds.indexOf(card.id);
                return (
                  <div key={card.id}>
                    {target === realIndex && <div className="card-placeholder" />}
                    <CardItem
                      card={card}
                      dragging={drag?.kind === 'card' && drag.id === card.id}
                      onOpen={() => onOpenCard(card.id)}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', card.id);
                        setDrag({ kind: 'card', id: card.id });
                      }}
                      onDragEnd={endDrag}
                      onDragOver={(e) => {
                        if (drag?.kind !== 'card') return;
                        e.preventDefault();
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        const before = e.clientY < r.top + r.height / 2;
                        setCardTarget({ listId: list.id, index: before ? realIndex : realIndex + 1 });
                      }}
                    />
                  </div>
                );
              })}
              {placeholderAtEnd && <div className="card-placeholder" />}
              {q && visible.length === 0 && list.cardIds.length > 0 && <div className="muted small-note">No matching cards</div>}
            </div>

            <AddForm
              label="Add a card"
              placeholder="Enter a title for this card…"
              submitLabel="Add card"
              multiline
              onAdd={(title) => dispatch({ type: 'ADD_CARD', listId: list.id, title })}
            />
          </div>
        );
      })}

      <div className="list add-list">
        <AddForm
          label={board.listIds.length ? 'Add another list' : 'Add a list'}
          placeholder="Enter list title…"
          submitLabel="Add list"
          onAdd={(title) => dispatch({ type: 'ADD_LIST', boardId: board.id, title })}
        />
      </div>
    </div>
  );
}
