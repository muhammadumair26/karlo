import {
  Archive,
  Calendar,
  Download,
  FolderPlus,
  Filter,
  History,
  Image,
  Kanban,
  Link2,
  LogOut,
  MoreHorizontal,
  Star,
  Table2,
  Tag,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '../lib/api';
import type { Filters } from '../lib/filters';
import { hasFilters, NO_FILTERS } from '../lib/filters';
import type { BoardActionBody } from '../lib/board';
import { boardToCSV, karloExport } from '../lib/importers';
import { deleteFiles, pathsOf } from '../lib/files';
import { notificationsFor, sendNotifications } from '../lib/notify';
import type { BoardMeta, Me, Person } from '../lib/types';
import { BACKGROUND_PHOTOS, BOARD_COLORS, canAdmin, canEdit, photoUrl, PRIORITIES, ROLE_INFO } from '../lib/types';
import { useBoardSync, type SyncStatus } from '../lib/useBoardSync';
import { CalendarView } from './CalendarView';
import { CardModal } from './CardModal';
import { EditableText } from './Editable';
import { KanbanView } from './KanbanView';
import { LabelsEditor } from './LabelsEditor';
import { MembersPanel } from './MembersPanel';
import { TableView } from './TableView';
import { Avatar, AvatarStack, download, Menu, Modal, timeAgo } from './ui';

type View = 'board' | 'table' | 'calendar';

const STATUS_TEXT: Record<SyncStatus, string> = {
  loading: 'Loading…',
  saving: 'Saving…',
  saved: '✓ Saved',
  offline: '⚠ Offline – retrying',
  error: 'Error',
};

const VIEW_KEY = 'karlo-view';

export function BoardPage({
  meta,
  me,
  starred,
  onToggleStar,
  openCardRequest,
  onBoardGone,
  onMetaChanged,
  onNewWorkspace,
  onImport,
  onExportAll,
  switcher,
}: {
  /** Board switcher button, rendered at the start of the header. */
  switcher?: React.ReactNode;
  onNewWorkspace: () => void;
  onImport: () => void;
  onExportAll: () => void;
  /** Open this card once the board has loaded (from notifications or search). */
  openCardRequest?: { cardId: string; nonce: number } | null;
  meta: BoardMeta;
  me: Me;
  starred: boolean;
  onToggleStar: () => void;
  onBoardGone: () => void;
  onMetaChanged: () => void;
}) {
  const { data, status, loadError, dispatch: applyAction } = useBoardSync(meta.id, me);
  const [rawPeople, setPeople] = useState<Person[]>([]);
  // Always show my latest name/photo, even before the people list is reloaded.
  const people = useMemo(
    () => rawPeople.map((p) => (p.user_id === me.id ? { ...p, name: me.name, avatar_url: me.avatar_url, title: me.title } : p)),
    [rawPeople, me.id, me.name, me.avatar_url, me.title],
  );
  const dataRef = useRef(data);
  dataRef.current = data;
  const peopleRef = useRef(people);
  peopleRef.current = people;

  /** Apply a change, then notify the people it concerns (mentions, card members, newly added). */
  const dispatch = useCallback(
    (b: BoardActionBody) => {
      const before = dataRef.current;
      applyAction(b);
      if (!before) return;
      void sendNotifications(notificationsFor(before, b, me, peopleRef.current, meta.id));
      // Free storage for uploaded files that are no longer referenced.
      if (b.type === 'DELETE_ATTACHMENT') {
        void deleteFiles(pathsOf(before.cards[b.cardId]?.attachments.filter((x) => x.id === b.attachmentId) ?? []));
      } else if (b.type === 'DELETE_CARD') {
        void deleteFiles(pathsOf(before.cards[b.cardId]?.attachments ?? []));
      } else if (b.type === 'DELETE_LIST') {
        const ids = before.lists[b.listId]?.cardIds ?? [];
        void deleteFiles(ids.flatMap((id) => pathsOf(before.cards[id]?.attachments ?? [])));
      }
    },
    [applyAction, me, meta.id],
  );
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as View) || 'board';
    } catch {
      return 'board';
    }
  });
  const [panel, setPanel] = useState<null | 'share' | 'labels' | 'archive' | 'activity' | 'background' | 'guests'>(null);
  const [customBg, setCustomBg] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const editable = canEdit(meta.role);
  const admin = canAdmin(meta.role);

  const loadPeople = useCallback(() => {
    api.boardPeople(meta.id).then(setPeople).catch(() => {});
  }, [meta.id]);
  useEffect(loadPeople, [loadPeople, me.name, me.avatar_url]);
  // Pick up teammates' new photos/names: when the tab regains focus and once a minute.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && loadPeople();
    document.addEventListener('visibilitychange', onVisible);
    const t = window.setInterval(loadPeople, 60000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(t);
    };
  }, [loadPeople]);
  useEffect(() => {
    if (openCardRequest && data?.cards[openCardRequest.cardId]) setOpenCardId(openCardRequest.cardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCardRequest?.nonce, !!data]);
  useEffect(() => {
    setOpenCardId(null);
    setFilters(NO_FILTERS);
  }, [meta.id]);

  const peopleMap = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const setViewSaved = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const closeCard = useCallback(() => setOpenCardId(null), []);
  const closePanel = useCallback(() => {
    setPanel(null);
    loadPeople();
  }, [loadPeople]);

  if (loadError) {
    return (
      <div className="empty">
        <h2>{loadError}</h2>
        <button className="btn translucent" onClick={onBoardGone}>
          Go back
        </button>
      </div>
    );
  }

  const openCard = openCardId && data ? data.cards[openCardId] : null;
  const archivedCards = data ? Object.values(data.cards).filter((c) => c.archived) : [];
  const archivedLists = data ? data.listOrder.map((id) => data.lists[id]).filter((l) => l.archived) : [];

  const guestNames = data ? [...new Set(Object.values(data.cards).flatMap((c) => c.guests))].sort() : [];
  const guestCount = (name: string) => (data ? Object.values(data.cards).filter((c) => c.guests.includes(name)).length : 0);
  const background = data?.background ?? null;

  const exportJSON = () =>
    data && download(`${meta.title}.karlo.json`, karloExport([{ title: meta.title, color: meta.color, data }]));
  const exportCSV = () => data && download(`${meta.title}.csv`, boardToCSV(data, peopleMap), 'text/csv');

  return (
    <>
      {/* Rendered at the app root (behind the top bar and sidebar), not inside the board area. */}
      {background &&
        createPortal(
          <div className="board-bg" style={{ backgroundImage: `url("${photoUrl(background)}")` }} />,
          document.body,
        )}
      <div className={`board-header ${background ? 'on-photo' : ''}`}>
        {switcher}
        {editable ? (
          <EditableText
            className="board-title"
            value={meta.title}
            onSave={async (title) => {
              await api.updateBoardMeta(meta.id, { title });
              onMetaChanged();
            }}
          />
        ) : (
          <span className="board-title">{meta.title}</span>
        )}
        <button className={`icon-btn light star ${starred ? 'on' : ''}`} title={starred ? 'Unstar board' : 'Star board'} onClick={onToggleStar}>
          <Star size={17} fill={starred ? 'currentColor' : 'none'} />
        </button>
        {meta.role !== 'member' && <span className={`role-pill role-${meta.role} on-dark`}>{ROLE_INFO[meta.role].label}</span>}

        <div className="seg on-dark">
          {(['board', 'table', 'calendar'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setViewSaved(v)}>
              {v === 'board' ? <Kanban size={15} /> : v === 'table' ? <Table2 size={15} /> : <Calendar size={15} />}
              {v === 'board' ? 'Board' : v === 'table' ? 'Table' : 'Calendar'}
            </button>
          ))}
        </div>

        <button className={`btn translucent ${hasFilters(filters) ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)}>
          <Filter size={15} /> Filter{hasFilters(filters) ? ' •' : ''}
        </button>

        <span className="header-spacer" />
        <span className={`sync-status sync-${status}`}>{STATUS_TEXT[status]}</span>
        <button className="people-btn" onClick={() => setPanel('share')} title="Members">
          <AvatarStack ids={people.map((p) => p.user_id)} people={peopleMap} max={4} size={28} />
        </button>
        <button className="btn translucent" onClick={() => setPanel('share')}>
          <UserPlus size={16} /> Share
        </button>
        <span className="menu-anchor">
          <button className="btn translucent" onClick={() => setMenuOpen(!menuOpen)} aria-label="Board menu">
            <MoreHorizontal size={18} />
          </button>
          <Menu open={menuOpen} onClose={() => setMenuOpen(false)}>
            {editable && (
              <div className="menu-colors">
                {BOARD_COLORS.map((c) => (
                  <button
                    key={c}
                    style={{ background: c }}
                    className={c === meta.color ? 'on' : ''}
                    aria-label={`Board color ${c}`}
                    onClick={async () => {
                      await api.updateBoardMeta(meta.id, { color: c });
                      onMetaChanged();
                    }}
                  />
                ))}
              </div>
            )}
            {editable && <button onClick={() => (setMenuOpen(false), setPanel('background'))}><Image size={16} /> Change background</button>}
            {editable && <button onClick={() => (setMenuOpen(false), setPanel('labels'))}><Tag size={16} /> Labels</button>}
            {editable && guestNames.length > 0 && (
              <button onClick={() => (setMenuOpen(false), setPanel('guests'))}><Link2 size={16} /> Link imported people ({guestNames.length})</button>
            )}
            <button onClick={() => (setMenuOpen(false), setPanel('activity'))}><History size={16} /> Activity</button>
            <button onClick={() => (setMenuOpen(false), setPanel('archive'))}>
              <Archive size={16} /> Archived items ({archivedCards.length + archivedLists.length})
            </button>
            <hr />
            <button onClick={() => (setMenuOpen(false), onNewWorkspace())}>
              <FolderPlus size={16} /> New workspace
            </button>
            <button onClick={() => (setMenuOpen(false), onImport())}>
              <Upload size={16} /> Import (Trello, ClickUp, CSV)
            </button>
            <button onClick={() => (setMenuOpen(false), onExportAll())}>
              <Download size={16} /> Export all boards
            </button>
            <hr />
            <button onClick={() => (setMenuOpen(false), exportJSON())}><Download size={16} /> Export board (JSON)</button>
            <button onClick={() => (setMenuOpen(false), exportCSV())}><Download size={16} /> Export cards (CSV / Excel)</button>
            <hr />
            {admin ? (
              <button
                className="danger-text"
                onClick={async () => {
                  setMenuOpen(false);
                  if (!confirm(`Delete board "${meta.title}" for everyone? This cannot be undone.`)) return;
                  await api.deleteBoard(meta.id);
                  onBoardGone();
                }}
              >
                <Trash2 size={16} /> Delete board
              </button>
            ) : (
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  if (!confirm('Leave this board?')) return;
                  await api.leaveBoard(meta.id, me.id);
                  onBoardGone();
                }}
              >
                <LogOut size={16} /> Leave board
              </button>
            )}
          </Menu>
        </span>
      </div>

      {showFilters && data && (
        <div className="filter-bar">
          <input
            className="text-input"
            placeholder="Search cards…"
            value={filters.text}
            onChange={(e) => setFilters({ ...filters, text: e.target.value })}
          />
          <select value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })}>
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
            {people.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={filters.labelId} onChange={(e) => setFilters({ ...filters, labelId: e.target.value })}>
            <option value="">Any label</option>
            {data.labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || l.color}
              </option>
            ))}
          </select>
          <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value as Filters['priority'] })}>
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select value={filters.due} onChange={(e) => setFilters({ ...filters, due: e.target.value as Filters['due'] })}>
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="week">Due in next 7 days</option>
            <option value="done">Completed</option>
            <option value="none">No due date</option>
          </select>
          {hasFilters(filters) && (
            <button className="btn translucent" onClick={() => setFilters(NO_FILTERS)}>
              Clear
            </button>
          )}
        </div>
      )}

      {!data ? (
        <div className="empty">
          <p>Loading board…</p>
        </div>
      ) : view === 'board' ? (
        <KanbanView boardId={meta.id} data={data} dispatch={dispatch} editable={editable} filters={filters} meId={me.id} people={peopleMap} onOpenCard={setOpenCardId} />
      ) : view === 'table' ? (
        <TableView data={data} dispatch={dispatch} editable={editable} filters={filters} meId={me.id} people={peopleMap} onOpenCard={setOpenCardId} />
      ) : (
        <CalendarView data={data} filters={filters} meId={me.id} onOpenCard={setOpenCardId} />
      )}

      {openCard && data && (
        <CardModal
          key={openCard.id}
          boardId={meta.id}
          boardTitle={meta.title}
          onOpenCardLink={(b, c) => {
            if (b === meta.id) setOpenCardId(c);
            else window.dispatchEvent(new CustomEvent('karlo:open', { detail: { boardId: b, cardId: c } }));
          }}
          card={openCard}
          data={data}
          people={people}
          me={me}
          editable={editable}
          dispatch={dispatch}
          onClose={closeCard}
        />
      )}

      {panel === 'share' && (
        <Modal title={`Share “${meta.title}”`} onClose={closePanel}>
          <p className="muted">
            Invite people to just this board. Members of the workspace already have access through their workspace role.
          </p>
          <MembersPanel target={{ boardId: meta.id }} me={me} canManage={admin} onChanged={loadPeople} />
        </Modal>
      )}

      {panel === 'background' && data && (
        <Modal title="Board background" onClose={closePanel}>
          <h4>Photos</h4>
          <div className="bg-grid">
            {BACKGROUND_PHOTOS.map((u) => (
              <button
                key={u}
                className={`bg-thumb ${background === u ? 'on' : ''}`}
                style={{ backgroundImage: `url("${photoUrl(u, 320)}")` }}
                onClick={() => dispatch({ type: 'SET_BACKGROUND', url: u })}
                aria-label="Use this photo"
              />
            ))}
          </div>
          <h4>Colors</h4>
          <div className="bg-grid colors">
            {BOARD_COLORS.map((c) => (
              <button
                key={c}
                className={`bg-thumb ${!background && meta.color === c ? 'on' : ''}`}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                onClick={async () => {
                  if (background) dispatch({ type: 'SET_BACKGROUND', url: null });
                  await api.updateBoardMeta(meta.id, { color: c });
                  onMetaChanged();
                }}
              />
            ))}
          </div>
          <h4>Your own image</h4>
          <form
            className="checklist-add"
            onSubmit={(e) => {
              e.preventDefault();
              const u = customBg.trim();
              if (/^https:\/\//i.test(u)) {
                dispatch({ type: 'SET_BACKGROUND', url: u });
                setCustomBg('');
              }
            }}
          >
            <input placeholder="Paste an image link (https://…)" value={customBg} onChange={(e) => setCustomBg(e.target.value)} />
            <button className="btn">Use</button>
          </form>
          {background && (
            <button className="btn ghost" onClick={() => dispatch({ type: 'SET_BACKGROUND', url: null })}>
              Remove photo
            </button>
          )}
          <p className="muted">Photos from Unsplash. The background is shared with everyone on this board.</p>
        </Modal>
      )}

      {panel === 'guests' && data && (
        <Modal title="Link imported people" onClose={closePanel}>
          <p className="muted">
            These names came from Trello/ClickUp. Link each one to a Karlo teammate to turn them into real assignees on every card,
            or remove the name. Invite people first (Share) if they're not in the list.
          </p>
          <ul className="people">
            {guestNames.map((name) => (
              <li key={name}>
                <Avatar id={'guest:' + name} name={name} size={32} />
                <div className="person-info">
                  <div className="person-name">{name}</div>
                  <div className="muted">on {guestCount(name)} card(s)</div>
                </div>
                <select
                  className="role-select"
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    dispatch({ type: 'MAP_GUEST', name, userId: v === '__remove' ? null : v });
                  }}
                >
                  <option value="">Link to…</option>
                  {people.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.name} ({p.email})
                    </option>
                  ))}
                  <option value="__remove">Remove this name</option>
                </select>
              </li>
            ))}
            {guestNames.length === 0 && <li className="muted">All imported people are linked. 🎉</li>}
          </ul>
        </Modal>
      )}

      {panel === 'labels' && data && (
        <Modal title="Board labels" onClose={closePanel}>
          <LabelsEditor labels={data.labels} onChange={(labels) => dispatch({ type: 'SET_LABELS', labels })} />
        </Modal>
      )}

      {panel === 'activity' && data && (
        <Modal title="Activity" onClose={closePanel}>
          <ul className="activity">
            {data.activity.map((a) => (
              <li key={a.id}>
                <strong>{a.by}</strong>{' '}
                {a.cardId && data.cards[a.cardId] ? (
                  <button className="link-btn" onClick={() => (setPanel(null), setOpenCardId(a.cardId!))}>
                    {a.text}
                  </button>
                ) : (
                  a.text
                )}{' '}
                <span className="muted">· {timeAgo(a.at)}</span>
              </li>
            ))}
            {data.activity.length === 0 && <li className="muted">No activity yet.</li>}
          </ul>
        </Modal>
      )}

      {panel === 'archive' && data && (
        <Modal title="Archived items" onClose={closePanel}>
          <h4>Lists</h4>
          <ul className="archive-list">
            {archivedLists.map((l) => (
              <li key={l.id}>
                <span>{l.title}</span>
                {editable && (
                  <>
                    <button className="btn small" onClick={() => dispatch({ type: 'ARCHIVE_LIST', listId: l.id, archived: false })}>
                      Restore
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() => confirm(`Delete list "${l.title}" permanently?`) && dispatch({ type: 'DELETE_LIST', listId: l.id })}
                    >
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
            {archivedLists.length === 0 && <li className="muted">No archived lists.</li>}
          </ul>
          <h4>Cards</h4>
          <ul className="archive-list">
            {archivedCards.map((c) => (
              <li key={c.id}>
                <button className="link-btn" onClick={() => (setPanel(null), setOpenCardId(c.id))}>
                  {c.title}
                </button>
                {editable && (
                  <>
                    <button className="btn small" onClick={() => dispatch({ type: 'UPDATE_CARD', cardId: c.id, patch: { archived: false }, note: 'restored {card}' })}>
                      Restore
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() => confirm(`Delete "${c.title}" permanently?`) && dispatch({ type: 'DELETE_CARD', cardId: c.id })}
                    >
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
            {archivedCards.length === 0 && <li className="muted">No archived cards.</li>}
          </ul>
        </Modal>
      )}
    </>
  );
}
