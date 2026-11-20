import { ChevronsLeftRight, ChevronsRightLeft, MoreHorizontal } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { BoardActionBody } from '../lib/board';
import { uid } from '../lib/board';
import type { Filters } from '../lib/filters';
import { hasFilters, matches } from '../lib/filters';
import type { BoardData, Card, Label, Person } from '../lib/types';
import { useSignedUrls } from '../lib/files';
import { CardItem } from './CardItem';
import { AddForm, EditableText } from './Editable';
import { Menu } from './ui';
import { askConfirm } from './dialog';

type Drag = { kind: 'card'; id: string } | { kind: 'list'; id: string } | null;

function loadCollapsed(boardId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`karlo-collapsed:${boardId}`) ?? '[]');
  } catch {
    return [];
  }
}

export function KanbanView({
  unreadByCard,
  boardId,
  data,
  dispatch,
  editable,
  filters,
  meId,
  people,
  onOpenCard,
}: {
  unreadByCard?: Map<string, string[]>;
  boardId: string;
  data: BoardData;
  dispatch: (a: BoardActionBody) => void;
  editable: boolean;
  filters: Filters;
  meId: string;
  people: Map<string, Person>;
  onOpenCard: (cardId: string) => void;
}) {
  const [drag, setDrag] = useState<Drag>(null);
  const [cardTarget, setCardTarget] = useState<{ listId: string; index: number } | null>(null);
  const [listTarget, setListTarget] = useState<number | null>(null);
  const [editingList, setEditingList] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Collapsed lists are a per-person view preference, so they live in this browser only.
  const [collapsed, setCollapsed] = useState<string[]>(() => loadCollapsed(boardId));
  const toggleCollapsed = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id];
    setCollapsed(next);
    try {
      localStorage.setItem(`karlo-collapsed:${boardId}`, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const onEditingChange = useCallback((e: boolean) => setEditingList(e), []);
  const labels = new Map<string, Label>(data.labels.map((l) => [l.id, l]));
  const filtering = hasFilters(filters);
  const lists = data.listOrder.map((id) => data.lists[id]).filter((l) => l && !l.archived);
  // Cover images (private files) need short-lived links.
  const coverPath = (c: Card) => (c.cover ? c.attachments.find((x) => x.id === c.cover)?.path : undefined);
  const coverPaths = Object.values(data.cards)
    .map(coverPath)
    .filter((p): p is string => !!p)
    .sort();
  const coverUrls = useSignedUrls(coverPaths);

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
      // listTarget indexes visible lists; convert to listOrder index.
      const targetList = lists[listTarget];
      const toIndex = targetList ? data.listOrder.indexOf(targetList.id) : data.listOrder.length;
      dispatch({ type: 'MOVE_LIST', listId: drag.id, toIndex });
    }
    endDrag();
  };

  return (
    <div className="board-canvas" onDrop={onDrop} onDragOver={(e) => drag && e.preventDefault()}>
      {lists.map((list, listIndex) => {
        const visible = list.cardIds.map((id) => data.cards[id]).filter((c): c is Card => !!c && matches(c, filters, meId));
        const target = cardTarget?.listId === list.id ? cardTarget.index : null;
        const placeholderAtEnd = target !== null && !visible.some((c) => list.cardIds.indexOf(c.id) === target);
        const activeCount = list.cardIds.filter((id) => data.cards[id] && !data.cards[id].archived).length;

        if (collapsed.includes(list.id)) {
          return (
            <div
              key={list.id}
              className="list collapsed"
              onClick={() => toggleCollapsed(list.id)}
              title="Expand list"
              onDragOver={(e) => {
                if (drag?.kind !== 'card') return;
                e.preventDefault();
                setCardTarget({ listId: list.id, index: list.cardIds.length });
              }}
            >
              <ChevronsLeftRight size={16} />
              <span className="collapsed-title">{list.title}</span>
              <span className="list-count">{activeCount}</span>
            </div>
          );
        }

        return (
          <div
            key={list.id}
            className={`list ${drag?.kind === 'list' && drag.id === list.id ? 'dragging' : ''} ${
              listTarget === listIndex ? 'drop-before' : ''
            } ${listTarget === listIndex + 1 && listIndex === lists.length - 1 ? 'drop-after' : ''}`}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              if (drag.kind === 'list') {
                const r = e.currentTarget.getBoundingClientRect();
                setListTarget(e.clientX < r.left + r.width / 2 ? listIndex : listIndex + 1);
              } else {
                setCardTarget({ listId: list.id, index: list.cardIds.length });
              }
            }}
          >
            <div
              className="list-header"
              draggable={editable && !editingList}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', list.id);
                setDrag({ kind: 'list', id: list.id });
              }}
              onDragEnd={endDrag}
            >
              {editable ? (
                <EditableText
                  className="list-title"
                  value={list.title}
                  onSave={(title) => dispatch({ type: 'RENAME_LIST', listId: list.id, title })}
                  onEditingChange={onEditingChange}
                />
              ) : (
                <span className="list-title">{list.title}</span>
              )}
              <span className="list-count">{filtering ? `${visible.length}/${activeCount}` : activeCount}</span>
              <button className="icon-btn list-icon" title="Collapse list" onClick={() => toggleCollapsed(list.id)}>
                <ChevronsRightLeft size={16} />
              </button>
              {editable && (
                <span className="menu-anchor">
                  <button className="icon-btn list-icon" title="List actions" onClick={() => setMenuFor(menuFor === list.id ? null : list.id)}>
                    <MoreHorizontal size={16} />
                  </button>
                  <Menu open={menuFor === list.id} onClose={() => setMenuFor(null)}>
                    <button
                      onClick={() => {
                        setMenuFor(null);
                        dispatch({ type: 'ARCHIVE_LIST', listId: list.id, archived: true });
                      }}
                    >
                      Archive list
                    </button>
                    <button
                      onClick={() => {
                        setMenuFor(null);
                        for (const cid of list.cardIds)
                          if (data.cards[cid] && !data.cards[cid].archived)
                            dispatch({ type: 'UPDATE_CARD', cardId: cid, patch: { archived: true } });
                      }}
                    >
                      Archive all cards in list
                    </button>
                    <button
                      className="danger-text"
                      onClick={async () => {
                        setMenuFor(null);
                        if (
                          await askConfirm({
                            title: `Delete list “${list.title}”?`,
                            message: `The list and its ${list.cardIds.length} card${list.cardIds.length === 1 ? '' : 's'} are deleted permanently. This cannot be undone.`,
                            confirmLabel: 'Delete list',
                            tone: 'danger',
                          })
                        )
                          dispatch({ type: 'DELETE_LIST', listId: list.id });
                      }}
                    >
                      Delete list
                    </button>
                  </Menu>
                </span>
              )}
            </div>

            <div className="list-cards">
              {visible.map((card) => {
                const realIndex = list.cardIds.indexOf(card.id);
                return (
                  <div key={card.id}>
                    {target === realIndex && <div className="card-placeholder" />}
                    <CardItem
                      unread={unreadByCard?.get(card.id)?.length ?? 0}
                      card={card}
                      coverUrl={coverPath(card) ? coverUrls.get(coverPath(card)!) : undefined}
                      labels={labels}
                      people={people}
                      draggable={editable}
                      dragging={drag?.kind === 'card' && drag.id === card.id}
                      onOpen={() => onOpenCard(card.id)}
                      onToggleComplete={
                        editable
                          ? () =>
                              dispatch({
                                type: 'UPDATE_CARD',
                                cardId: card.id,
                                patch: { completed: !card.completed },
                                note: card.completed ? 'marked {card} incomplete' : 'completed {card}',
                              })
                          : undefined
                      }
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
              {filtering && visible.length === 0 && activeCount > 0 && <div className="muted small-note">No matching cards</div>}
            </div>

            {editable && (
              <AddForm
                label="Add a card"
                placeholder="Enter a title for this card…"
                submitLabel="Add card"
                multiline
                onAdd={(title) => dispatch({ type: 'ADD_CARD', listId: list.id, cardId: uid(), title })}
              />
            )}
          </div>
        );
      })}

      {editable && (
        <div className="list add-list">
          <AddForm
            label={lists.length ? 'Add another list' : 'Add a list'}
            placeholder="Enter list title…"
            submitLabel="Add list"
            onAdd={(title) => dispatch({ type: 'ADD_LIST', listId: uid(), title })}
          />
        </div>
      )}
    </div>
  );
}
