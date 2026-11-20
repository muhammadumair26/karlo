import {
  AlignLeft,
  Wallet,
  LogOut,
  Archive,
  CheckSquare,
  ChevronDown,
  Clock,
  Flag,
  Download,
  ExternalLink,
  ImageIcon,
  Link2,
  Loader2,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  SquareKanban,
  Timer,
  Upload,
  Paperclip,
  Pencil,
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
import { CardAI } from './CardAI';
import { CardTime, useNow } from './CardTime';
import { formatClock, runningEntry } from '../lib/time';
import { CardExpenses, type ExpensesState } from './ExpensesView';
import type { Attachment, BoardData, Card, CardLocation, Me, Person, Priority } from '../lib/types';
import { LABEL_COLORS, PRIORITIES, boardSettings } from '../lib/types';
import { extOf, formatBytes, isImage, fileUrl, MAX_FILE_BYTES, pathsOf, uploadAttachment, useSignedUrls } from '../lib/files';
import { osmLink, searchPlaces, shortPlace } from '../lib/geocode';
import { handleOf } from '../lib/notify';
import { cardLink, parseCardLink, recentCards, rememberCard } from '../lib/recent';
import { LabelsEditor } from './LabelsEditor';
import { MentionInput } from './MentionInput';
import { Avatar, Menu, Modal, timeAgo } from './ui';
import { askConfirm } from './dialog';

type Pop = null | 'add' | 'labels' | 'dates' | 'members' | 'attachment' | 'priority' | 'location';

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
  expenseState,
  isAdmin = false,
  onPersonClick,
  boardId,
  boardTitle,
  onOpenCardLink,
  card,
  data,
  people,
  me,
  editable,
  dispatch,
  onClose,
}: {
  /** Board admin/owner: can manage owners and delete any card. */
  isAdmin?: boolean;
  /** Project expenses (only filled for partners). */
  expenseState?: ExpensesState;
  /** Clicking a member's avatar shows their member card. */
  onPersonClick?: (person: Person, el: HTMLElement) => void;
  boardId: string;
  boardTitle: string;
  /** Open another Karlo card (from a card link attachment). */
  onOpenCardLink?: (boardId: string, cardId: string) => void;
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
  const [addingExpense, setAddingExpense] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [link, setLink] = useState({ name: '', url: '' });
  const [placeQ, setPlaceQ] = useState('');
  const [places, setPlaces] = useState<CardLocation[] | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeErr, setPlaceErr] = useState<string | null>(null);
  const [uploads, setUploads] = useState<{ id: string; name: string; error?: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [attMenu, setAttMenu] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const ro = !editable;
  const [comment, setComment] = useState('');
  const [commentFocus, setCommentFocus] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editLabels, setEditLabels] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const itemRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editingDesc) setDesc(card.description);
  }, [card.description, editingDesc]);

  useEffect(() => {
    rememberCard({ boardId, cardId: card.id, title: card.title, boardTitle });
  }, [boardId, card.id, card.title, boardTitle]);

  // ---- file uploads (button, drag & drop, paste)
  const uploadFiles = async (files: File[]) => {
    if (ro || files.length === 0) return;
    const jobs = files.map((f) => ({ id: uid(), file: f }));
    setUploads((u) => [...u, ...jobs.map((j) => ({ id: j.id, name: j.file.name || 'Pasted image', error: j.file.size > MAX_FILE_BYTES ? 'Larger than 25 MB' : undefined }))]);
    setPop(null);
    const results = await Promise.allSettled(
      jobs.filter((j) => j.file.size <= MAX_FILE_BYTES).map(async (j) => {
        const att = await uploadAttachment(boardId, card.id, j.file);
        return { ...att, addedBy: me.id, jobId: j.id };
      }),
    );
    const ok: Attachment[] = [];
    const failed = new Map<string, string>();
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        const { jobId, ...att } = r.value;
        ok.push(att);
        setUploads((u) => u.filter((x) => x.id !== jobId));
      } else failed.set(String(r.reason?.message ?? r.reason), '');
    });
    if (ok.length) dispatch({ type: 'ADD_ATTACHMENTS', cardId: card.id, attachments: ok, autoCover: true });
    if (failed.size) {
      setUploads((u) => u.map((x) => (x.error ? x : { ...x, error: [...failed.keys()].find((m) => m.startsWith(x.name)) ?? 'Upload failed' })));
    }
    // Clear errors after a while.
    setTimeout(() => setUploads((u) => u.filter((x) => !x.error)), 8000);
  };

  useEffect(() => {
    if (ro) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      e.preventDefault();
      void uploadFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `Pasted image ${new Date().toLocaleString().replace(/[/:]/g, '-')}${i ? ' ' + i : ''}.png`, { type: f.type }))));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ro, card.id]);

  const filePaths = pathsOf(card.attachments);
  const urls = useSignedUrls(filePaths);
  const open = async (a: Attachment, download = false) => {
    if (!a.path) {
      const internal = parseCardLink(a.url);
      if (internal && onOpenCardLink) return onOpenCardLink(internal.boardId, internal.cardId);
      return window.open(a.url, '_blank', 'noopener');
    }
    const u = await fileUrl(a.path, download ? a.name : undefined);
    if (u) {
      if (download) window.location.href = u;
      else window.open(u, '_blank', 'noopener');
    }
  };
  const removeAttachment = async (a: Attachment) => {
    if (!(await askConfirm({ title: `Delete ${a.name || 'this attachment'}?`, message: 'The file is removed from this card permanently. This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    dispatch({ type: 'DELETE_ATTACHMENT', cardId: card.id, attachmentId: a.id });
  };

  const update = (patch: Partial<Card>, note?: string) => dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch, note });
  const myRun = runningEntry(card, me.id);
  const [showTime, setShowTime] = useState(false);
  const now = useNow(!!myRun);
  const toggleTimer = () => {
    if (myRun) dispatch({ type: 'TIMER_STOP', cardId: card.id });
    else dispatch({ type: 'TIMER_START', cardId: card.id, entryId: uid() });
    setShowTime(true);
  };
  const listId = cardListId(data, card.id);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const done = card.checklist.filter((i) => i.done).length;
  const pct = card.checklist.length ? Math.round((done / card.checklist.length) * 100) : 0;
  const prio = PRIORITIES.find((p) => p.value === card.priority)!;
  const status = dueStatus(card);
  const cardLabels = card.labelIds.map((id) => data.labels.find((l) => l.id === id)).filter((l): l is (typeof data.labels)[number] => !!l);

  const owners = card.owners ?? [];
  const isOwner = owners.includes(me.id);
  // Owners (and board admins) manage owners and may delete the card.
  // Who may delete: the owner and admins, or (if the board allows) anyone who can edit.
  const canManage = editable && (isOwner || isAdmin || boardSettings(data).deleteCards === 'editors');
  const creator = card.createdBy ? peopleById.get(card.createdBy) : undefined;
  const creatorName = creator?.name ?? (card.createdBy === 'import' || !card.createdBy ? 'Imported' : 'Former member');
  // "Leave card": take yourself off as a member. Ownership (the creator) never changes.
  const onCard = card.assignees.includes(me.id);
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

  // ---- comments
  const submitComment = () => {
    const t = comment.trim();
    if (!t) return;
    dispatch({ type: 'ADD_COMMENT', cardId: card.id, comment: { id: uid(), authorId: me.id, authorName: me.name, text: t, createdAt: Date.now() } });
    setComment('');
    setCommentFocus(false);
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
                      onClick={async () => (await askConfirm({ title: 'Delete this comment?', message: 'The comment is removed for everyone.', confirmLabel: 'Delete', tone: 'danger' })) && dispatch({ type: 'DELETE_COMMENT', cardId: card.id, commentId: c.id })}
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
    const quoted = `“${card.title}”`;
    for (const a of data.activity.filter((x) => x.cardId === card.id && !x.text.startsWith('commented'))) {
      const att = a.attachmentId ? card.attachments.find((x) => x.id === a.attachmentId) : undefined;
      const preview = att?.path && isImage(att) ? urls.get(att.path) : undefined;
      // "attached X to “Card”" reads as "attached X to this card" inside the card, like Trello.
      const text = a.text.split(quoted).join('this card');
      const actor = people.find((p) => p.name === a.by);
      feed.push({
        at: a.at,
        key: a.id,
        node: (
          <div className="feed-item activity-item">
            <Avatar id={actor?.user_id ?? a.by} name={a.by} src={actor?.avatar_url} size={32} />
            <div className="feed-main">
              <div>
                <strong>{a.by}</strong>{' '}
                {att ? (
                  <>
                    attached{' '}
                    <button className="link-btn inline" onClick={() => void open(att)}>
                      {att.name || att.url}
                    </button>{' '}
                    to this card
                  </>
                ) : (
                  text
                )}
              </div>
              <span className="feed-time">{timeAgo(a.at)}</span>
              {preview && (
                <button className="feed-preview" onClick={() => setLightbox(preview)} title="Preview">
                  <img src={preview} alt={att?.name ?? ''} loading="lazy" />
                </button>
              )}
              {att && editable && (
                <div className="feed-actions">
                  <button className="link-btn" onClick={() => reply(a.by, actor?.user_id ?? '')}>
                    Reply
                  </button>
                </div>
              )}
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
                ['time', Timer, 'Time', 'Track or log time spent'],
                ['members', User, 'Members', 'Assign members'],
                ['priority', Flag, 'Priority', 'Urgent, high, medium or low'],
                ['attachment', Paperclip, 'Attachment', 'Upload files or add links'],
                ['location', MapPin, 'Location', 'View this card on a map'],
              ] as const
            ).map(([key, Icon, label, hint]) => (
              <button key={key} className="add-option" onClick={() => (key === 'checklist' ? openChecklist() : key === 'time' ? (setShowTime(true), setPop(null)) : setPop(key))}>
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
            {card.guests.length > 0 && (
              <>
                <h5 className="pop-sub">Imported (not linked to an account)</h5>
                {card.guests.map((g) => (
                  <div key={g} className="member-option guest-row">
                    <Avatar id={'guest:' + g} name={g} size={28} />
                    <span className="member-option-text">{g}</span>
                    <button
                      className="icon-btn guest-remove"
                      title={`Remove ${g} from this card`}
                      aria-label={`Remove ${g} from this card`}
                      onClick={() => update({ guests: card.guests.filter((x) => x !== g) }, `removed ${g} (imported) from {card}`)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </Popover>
        );
      case 'location':
        return (
          <Popover title="Location" onClose={() => setPop(null)}>
            <form
              className="pop-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const q = placeQ.trim();
                if (!q) return;
                setPlaceBusy(true);
                setPlaceErr(null);
                try {
                  setPlaces(await searchPlaces(q));
                } catch (err) {
                  setPlaceErr((err as Error).message);
                }
                setPlaceBusy(false);
              }}
            >
              <label className="pop-field">
                Search for a place or address
                <input autoFocus placeholder="e.g. Rahim Yar Khan, Pakistan" value={placeQ} onChange={(e) => setPlaceQ(e.target.value)} />
              </label>
              <button className="btn primary full" disabled={placeBusy || !placeQ.trim()}>
                {placeBusy ? 'Searching…' : 'Search'}
              </button>
            </form>
            {placeErr && <div className="auth-error">{placeErr}</div>}
            {places && places.length === 0 && <p className="muted">No places found. Try a city or a fuller address.</p>}
            {places?.map((pl) => (
              <button
                key={`${pl.lat},${pl.lng}`}
                className="member-option"
                onClick={() => {
                  update({ location: pl }, `set the location of {card} to ${shortPlace(pl.name)}`);
                  setPop(null);
                  setPlaces(null);
                  setPlaceQ('');
                }}
              >
                <MapPin size={16} />
                <span className="member-option-text">
                  {shortPlace(pl.name)}
                  <span className="muted">{pl.name}</span>
                </span>
              </button>
            ))}
            {card.location && (
              <button className="btn small full" onClick={() => (update({ location: null }), setPop(null))}>
                Remove location
              </button>
            )}
            <p className="muted small-hint">Place search by OpenStreetMap.</p>
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
      case 'attachment': {
        const q = link.url.trim().toLowerCase();
        const looksLikeUrl = /^(https?:\/\/|www\.)|\.[a-z]{2,}(\/|$)/i.test(link.url.trim());
        const recent = recentCards().filter((r) => r.cardId !== card.id);
        const boardMatches = q && !looksLikeUrl
          ? Object.values(data.cards)
              .filter((c) => c.id !== card.id && c.title.toLowerCase().includes(q))
              .slice(0, 6)
              .map((c) => ({ boardId, cardId: c.id, title: c.title, boardTitle, at: 0 }))
          : [];
        const suggestions = q && !looksLikeUrl ? boardMatches : recent.slice(0, 5);
        const insertLink = () => {
          let url = link.url.trim();
          if (!url) return;
          if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
          dispatch({ type: 'ADD_ATTACHMENTS', cardId: card.id, attachments: [{ id: uid(), name: link.name.trim(), url, addedAt: Date.now(), addedBy: me.id }] });
          setLink({ name: '', url: '' });
          setPop(null);
        };
        return (
          <Popover title="Attach" onClose={() => setPop(null)}>
            <div className="attach-pop">
              <strong className="attach-h">Attach a file from your computer</strong>
              <p className="muted center">You can also drag and drop files to upload them.</p>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void uploadFiles([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
              <button className="btn choose-file" onClick={() => fileInput.current?.click()}>
                <Upload size={15} /> Choose a file
              </button>
              <hr />
              <label className="pop-field">
                <span>
                  Search or paste a link <span className="req">*</span>
                </span>
                <input
                  autoFocus
                  placeholder="Find recent links or paste a new link"
                  value={link.url}
                  onChange={(e) => setLink({ ...link, url: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && insertLink()}
                />
              </label>
              <label className="pop-field">
                Display text (optional)
                <input placeholder="Text to display" value={link.name} onChange={(e) => setLink({ ...link, name: e.target.value })} />
                <span className="muted small-hint">Give this link a title or description</span>
              </label>
              {suggestions.length > 0 && (
                <div className="recent-links">
                  <strong className="attach-h left">{q ? 'Cards on this board' : 'Recently viewed'}</strong>
                  {suggestions.map((r) => (
                    <button
                      key={r.cardId}
                      className="recent-link"
                      onClick={() => setLink({ url: cardLink(r.boardId, r.cardId), name: r.title })}
                    >
                      <SquareKanban size={16} />
                      <span>
                        <span className="recent-title">{r.title}</span>
                        <span className="muted">
                          {r.boardTitle}
                          {r.at ? ` · Viewed ${timeAgo(r.at)}` : ''}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="pop-footer">
                <button className="btn ghost" onClick={() => setPop(null)}>
                  Cancel
                </button>
                <button className="btn primary" disabled={!link.url.trim()} onClick={insertLink}>
                  Insert
                </button>
              </div>
            </div>
          </Popover>
        );
      }
      default:
        return null;
    }
  })();

  const showMembers = card.assignees.length > 0 || card.guests.length > 0;
  const showDates = !!(card.start || card.due);

  return (
    <Modal onClose={lightbox ? () => setLightbox(null) : onClose} bare className={`card-window ${dragging ? 'dragging-files' : ''}`}>
      <div
        className="cw-drop"
        onDragEnter={(e) => {
          if (ro || !e.dataTransfer.types.includes('Files')) return;
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (!ro && e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          if (ro || !e.dataTransfer.files.length) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void uploadFiles([...e.dataTransfer.files]);
        }}
      >
      {dragging && (
        <div className="drop-overlay">
          <Upload size={28} />
          <span>Drop files to upload</span>
        </div>
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
          <button className="lightbox-close" aria-label="Close preview">
            <X size={22} />
          </button>
        </div>
      )}
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
              {onCard && (
                <button
                  onClick={() => {
                    setMenu(false);
                    update({ assignees: card.assignees.filter((x) => x !== me.id) }, 'left {card}');
                  }}
                >
                  <LogOut size={16} /> Leave card
                </button>
              )}
              <button
                className="danger-text"
                disabled={!canManage}
                title={canManage ? undefined : 'Only the card owner or a board admin can delete this card (Board settings)'}
                onClick={async () => {
                  setMenu(false);
                  if (!canManage) return;
                  if (await askConfirm({ title: `Delete “${card.title}”?`, message: 'The card, its comments and files are deleted permanently. This cannot be undone.', confirmLabel: 'Delete card', tone: 'danger' })) {
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
        <button className="icon-btn cw-icon cw-close" onClick={onClose} aria-label="Close">
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
          <div className="cw-created">
            Created by{' '}
            {creator && onPersonClick ? (
              <button className="act-link plain" onClick={(e) => onPersonClick(creator, e.currentTarget)}>
                {creator.name}
              </button>
            ) : (
              <strong>{creatorName}</strong>
            )}{' '}
            · {new Date(card.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
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
              <button className={`cw-btn timer-btn ${myRun ? 'running' : ''}`} onClick={toggleTimer} title={myRun ? 'Stop your timer' : 'Start a timer for the time you spend on this card'}>
                {myRun ? <Pause size={16} /> : <Play size={16} />}
                {myRun ? <span className="timer-clock">{formatClock(now - myRun.start)}</span> : 'Start timer'}
              </button>
              <button className={`cw-btn ${pop === 'members' ? 'on' : ''}`} onClick={() => toggle('members')}>
                <User size={16} /> Members
              </button>
              <button className={`cw-btn ${pop === 'attachment' ? 'on' : ''}`} onClick={() => toggle('attachment')}>
                <Paperclip size={16} /> Attachment
              </button>
              <CardAI boardId={boardId} card={card} me={me} editable={editable} dispatch={dispatch} />
              {expenseState?.settings && (
                <button className="cw-btn" onClick={() => setAddingExpense(true)} title="Record money spent on this card (partners only)">
                  <Wallet size={16} /> Expense
                </button>
              )}
              {popover}
            </div>
          )}

          {/* chips row: members / labels / dates / priority */}
          {(owners.length > 0 || showMembers || cardLabels.length > 0 || showDates || card.priority !== 'none' || card.location) && (
            <div className="cw-chips">
              <div className="cw-chip-group">
                <h5>{owners.length > 1 ? 'Owners' : 'Owner'}</h5>
                <div className="cw-chip-row">
                  {owners.map((id) => {
                    const p = peopleById.get(id);
                    return p && onPersonClick ? (
                      <button key={id} className="header-avatar owner-avatar" title={`${p.name} (owner)`} onClick={(e) => onPersonClick(p, e.currentTarget)}>
                        <Avatar id={id} name={p.name} src={p.avatar_url} size={32} />
                      </button>
                    ) : (
                      <span key={id} className="owner-avatar">
                        <Avatar id={id} name={p?.name ?? 'Former member'} src={p?.avatar_url} size={32} />
                      </span>
                    );
                  })}
                  {owners.length === 0 && <span className="muted small-hint">No owner</span>}
                </div>
              </div>
              {showMembers && (
                <div className="cw-chip-group">
                  <h5>Members</h5>
                  <div className="cw-chip-row">
                    {card.assignees.map((id) => {
                      const p = peopleById.get(id);
                      return p && onPersonClick ? (
                        <button key={id} className="header-avatar" title={p.name} onClick={(e) => onPersonClick(p, e.currentTarget)}>
                          <Avatar id={id} name={p.name} src={p.avatar_url} size={32} />
                        </button>
                      ) : (
                        <Avatar key={id} id={id} name={p?.name ?? 'Former member'} src={p?.avatar_url} size={32} />
                      );
                    })}
                    {card.guests.map((g) =>
                      editable ? (
                        <button key={g} className="header-avatar" title={`${g} (imported) — click to remove`} onMouseDown={(e) => e.stopPropagation()} onClick={() => toggle('members')}>
                          <Avatar id={'guest:' + g} name={g} size={32} />
                        </button>
                      ) : (
                        <Avatar key={g} id={'guest:' + g} name={g} size={32} title={`${g} (imported)`} />
                      ),
                    )}
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
              {card.location && (
                <div className="cw-chip-group">
                  <h5>Location</h5>
                  <div className="cw-chip-row">
                    <a className="date-chip" href={osmLink(card.location)} target="_blank" rel="noreferrer noopener" title={card.location.name}>
                      <MapPin size={14} /> {shortPlace(card.location.name)}
                    </a>
                    {editable && (
                      <button className="round-add square" onMouseDown={(e) => e.stopPropagation()} onClick={() => toggle('location')} aria-label="Change location">
                        <Pencil size={14} />
                      </button>
                    )}
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
                <MentionInput
                  multiline
                  autoFocus
                  className="desc-editor"
                  value={desc}
                  onChange={setDesc}
                  people={people}
                  meId={me.id}
                  placeholder="Add a more detailed description… (type @ to mention someone)"
                  onSubmit={() => {
                    if (desc !== card.description) update({ description: desc });
                    setEditingDesc(false);
                  }}
                />
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
          {(card.attachments.length > 0 || uploads.length > 0) && (
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
              {(() => {
                const files = card.attachments.filter((a) => a.path);
                const links = card.attachments.filter((a) => !a.path);
                const row = (a: Attachment) => {
                  const img = a.path && isImage(a) ? urls.get(a.path) : undefined;
                  const internal = !a.path ? parseCardLink(a.url) : null;
                  return (
                    <li key={a.id}>
                      <button
                        className={`attach-thumb ${img ? 'img' : ''}`}
                        style={img ? { backgroundImage: `url("${img}")` } : undefined}
                        onClick={() => (img ? setLightbox(img) : void open(a))}
                        title={img ? 'Preview' : 'Open'}
                      >
                        {!img && (a.path ? <span className="ext">{extOf(a.name)}</span> : internal ? <SquareKanban size={18} /> : <Link2 size={18} />)}
                      </button>
                      <span className="attach-info">
                        <button className="attach-name" onClick={() => void open(a)}>
                          {a.name || a.url}
                        </button>
                        <span className="muted">
                          Added {timeAgo(a.addedAt)}
                          {a.size ? ` · ${formatBytes(a.size)}` : ''}
                          {card.cover === a.id && ' · Cover'}
                        </span>
                      </span>
                      <button className="icon-btn" title="Open" onClick={() => void open(a)}>
                        <ExternalLink size={16} />
                      </button>
                      <span className="menu-anchor">
                        <button className="icon-btn boxed" title="More" onClick={() => setAttMenu(attMenu === a.id ? null : a.id)}>
                          <MoreHorizontal size={16} />
                        </button>
                        <Menu open={attMenu === a.id} onClose={() => setAttMenu(null)}>
                          {a.path && (
                            <button onClick={() => (setAttMenu(null), void open(a, true))}>
                              <Download size={16} /> Download
                            </button>
                          )}
                          {editable && a.path && isImage(a) && (
                            <button
                              onClick={() => {
                                setAttMenu(null);
                                update({ cover: card.cover === a.id ? null : a.id });
                              }}
                            >
                              <ImageIcon size={16} /> {card.cover === a.id ? 'Remove cover' : 'Make cover'}
                            </button>
                          )}
                          {editable && (
                            <button className="danger-text" onClick={() => (setAttMenu(null), removeAttachment(a))}>
                              <Trash2 size={16} /> Delete
                            </button>
                          )}
                        </Menu>
                      </span>
                    </li>
                  );
                };
                return (
                  <div className="cw-indent">
                    {(files.length > 0 || uploads.length > 0) && (
                      <>
                        <h5 className="attach-group">Files</h5>
                        <ul className="attach-list">
                          {files.map(row)}
                          {uploads.map((u) => (
                            <li key={u.id} className={u.error ? 'upload-error' : 'uploading'}>
                              <span className="attach-thumb">{u.error ? '!' : <Loader2 size={18} className="spin" />}</span>
                              <span className="attach-info">
                                <span className="attach-name static">{u.name}</span>
                                <span className={u.error ? 'error-text' : 'muted'}>{u.error ?? 'Uploading…'}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {links.length > 0 && (
                      <>
                        <h5 className="attach-group">Links</h5>
                        <ul className="attach-list">{links.map(row)}</ul>
                      </>
                    )}
                  </div>
                );
              })()}
            </section>
          )}

          {expenseState && (
            <CardExpenses
              boardId={boardId}
              cardId={card.id}
              state={expenseState}
              data={data}
              people={peopleById}
              me={me}
              adding={addingExpense}
              onAddingChange={setAddingExpense}
            />
          )}

          {/* time tracking */}
          {((card.time ?? []).length > 0 || showTime) && (
            <CardTime card={card} me={me} people={people} editable={editable} isAdmin={isAdmin} dispatch={dispatch} />
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
                      <span className={item.done ? 'struck' : ''}>
                        <RichText text={item.text} />
                      </span>
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
                  <MentionInput
                    ref={itemRef}
                    className="grow"
                    value={newItem}
                    onChange={setNewItem}
                    people={people}
                    meId={me.id}
                    placeholder="Add an item… (@ to mention)"
                    onSubmit={() => {
                      const t = newItem.trim();
                      if (!t) return;
                      update({ checklist: [...card.checklist, { id: uid(), text: t, done: false }] });
                      setNewItem('');
                    }}
                  />
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
              <MentionInput
                ref={commentRef}
                multiline
                value={comment}
                onChange={setComment}
                people={people}
                meId={me.id}
                placeholder="Write a comment… (type @ to mention someone)"
                onFocus={() => setCommentFocus(true)}
                onSubmit={submitComment}
              />
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
      </div>
    </Modal>
  );
}
