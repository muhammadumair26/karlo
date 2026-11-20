import {
  AlignLeft,
  Archive,
  CheckSquare,
  ChevronDown,
  Clock,
  Flag,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Tag,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BoardActionBody } from '../lib/board';
import { cardListId, uid } from '../lib/board';
import { dueStatus, formatDate } from '../lib/filters';
import type { BoardData, Card, Me, Person, Priority } from '../lib/types';
import { LABEL_COLORS, PRIORITIES } from '../lib/types';
import { LabelsEditor } from './LabelsEditor';
import { Avatar, Menu, Modal, timeAgo } from './ui';

type Pop = null | 'add' | 'labels' | 'dates' | 'members' | 'attachment' | 'priority';

/** @handle used for mentions: the part of the email before "@". */
const handleOf = (p: Person) => p.email.split('@')[0];

/** Renders text with @mentions highlighted and bare links clickable. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(@[\w.+-]+|https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('@') ? (
          <span key={i} className="mention">
            {part}
          </span>
        ) : /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer noopener">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function Popover({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="popover" onMouseDown={(e) => e.stopPropagation()}>
      <div className="popover-head">
        <span>{title}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="popover-body">{children}</div>
    </div>
  );
}

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
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(card.description);
  const [pop, setPop] = useState<Pop>(null);
  const [menu, setMenu] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [link, setLink] = useState({ name: '', url: '' });
  const [comment, setComment] = useState('');
  const [commentFocus, setCommentFocus] = useState(false);
  const [mention, setMention] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [editLabels, setEditLabels] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const itemRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingDesc) setDesc(card.description);
  }, [card.description, editingDesc]);

  const ro = !editable;
  const update = (patch: Partial<Card>, note?: string) => dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch, note });
  const listId = cardListId(data, card.id);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const done = card.checklist.filter((i) => i.done).length;
  const pct = card.checklist.length ? Math.round((done / card.checklist.length) * 100) : 0;
  const prio = PRIORITIES.find((p) => p.value === card.priority)!;
  const status = dueStatus(card);
  const cardLabels = card.labelIds.map((id) => data.labels.find((l) => l.id === id)).filter((l): l is (typeof data.labels)[number] => !!l);

  const toggle = (p: Pop) => setPop(pop === p ? null : p);
  const toggleAssignee = (p: Person) => {
    const on = card.assignees.includes(p.user_id);
    update(
      { assignees: on ? card.assignees.filter((x) => x !== p.user_id) : [...card.assignees, p.user_id] },
      on ? `removed ${p.name} from {card}` : `assigned ${p.name} to {card}`,
    );
  };
  const openChecklist = () => {
    setPop(null);
    setTimeout(() => {
      itemRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      itemRef.current?.focus();
    }, 30);
  };

  // ---- comments + mentions
  const onCommentChange = (v: string, caret: number) => {
    setComment(v);
    const m = v.slice(0, caret).match(/(?:^|\s)@([\w.+-]*)$/);
    setMention(m ? m[1].toLowerCase() : null);
  };
  const mentionMatches =
    mention === null
      ? []
      : people.filter((p) => handleOf(p).toLowerCase().includes(mention) || p.name.toLowerCase().includes(mention)).slice(0, 6);
  const insertMention = (p: Person) => {
    const el = commentRef.current;
    const caret = el?.selectionStart ?? comment.length;
    const before = comment.slice(0, caret).replace(/@([\w.+-]*)$/, `@${handleOf(p)} `);
    setComment(before + comment.slice(caret));
    setMention(null);
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    }, 0);
  };
  const submitComment = () => {
    const t = comment.trim();
    if (!t) return;
    dispatch({ type: 'ADD_COMMENT', cardId: card.id, comment: { id: uid(), authorId: me.id, authorName: me.name, text: t, createdAt: Date.now() } });
    setComment('');
    setCommentFocus(false);
    setMention(null);
  };
  const reply = (name: string, authorId: string) => {
    const p = peopleById.get(authorId);
    setComment(`@${p ? handleOf(p) : name.replace(/\s+/g, '')} `);
    setCommentFocus(true);
    setTimeout(() => {
      const el = commentRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  };

  // Comments + (optionally) activity, newest first.
  type FeedItem = { at: number; key: string; node: ReactNode };
  const feed: FeedItem[] = card.comments.map((c) => {
    const author = peopleById.get(c.authorId);
    return {
      at: c.createdAt,
      key: c.id,
      node: (
        <div className="feed-item">
          <Avatar id={c.authorId} name={author?.name ?? c.authorName} src={author?.avatar_url} size={32} />
          <div className="feed-main">
            <div className="feed-head">
              <strong>{author?.name ?? c.authorName}</strong> <span className="feed-time">{timeAgo(c.createdAt)}</span>
            </div>
            <div className="comment-body">
              <RichText text={c.text} />
            </div>
            {editable && (
              <div className="feed-actions">
                <button className="link-btn" onClick={() => reply(c.authorName, c.authorId)}>
                  Reply
                </button>
                {c.authorId === me.id && (
                  <>
                    <span>•</span>
                    <button
                      className="link-btn"
                      onClick={() => confirm('Delete this comment?') && dispatch({ type: 'DELETE_COMMENT', cardId: card.id, commentId: c.id })}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ),
    };
  });
  if (showDetails) {
    for (const a of data.activity.filter((x) => x.cardId === card.id && !x.text.startsWith('commented'))) {
      feed.push({
        at: a.at,
        key: a.id,
        node: (
          <div className="feed-item activity-item">
            <Avatar id={a.by} name={a.by} size={32} />
            <div className="feed-main">
              <div>
                <strong>{a.by}</strong> {a.text}
              </div>
              <span className="feed-time">{timeAgo(a.at)}</span>
            </div>
          </div>
        ),
      });
    }
    feed.push({
      at: card.createdAt - 1,
      key: 'created',
      node: <div className="feed-item activity-item muted">Card created {new Date(card.createdAt).toLocaleString()}</div>,
    });
  }
  feed.sort((x, y) => y.at - x.at);

  // ---- popovers
  const popover = (() => {
    switch (pop) {
      case 'add':
        return (
          <Popover title="Add to card" onClose={() => setPop(null)}>
            {(
              [
                ['labels', Tag, 'Labels', 'Organize, categorize, and prioritize'],
                ['dates', Clock, 'Dates', 'Start dates and due dates'],
                ['checklist', CheckSquare, 'Checklist', 'Add subtasks'],
                ['members', User, 'Members', 'Assign members'],
                ['priority', Flag, 'Priority', 'Urgent, high, medium or low'],
                ['attachment', Paperclip, 'Attachment', 'Add links to files, docs and designs'],
              ] as const
            ).map(([key, Icon, label, hint]) => (
              <button key={key} className="add-option" onClick={() => (key === 'checklist' ? openChecklist() : setPop(key))}>
                <span className="add-option-icon">
                  <Icon size={18} />
                </span>
                <span>
                  <strong>{label}</strong>
                  <span className="muted">{hint}</span>
                </span>
              </button>
            ))}
          </Popover>
        );
      case 'labels':
        return (
          <Popover title="Labels" onClose={() => (setPop(null), setEditLabels(false))}>
            {editLabels ? (
              <>
                <LabelsEditor labels={data.labels} onChange={(labels) => dispatch({ type: 'SET_LABELS', labels })} />
                <button className="btn small" onClick={() => setEditLabels(false)}>
                  Done
                </button>
              </>
            ) : (
              <>
                {data.labels.map((l) => {
                  const on = card.labelIds.includes(l.id);
                  return (
                    <label key={l.id} className="label-check">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => update({ labelIds: on ? card.labelIds.filter((x) => x !== l.id) : [...card.labelIds, l.id] })}
                      />
                      <span className="label-bar-wide" style={{ background: LABEL_COLORS[l.color] }}>
                        {l.name}
                      </span>
                    </label>
                  );
                })}
                <button className="btn small full" onClick={() => setEditLabels(true)}>
                  Create or edit labels
                </button>
              </>
            )}
          </Popover>
        );
      case 'dates':
        return (
          <Popover title="Dates" onClose={() => setPop(null)}>
            <label className="pop-field">
              Start date
              <input type="date" value={card.start ?? ''} onChange={(e) => update({ start: e.target.value || null })} />
            </label>
            <label className="pop-field">
              Due date
              <input
                type="date"
                value={card.due ?? ''}
                onChange={(e) => update({ due: e.target.value || null }, e.target.value ? `set {card} due ${e.target.value}` : undefined)}
              />
            </label>
            {(card.start || card.due) && (
              <button className="btn small full" onClick={() => update({ start: null, due: null, dueDone: false })}>
                Remove dates
              </button>
            )}
          </Popover>
        );
      case 'members':
        return (
          <Popover title="Members" onClose={() => setPop(null)}>
            {people.map((p) => (
              <button key={p.user_id} className={`member-option ${card.assignees.includes(p.user_id) ? 'on' : ''}`} onClick={() => toggleAssignee(p)}>
                <Avatar id={p.user_id} name={p.name} src={p.avatar_url} size={28} />
                <span className="member-option-text">
                  {p.name}
                  <span className="muted">@{handleOf(p)}</span>
                </span>
                {card.assignees.includes(p.user_id) && <span className="tick">✓</span>}
              </button>
            ))}
            {people.length === 0 && <p className="muted">Invite people with Share first.</p>}
          </Popover>
        );
      case 'priority':
        return (
          <Popover title="Priority" onClose={() => setPop(null)}>
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                className={`member-option ${card.priority === p.value ? 'on' : ''}`}
                onClick={() => {
                  update({ priority: p.value as Priority }, `set priority of {card} to ${p.label}`);
                  setPop(null);
                }}
              >
                <Flag size={16} color={p.color} />
                <span className="member-option-text">{p.label}</span>
                {card.priority === p.value && <span className="tick">✓</span>}
              </button>
            ))}
          </Popover>
        );
      case 'attachment':
        return (
          <Popover title="Attach a link" onClose={() => setPop(null)}>
            <form
              className="pop-form"
              onSubmit={(e) => {
                e.preventDefault();
                let url = link.url.trim();
                if (!url) return;
                if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
                update({ attachments: [...card.attachments, { id: uid(), name: link.name.trim(), url, addedAt: Date.now() }] }, 'attached a link to {card}');
                setLink({ name: '', url: '' });
                setPop(null);
              }}
            >
              <label className="pop-field">
                Link
                <input autoFocus placeholder="Paste a link (Drive, Figma, docs…)" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} />
              </label>
              <label className="pop-field">
                Display text (optional)
                <input value={link.name} onChange={(e) => setLink({ ...link, name: e.target.value })} />
              </label>
              <button className="btn primary full">Insert</button>
            </form>
          </Popover>
        );
      default:
        return null;
    }
  })();

  const showMembers = card.assignees.length > 0 || card.guests.length > 0;
  const showDates = !!(card.start || card.due);

  return (
    <Modal onClose={onClose} bare className="card-window">
      {/* ---------- top strip */}
      <div className="cw-top">
        {editable ? (
          <label className="list-pill" title="Move to another list">
            <select value={listId} onChange={(e) => dispatch({ type: 'MOVE_CARD', cardId: card.id, toListId: e.target.value, toIndex: 1e9 })}>
              {data.listOrder
                .filter((id) => !data.lists[id].archived)
                .map((id) => (
                  <option key={id} value={id}>
                    {data.lists[id].title}
                  </option>
                ))}
            </select>
            <ChevronDown size={14} />
          </label>
        ) : (
          <span className="list-pill">{listId && data.lists[listId]?.title}</span>
        )}
        {card.archived && <span className="archived-pill">Archived</span>}
        <span className="header-spacer" />
        {editable && (
          <span className="menu-anchor">
            <button className="icon-btn cw-icon" onClick={() => setMenu(!menu)} aria-label="Card actions">
              <MoreHorizontal size={20} />
            </button>
            <Menu open={menu} onClose={() => setMenu(false)}>
              <button onClick={() => (setMenu(false), update({ archived: !card.archived }, card.archived ? 'restored {card}' : 'archived {card}'))}>
                <Archive size={16} /> {card.archived ? 'Restore card' : 'Archive card'}
              </button>
              <button
                className="danger-text"
                onClick={() => {
                  setMenu(false);
                  if (confirm('Delete this card permanently? This cannot be undone.')) {
                    dispatch({ type: 'DELETE_CARD', cardId: card.id });
                    onClose();
                  }
                }}
              >
                <Trash2 size={16} /> Delete card
              </button>
            </Menu>
          </span>
        )}
        <button className="icon-btn cw-icon" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>

      {/* Clicking anywhere outside the action buttons/pop-up closes the pop-up. */}
      <div className="cw-body" onMouseDown={() => pop && setPop(null)}>
        {/* ---------- left: details */}
        <div className="cw-main">
          <div className="cw-title-row">
            <button
              className={`complete-circle big ${card.completed ? 'on' : ''}`}
              disabled={ro}
              title={card.completed ? 'Mark incomplete' : 'Mark complete'}
              onClick={() => update({ completed: !card.completed }, card.completed ? 'marked {card} incomplete' : 'completed {card}')}
            >
              {card.completed && (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
                  <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <textarea
              className="cw-title"
              rows={1}
              value={title}
              readOnly={ro}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
              onBlur={() => title.trim() && title !== card.title && update({ title: title.trim() }, `renamed {card} to “${title.trim()}”`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
            />
          </div>

          {editable && (
            <div className="cw-actions" onMouseDown={(e) => e.stopPropagation()}>
              <button className={`cw-btn dark ${pop === 'add' ? 'on' : ''}`} onClick={() => toggle('add')}>
                <Plus size={16} /> Add
              </button>
              <button className={`cw-btn ${pop === 'labels' ? 'on' : ''}`} onClick={() => toggle('labels')}>
                <Tag size={16} /> Labels
              </button>
              <button className={`cw-btn ${pop === 'dates' ? 'on' : ''}`} onClick={() => toggle('dates')}>
                <Clock size={16} /> Dates
              </button>
              <button className="cw-btn" onClick={openChecklist}>
                <CheckSquare size={16} /> Checklist
              </button>
              <button className={`cw-btn ${pop === 'members' ? 'on' : ''}`} onClick={() => toggle('members')}>
                <User size={16} /> Members
              </button>
              <button className={`cw-btn ${pop === 'attachment' ? 'on' : ''}`} onClick={() => toggle('attachment')}>
                <Paperclip size={16} /> Attachment
              </button>
              {popover}
            </div>
          )}

          {/* chips row: members / labels / dates / priority */}
          {(showMembers || cardLabels.length > 0 || showDates || card.priority !== 'none') && (
            <div className="cw-chips">
              {showMembers && (
                <div className="cw-chip-group">
                  <h5>Members</h5>
                  <div className="cw-chip-row">
                    {card.assignees.map((id) => {
                      const p = peopleById.get(id);
                      return <Avatar key={id} id={id} name={p?.name ?? 'Former member'} src={p?.avatar_url} size={32} />;
                    })}
                    {card.guests.map((g) => (
                      <Avatar key={g} id={'guest:' + g} name={g} size={32} title={`${g} (imported — link via board menu)`} />
                    ))}
                    {editable && (
                      <button className="round-add" onMouseDown={(e) => e.stopPropagation()} onClick={() => toggle('members')} aria-label="Add member">
                        <Plus size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {cardLabels.length > 0 && (
                <div className="cw-chip-group">
                  <h5>Labels</h5>
                  <div className="cw-chip-row">
                    {cardLabels.map((l) => (
                      <span key={l.id} className="label-pill" style={{ background: LABEL_COLORS[l.color] }}>
                        {l.name || ' '}
                      </span>
                    ))}
                    {editable && (
                      <button className="round-add square" onMouseDown={(e) => e.stopPropagation()} onClick={() => toggle('labels')} aria-label="Add label">
                        <Plus size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {showDates && (
                <div className="cw-chip-group">
                  <h5>{card.start && card.due ? 'Dates' : card.due ? 'Due date' : 'Start date'}</h5>
                  <div className="cw-chip-row">
                    {card.due && (
                      <input
                        type="checkbox"
                        className="due-check"
                        disabled={ro}
                        checked={card.dueDone}
                        title="Mark due date complete"
                        onChange={(e) => update({ dueDone: e.target.checked }, e.target.checked ? 'marked {card} due date complete' : undefined)}
                      />
                    )}
                    <button className="date-chip" onMouseDown={(e) => e.stopPropagation()} onClick={() => editable && toggle('dates')}>
                      {card.start && formatDate(card.start)}
                      {card.start && card.due && ' – '}
                      {card.due && formatDate(card.due)}
                      {status === 'done' && <span className="date-tag done">Complete</span>}
                      {status === 'overdue' && <span className="date-tag overdue">Overdue</span>}
                      {status === 'soon' && <span className="date-tag soon">Due soon</span>}
                      <ChevronDown size={14} />
                    </button>
                  </div>
                </div>
              )}
              {card.priority !== 'none' && (
                <div className="cw-chip-group">
                  <h5>Priority</h5>
                  <button className="date-chip" style={{ color: prio.color }} onMouseDown={(e) => e.stopPropagation()} onClick={() => editable && toggle('priority')}>
                    <Flag size={14} /> {prio.label}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* description */}
          <section className="cw-section">
            <div className="cw-section-head">
              <AlignLeft size={20} />
              <h4>Description</h4>
              {editable && !editingDesc && card.description && (
                <button className="btn" onClick={() => setEditingDesc(true)}>
                  Edit
                </button>
              )}
            </div>
            {editingDesc ? (
              <div className="cw-indent">
                <textarea className="modal-desc" autoFocus value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Add a more detailed description…" />
                <div className="add-form-actions">
                  <button
                    className="btn primary"
                    onClick={() => {
                      if (desc !== card.description) update({ description: desc });
                      setEditingDesc(false);
                    }}
                  >
                    Save
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setDesc(card.description);
                      setEditingDesc(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : card.description ? (
              <div className="cw-indent desc-view" onClick={() => editable && setEditingDesc(true)}>
                <RichText text={card.description} />
              </div>
            ) : editable ? (
              <button className="cw-indent desc-placeholder" onClick={() => setEditingDesc(true)}>
                Add a more detailed description…
              </button>
            ) : (
              <p className="cw-indent muted">No description.</p>
            )}
          </section>

          {/* attachments */}
          {card.attachments.length > 0 && (
            <section className="cw-section">
              <div className="cw-section-head">
                <Paperclip size={20} />
                <h4>Attachments</h4>
                {editable && (
                  <button className="btn" onMouseDown={(e) => e.stopPropagation()} onClick={() => toggle('attachment')}>
                    Add
                  </button>
                )}
              </div>
              <ul className="cw-indent attach-list">
                {card.attachments.map((a) => (
                  <li key={a.id}>
                    <span className="attach-thumb">
                      <Paperclip size={16} />
                    </span>
                    <span className="attach-info">
                      <a href={a.url} target="_blank" rel="noreferrer noopener">
                        {a.name || a.url}
                      </a>
                      <span className="muted">Added {timeAgo(a.addedAt)}</span>
                    </span>
                    {editable && (
                      <button className="icon-btn" title="Remove" onClick={() => update({ attachments: card.attachments.filter((x) => x.id !== a.id) })}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* checklist */}
          {(card.checklist.length > 0 || editable) && (
            <section className="cw-section">
              <div className="cw-section-head">
                <CheckSquare size={20} />
                <h4>Checklist</h4>
                {card.checklist.some((i) => i.done) && editable && (
                  <button className="btn" onClick={() => update({ checklist: card.checklist.filter((i) => !i.done) })}>
                    Delete checked
                  </button>
                )}
              </div>
              {card.checklist.length > 0 && (
                <div className="cw-progress">
                  <span>{pct}%</span>
                  <div className="progress">
                    <div className={`progress-fill ${pct === 100 ? 'complete' : ''}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}
              <ul className="checklist cw-indent">
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
                      <button className="icon-btn" onClick={() => update({ checklist: card.checklist.filter((i) => i.id !== item.id) })} aria-label="Remove item">
                        <X size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {editable && (
                <form
                  className="checklist-add cw-indent"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const t = newItem.trim();
                    if (!t) return;
                    update({ checklist: [...card.checklist, { id: uid(), text: t, done: false }] });
                    setNewItem('');
                  }}
                >
                  <input ref={itemRef} placeholder="Add an item…" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
                  <button className="btn" type="submit">
                    Add
                  </button>
                </form>
              )}
            </section>
          )}
        </div>

        {/* ---------- right: comments & activity */}
        <aside className="cw-side">
          <div className="cw-side-head">
            <MessageSquare size={18} />
            <h4>Comments and activity</h4>
            <span className="header-spacer" />
            <button className="btn" onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
          </div>

          {editable && (
            <div className={`comment-box ${commentFocus || comment ? 'open' : ''}`}>
              <textarea
                ref={commentRef}
                placeholder="Write a comment… (type @ to mention)"
                value={comment}
                onFocus={() => setCommentFocus(true)}
                onChange={(e) => onCommentChange(e.target.value, e.target.selectionStart)}
                onKeyDown={(e) => {
                  if (mentionMatches.length && e.key === 'Enter') {
                    e.preventDefault();
                    insertMention(mentionMatches[0]);
                  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment();
                  else if (e.key === 'Escape') setMention(null);
                }}
              />
              {mentionMatches.length > 0 && (
                <div className="mention-list">
                  {mentionMatches.map((p) => (
                    <button
                      key={p.user_id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertMention(p);
                      }}
                    >
                      <Avatar id={p.user_id} name={p.name} src={p.avatar_url} size={24} />
                      <span>
                        {p.name} <span className="muted">@{handleOf(p)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {(commentFocus || comment) && (
                <div className="add-form-actions">
                  <button className="btn primary" disabled={!comment.trim()} onClick={submitComment}>
                    Save
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setComment('');
                      setCommentFocus(false);
                      setMention(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="feed">
            {feed.map((f) => (
              <Fragment key={f.key}>{f.node}</Fragment>
            ))}
            {feed.length === 0 && <p className="muted">No comments yet.</p>}
          </div>
        </aside>
      </div>
    </Modal>
  );
}
