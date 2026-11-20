import { useState } from 'react';
import type { BoardActionBody } from '../lib/board';
import { cardListId, uid } from '../lib/board';
import type { BoardData, Card, Me, Person, Priority } from '../lib/types';
import { LABEL_COLORS, PRIORITIES } from '../lib/types';
import { LabelsEditor } from './LabelsEditor';
import { Avatar, Modal, timeAgo } from './ui';

export function CardModal({
  card,
  data,
  people,
  me,
  editable,
  dispatch,
  onClose,
}: {
  card: Card;
  data: BoardData;
  people: Person[];
  me: Me;
  editable: boolean;
  dispatch: (a: BoardActionBody) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [desc, setDesc] = useState(card.description);
  const [newItem, setNewItem] = useState('');
  const [comment, setComment] = useState('');
  const [link, setLink] = useState({ name: '', url: '' });
  const [showLabels, setShowLabels] = useState(false);
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');

  const update = (patch: Partial<Card>, note?: string) => dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch, note });
  const listId = cardListId(data, card.id);
  const peopleById = new Map(people.map((p) => [p.user_id, p]));
  const done = card.checklist.filter((i) => i.done).length;
  const pct = card.checklist.length ? Math.round((done / card.checklist.length) * 100) : 0;
  const ro = !editable;

  const toggleAssignee = (p: Person) => {
    const on = card.assignees.includes(p.user_id);
    update(
      { assignees: on ? card.assignees.filter((x) => x !== p.user_id) : [...card.assignees, p.user_id] },
      on ? `removed ${p.name} from {card}` : `assigned ${p.name} to {card}`,
    );
  };

  return (
    <Modal onClose={onClose} wide>
      <input
        className="modal-title"
        value={title}
        readOnly={ro}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== card.title && update({ title: title.trim() }, `renamed {card} to “${title.trim()}”`)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="modal-sub">
        in list{' '}
        {editable ? (
          <select
            className="inline-select"
            value={listId}
            onChange={(e) => dispatch({ type: 'MOVE_CARD', cardId: card.id, toListId: e.target.value, toIndex: 1e9 })}
          >
            {data.listOrder
              .filter((id) => !data.lists[id].archived)
              .map((id) => (
                <option key={id} value={id}>
                  {data.lists[id].title}
                </option>
              ))}
          </select>
        ) : (
          <strong>{listId && data.lists[listId]?.title}</strong>
        )}
        {card.archived && <span className="archived-pill">Archived</span>}
        {editable ? (
          <button
            className={`complete-toggle ${card.completed ? 'on' : ''}`}
            onClick={() => update({ completed: !card.completed }, card.completed ? 'marked {card} incomplete' : 'completed {card}')}
          >
            {card.completed ? '✓ Completed' : '○ Mark complete'}
          </button>
        ) : (
          card.completed && <span className="complete-toggle on">✓ Completed</span>
        )}
      </div>

      <div className="card-fields">
        <section>
          <h4>Assignees</h4>
          <div className="assignee-picker">
            {people.map((p) => {
              const on = card.assignees.includes(p.user_id);
              return (
                <button
                  key={p.user_id}
                  className={`assignee-chip ${on ? 'on' : ''}`}
                  disabled={ro}
                  onClick={() => toggleAssignee(p)}
                  title={p.email}
                >
                  <Avatar id={p.user_id} name={p.name} size={22} />
                  {p.name}
                  {on && ' ✓'}
                </button>
              );
            })}
            {card.assignees
              .filter((id) => !peopleById.has(id))
              .map((id) => (
                <span key={id} className="assignee-chip on">
                  Former member
                </span>
              ))}
            {people.length === 0 && <span className="muted">Invite people to assign them.</span>}
          </div>
          {card.guests.length > 0 && (
            <div className="guest-row">
              <span className="muted">Imported:</span>
              {card.guests.map((g) => (
                <span key={g} className="assignee-chip guest" title="Imported from Trello/ClickUp — not linked to a Karlo account">
                  <Avatar id={'guest:' + g} name={g} size={22} />
                  {g}
                  {editable && (
                    <button className="link-btn" onClick={() => update({ guests: card.guests.filter((x) => x !== g) })} aria-label={`Remove ${g}`}>
                      ✕
                    </button>
                  )}
                </span>
              ))}
              <span className="muted small-hint">Link them to teammates from the board menu → Link imported people.</span>
            </div>
          )}
        </section>

        <section>
          <h4>Priority</h4>
          <select
            className="field-select"
            disabled={ro}
            value={card.priority}
            onChange={(e) => {
              const p = e.target.value as Priority;
              update({ priority: p }, `set priority of {card} to ${PRIORITIES.find((x) => x.value === p)!.label}`);
            }}
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </section>

        <section>
          <h4>Dates</h4>
          <div className="dates-row">
            <label>
              Start
              <input type="date" disabled={ro} value={card.start ?? ''} onChange={(e) => update({ start: e.target.value || null })} />
            </label>
            <label>
              Due
              <input
                type="date"
                disabled={ro}
                value={card.due ?? ''}
                onChange={(e) => update({ due: e.target.value || null }, e.target.value ? `set {card} due ${e.target.value}` : undefined)}
              />
            </label>
            {card.due && (
              <label className="check-inline">
                <input
                  type="checkbox"
                  disabled={ro}
                  checked={card.dueDone}
                  onChange={(e) => update({ dueDone: e.target.checked }, e.target.checked ? 'marked {card} complete' : 'marked {card} incomplete')}
                />
                Complete
              </label>
            )}
          </div>
        </section>

        <section>
          <h4>
            Labels{' '}
            {editable && (
              <button className="link-btn" onClick={() => setShowLabels(!showLabels)}>
                {showLabels ? 'Done' : 'Edit labels'}
              </button>
            )}
          </h4>
          {showLabels ? (
            <LabelsEditor labels={data.labels} onChange={(labels) => dispatch({ type: 'SET_LABELS', labels })} />
          ) : (
            <div className="label-picker">
              {data.labels.map((l) => {
                const on = card.labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    disabled={ro}
                    className={`label-toggle ${on ? 'on' : ''}`}
                    style={{ background: LABEL_COLORS[l.color] }}
                    onClick={() => update({ labelIds: on ? card.labelIds.filter((x) => x !== l.id) : [...card.labelIds, l.id] })}
                  >
                    {on ? '✓ ' : ''}
                    {l.name || ' '}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section>
        <h4>Description</h4>
        <textarea
          className="modal-desc"
          readOnly={ro}
          placeholder={ro ? 'No description' : 'Add a more detailed description…'}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== card.description && update({ description: desc })}
        />
      </section>

      <section>
        <h4>Checklist {card.checklist.length > 0 && <span className="muted">{pct}%</span>}</h4>
        {card.checklist.length > 0 && (
          <div className="progress">
            <div className={`progress-fill ${pct === 100 ? 'complete' : ''}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        <ul className="checklist">
          {card.checklist.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  disabled={ro}
                  checked={item.done}
                  onChange={() => update({ checklist: card.checklist.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) })}
                />
                <span className={item.done ? 'struck' : ''}>{item.text}</span>
              </label>
              {editable && (
                <button
                  className="btn ghost small"
                  onClick={() => update({ checklist: card.checklist.filter((i) => i.id !== item.id) })}
                  aria-label="Remove item"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <form
            className="checklist-add"
            onSubmit={(e) => {
              e.preventDefault();
              const t = newItem.trim();
              if (!t) return;
              update({ checklist: [...card.checklist, { id: uid(), text: t, done: false }] });
              setNewItem('');
            }}
          >
            <input placeholder="Add an item…" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
            <button className="btn" type="submit">
              Add
            </button>
          </form>
        )}
      </section>

      <section>
        <h4>Attachments & links</h4>
        <ul className="attachments">
          {card.attachments.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer noopener">
                📎 {a.name || a.url}
              </a>
              {editable && (
                <button className="btn ghost small" onClick={() => update({ attachments: card.attachments.filter((x) => x.id !== a.id) })}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <form
            className="checklist-add"
            onSubmit={(e) => {
              e.preventDefault();
              let url = link.url.trim();
              if (!url) return;
              if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
              update(
                { attachments: [...card.attachments, { id: uid(), name: link.name.trim(), url, addedAt: Date.now() }] },
                'attached a link to {card}',
              );
              setLink({ name: '', url: '' });
            }}
          >
            <input placeholder="Paste a link (Google Drive, Figma, …)" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} />
            <input placeholder="Name (optional)" value={link.name} onChange={(e) => setLink({ ...link, name: e.target.value })} className="short" />
            <button className="btn" type="submit">
              Attach
            </button>
          </form>
        )}
      </section>

      <section>
        <div className="tabs-row">
          <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>
            Comments ({card.comments.length})
          </button>
          <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>
            Activity
          </button>
        </div>
        {tab === 'comments' ? (
          <>
            {editable && (
              <form
                className="comment-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = comment.trim();
                  if (!t) return;
                  dispatch({
                    type: 'ADD_COMMENT',
                    cardId: card.id,
                    comment: { id: uid(), authorId: me.id, authorName: me.name, text: t, createdAt: Date.now() },
                  });
                  setComment('');
                }}
              >
                <Avatar id={me.id} name={me.name} size={30} />
                <textarea
                  placeholder="Write a comment…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
                  }}
                />
                <button className="btn primary" type="submit">
                  Save
                </button>
              </form>
            )}
            <ul className="comments">
              {[...card.comments].reverse().map((c) => (
                <li key={c.id}>
                  <Avatar id={c.authorId} name={c.authorName} size={30} />
                  <div>
                    <div className="comment-head">
                      <strong>{c.authorName}</strong> <span className="muted">{timeAgo(c.createdAt)}</span>
                      {(c.authorId === me.id) && editable && (
                        <button
                          className="link-btn"
                          onClick={() => dispatch({ type: 'DELETE_COMMENT', cardId: card.id, commentId: c.id })}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    <div className="comment-body">{c.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="activity">
            {data.activity
              .filter((a) => a.cardId === card.id)
              .map((a) => (
                <li key={a.id}>
                  <strong>{a.by}</strong> {a.text} <span className="muted">· {timeAgo(a.at)}</span>
                </li>
              ))}
            <li className="muted">Card created {new Date(card.createdAt).toLocaleString()}</li>
          </ul>
        )}
      </section>

      {editable && (
        <div className="modal-footer">
          <button className="btn" onClick={() => update({ archived: !card.archived }, card.archived ? 'restored {card}' : 'archived {card}')}>
            {card.archived ? 'Restore card' : 'Archive card'}
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('Delete this card permanently? This cannot be undone.')) {
                dispatch({ type: 'DELETE_CARD', cardId: card.id });
                onClose();
              }
            }}
          >
            Delete card
          </button>
        </div>
      )}
    </Modal>
  );
}
