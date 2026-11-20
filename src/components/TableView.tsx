import { ChevronDown, ChevronUp, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import type { BoardActionBody } from '../lib/board';
import { cardListId, uid } from '../lib/board';
import type { Filters } from '../lib/filters';
import { dueStatus, formatDate, matches } from '../lib/filters';
import type { BoardData, Card, Person } from '../lib/types';
import { LABEL_COLORS } from '../lib/types';
import { Avatar } from './ui';

type SortKey = 'title' | 'list' | 'labels' | 'members' | 'due';

/** Trello-style table: Card · List · Labels · Members · Due date, editable in place. */
export function TableView({
  data,
  dispatch,
  editable,
  filters,
  meId,
  people,
  onOpenCard,
}: {
  data: BoardData;
  dispatch: (a: BoardActionBody) => void;
  editable: boolean;
  filters: Filters;
  meId: string;
  people: Map<string, Person>;
  onOpenCard: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'list', dir: 1 });
  const [adding, setAdding] = useState(false);
  const activeLists = data.listOrder.filter((id) => !data.lists[id].archived);
  const [newCard, setNewCard] = useState({ title: '', listId: activeLists[0] ?? '' });
  const labels = new Map(data.labels.map((l) => [l.id, l]));
  const listIndex = new Map(data.listOrder.map((id, i) => [id, i]));

  const rows = Object.values(data.cards)
    .filter((c) => matches(c, filters, meId))
    .map((c) => {
      const lid = cardListId(data, c.id);
      const list = lid ? data.lists[lid] : undefined;
      return { c, list, pos: list ? list.cardIds.indexOf(c.id) : 0 };
    })
    .filter((r): r is { c: Card; list: NonNullable<typeof r.list>; pos: number } => !!r.list && !r.list.archived);

  const name = (c: Card) => people.get(c.assignees[0])?.name ?? c.guests[0] ?? '~';
  rows.sort((a, b) => {
    let r = 0;
    switch (sort.key) {
      case 'title':
        r = a.c.title.localeCompare(b.c.title);
        break;
      case 'list':
        r = listIndex.get(a.list.id)! - listIndex.get(b.list.id)! || a.pos - b.pos;
        break;
      case 'labels':
        r = (labels.get(a.c.labelIds[0])?.name ?? '~').localeCompare(labels.get(b.c.labelIds[0])?.name ?? '~');
        break;
      case 'members':
        r = name(a.c).localeCompare(name(b.c));
        break;
      case 'due':
        r = (a.c.due ?? '9999').localeCompare(b.c.due ?? '9999');
        break;
    }
    return r * sort.dir;
  });

  const th = (key: SortKey, label: string) => (
    <th>
      <button className="th-btn" onClick={() => setSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : 1 })}>
        {label}
        {sort.key === key && (sort.dir === 1 ? <ChevronDown size={14} /> : <ChevronUp size={14} />)}
      </button>
    </th>
  );

  const addCard = () => {
    const t = newCard.title.trim();
    if (!t || !newCard.listId) return;
    dispatch({ type: 'ADD_CARD', listId: newCard.listId, cardId: uid(), title: t });
    setNewCard({ ...newCard, title: '' });
  };

  return (
    <div className="tv-wrap">
      <div className="tv-scroll">
        <table className="tv">
          <thead>
            <tr>
              {th('title', 'Card')}
              {th('list', 'List')}
              {th('labels', 'Labels')}
              {th('members', 'Members')}
              {th('due', 'Due date')}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, list }) => {
              const status = dueStatus(c);
              const avatars = [
                ...c.assignees.map((id) => ({ key: id, id, name: people.get(id)?.name ?? '?', src: people.get(id)?.avatar_url })),
                ...c.guests.map((g) => ({ key: 'g' + g, id: 'guest:' + g, name: g, src: null as string | null | undefined })),
              ];
              return (
                <tr key={c.id}>
                  <td className="tv-card">
                    <div className="tv-card-inner">
                      {editable && (
                        <button
                          className={`complete-circle ${c.completed ? 'on' : ''}`}
                          title={c.completed ? 'Mark incomplete' : 'Mark complete'}
                          onClick={() => dispatch({ type: 'UPDATE_CARD', cardId: c.id, patch: { completed: !c.completed }, note: c.completed ? 'marked {card} incomplete' : 'completed {card}' })}
                        >
                          {c.completed && (
                            <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden>
                              <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      )}
                      <button className="tv-title" onClick={() => onOpenCard(c.id)} title={c.title}>
                        {c.title}
                      </button>
                      <button className="tv-edit" onClick={() => onOpenCard(c.id)} title="Open card">
                        <Pencil size={15} />
                      </button>
                    </div>
                  </td>
                  <td>
                    {editable ? (
                      <select
                        className="tv-select"
                        value={list.id}
                        onChange={(e) => dispatch({ type: 'MOVE_CARD', cardId: c.id, toListId: e.target.value, toIndex: 1e9 })}
                      >
                        {activeLists.map((id) => (
                          <option key={id} value={id}>
                            {data.lists[id].title}
                          </option>
                        ))}
                      </select>
                    ) : (
                      list.title
                    )}
                  </td>
                  <td onClick={() => onOpenCard(c.id)} className="tv-click">
                    {c.labelIds.length ? (
                      <div className="t-labels">
                        {c.labelIds.map((id) => {
                          const l = labels.get(id);
                          return l ? (
                            <span key={id} className="label-chip-sm" style={{ background: LABEL_COLORS[l.color] }}>
                              {l.name || ' '}
                            </span>
                          ) : null;
                        })}
                      </div>
                    ) : (
                      <span className="tv-dot">·</span>
                    )}
                  </td>
                  <td onClick={() => onOpenCard(c.id)} className="tv-click">
                    {avatars.length ? (
                      <span className="tv-avatars">
                        {avatars.slice(0, 5).map((a) => (
                          <Avatar key={a.key} id={a.id} name={a.name} src={a.src} size={24} />
                        ))}
                        {avatars.length > 5 && <span className="muted">+{avatars.length - 5}</span>}
                      </span>
                    ) : (
                      <span className="tv-dot">·</span>
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <label className={`tv-date ${c.due ? `due-${status}` : 'empty'}`}>
                        <span>{c.due ? formatDate(c.due) : '·'}</span>
                        <input
                          type="date"
                          value={c.due ?? ''}
                          onChange={(e) => dispatch({ type: 'UPDATE_CARD', cardId: c.id, patch: { due: e.target.value || null }, note: e.target.value ? `set {card} due ${e.target.value}` : undefined })}
                          aria-label={`Due date for ${c.title}`}
                        />
                      </label>
                    ) : c.due ? (
                      <span className={`badge due-${status}`}>{formatDate(c.due)}</span>
                    ) : (
                      <span className="tv-dot">·</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {adding && editable && (
              <tr className="tv-new">
                <td colSpan={5}>
                  <form
                    className="tv-new-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addCard();
                    }}
                  >
                    <input autoFocus placeholder="Card name" value={newCard.title} onChange={(e) => setNewCard({ ...newCard, title: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
                    <select value={newCard.listId} onChange={(e) => setNewCard({ ...newCard, listId: e.target.value })}>
                      {activeLists.map((id) => (
                        <option key={id} value={id}>
                          {data.lists[id].title}
                        </option>
                      ))}
                    </select>
                    <button className="btn primary">Add card</button>
                    <button type="button" className="btn ghost" onClick={() => setAdding(false)}>
                      Cancel
                    </button>
                  </form>
                </td>
              </tr>
            )}
            {rows.length === 0 && !adding && (
              <tr>
                <td colSpan={5} className="muted empty-row">
                  No cards to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editable && activeLists.length > 0 && !adding && (
        <button className="tv-add" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add
        </button>
      )}
    </div>
  );
}
