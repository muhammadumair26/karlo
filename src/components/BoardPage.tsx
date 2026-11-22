import {
  Archive,
  Calendar,
  Download,
  FolderPlus,
  Gauge,
  GanttChart,
  MapPin,
  ChevronDown,
  Filter,
  History,
  Image,
  Kanban,
  Timer,
  LayoutGrid,
  Link2,
  LogOut,
  MoreHorizontal,
  Star,
  Table2,
  Tag,
  Trash2,
  Upload,
  UserPlus,
  Wallet,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '../lib/api';
import type { Filters } from '../lib/filters';
import { hasFilters, NO_FILTERS } from '../lib/filters';
import { boardReducer, type BoardAction, type BoardActionBody } from '../lib/board';
import { boardToCSV, karloExport } from '../lib/importers';
import { deleteFiles, pathsOf } from '../lib/files';
import { markRead, newMentionAssignees, joinsOnEdit, notificationsFor, sendNotifications, type NotificationRow } from '../lib/notify';
import type { BoardMeta, Me, Person } from '../lib/types';
import { BACKGROUND_PHOTOS, DUBAI_PHOTOS, BOARD_COLORS, canAdmin, canEdit, photoUrl, PRIORITIES, ROLE_INFO, boardSettings } from '../lib/types';
import { useBoardSync, type SyncStatus } from '../lib/useBoardSync';
import { CalendarView } from './CalendarView';
import { DashboardView } from './DashboardView';
import { MapView } from './MapView';
import { TimelineView } from './TimelineView';
import { CardModal } from './CardModal';
import { EditableText } from './Editable';
import { KanbanView } from './KanbanView';
import { TimeView } from './TimeView';
import { LabelsEditor } from './LabelsEditor';
import { FieldsEditor } from './CustomFields';
import { MembersPanel } from './MembersPanel';
import { TableView } from './TableView';
import { BoardSettingsModal } from './BoardSettings';
import { AutomationModal } from './AutomationModal';
import { automationFollowUps, sendWebhooks } from '../lib/automation';
import { publicOrigin } from '../lib/platform';
import { DuePrompt } from './DuePrompt';
import { VoiceAssistant } from './VoiceAssistant';
import { RunningTimer } from './CardTime';
import { ViewsCustomizer } from './ViewsCustomizer';
import { arrange, usePrefs } from '../lib/prefs';
import { ExpensesView } from './ExpensesView';
import { useExpenses } from '../lib/expenses';
import { ActivityFeed } from './ActivityFeed';
import { MemberCard, type MemberCardTarget } from './MemberCard';
import { handleOf } from '../lib/notify';
import { Avatar, download, Menu, Modal } from './ui';
import { askConfirm } from './dialog';

type View = 'board' | 'table' | 'calendar' | 'dashboard' | 'timeline' | 'map' | 'expenses' | 'time';

const VIEWS: { id: View; label: string; Icon: typeof Kanban }[] = [
  { id: 'board', label: 'Board', Icon: Kanban },
  { id: 'table', label: 'Table', Icon: Table2 },
  { id: 'calendar', label: 'Calendar', Icon: Calendar },
  { id: 'dashboard', label: 'Dashboard', Icon: Gauge },
  { id: 'timeline', label: 'Timeline', Icon: GanttChart },
  { id: 'map', label: 'Map', Icon: MapPin },
  { id: 'time', label: 'Time', Icon: Timer },
  { id: 'expenses', label: 'Finance', Icon: Wallet },
];

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

  // A card without a due date moving into a list that requires one waits here for a date.
  const [pendingMove, setPendingMove] = useState<Extract<BoardActionBody, { type: 'MOVE_CARD' }> | null>(null);
  const allowMove = useRef<string | null>(null);

  /** Apply a change, then notify the people it concerns (mentions, card members, newly added). */
  const dispatch = useCallback(
    (b: BoardActionBody) => {
      const before = dataRef.current;
      if (before && b.type === 'MOVE_CARD' && allowMove.current !== b.cardId) {
        const to = before.lists[b.toListId];
        const card = before.cards[b.cardId];
        const from = Object.values(before.lists).find((l) => l.cardIds.includes(b.cardId));
        if (to?.requireDue && card && !card.due && from?.id !== to.id) {
          setPendingMove(b);
          return;
        }
      }
      allowMove.current = null;
      applyAction(b);
      if (!before) return;
      void sendNotifications(notificationsFor(before, b, me, peopleRef.current, meta.id));
      // Board automations ("when a card … then …") run as follow-up changes by the same person.
      if (before.automations?.some((r) => r.on)) {
        const after = boardReducer(before, { ...b, meta: { id: 'auto', at: Date.now(), by: { id: me.id, name: me.name } } } as BoardAction);
        const ppl = peopleRef.current;
        const follow = automationFollowUps(before, after, b, new Date(), {
          by: { id: me.id, name: me.name },
          boardId: meta.id,
          boardTitle: meta.title,
          personName: (id) => ppl.find((p) => p.user_id === id)?.name ?? 'someone',
          origin: publicOrigin(),
        });
        if (follow.webhooks.length) void sendWebhooks(follow.webhooks);
        let state = after;
        for (const f of follow.actions) {
          applyAction(f);
          void sendNotifications(notificationsFor(state, f, me, peopleRef.current, meta.id));
          state = boardReducer(state, { ...f, meta: { id: 'auto', at: Date.now(), by: { id: me.id, name: me.name } } } as BoardAction);
        }
        for (const n of follow.notify) {
          const card = state.cards[n.cardId];
          const listId = card ? Object.values(state.lists).find((l) => l.cardIds.includes(card.id))?.id : undefined;
          void sendNotifications(
            [...new Set(n.userIds)]
              .filter((id) => id !== me.id && peopleRef.current.some((p) => p.user_id === id))
              .map((user_id) => ({ user_id, board_id: meta.id, card_id: n.cardId, kind: 'automation' as const, card_title: card?.title ?? '', list_title: listId ? state.lists[listId].title : '', body: n.body })),
          );
        }
      }
      // @mentioning someone on a card makes them responsible: add them as a member.
      // (They already get the "mentioned you" notification, so no extra "added you" one.)
      const assign = boardSettings(before).mentionAssigns ? newMentionAssignees(before, b, peopleRef.current) : [];
      // Board setting: changing a card you don't own makes you a member of it.
      const joined = joinsOnEdit(before, b, me.id) && !assign.includes(me.id);
      if ((assign.length || joined) && 'cardId' in b) {
        const card = before.cards[b.cardId];
        const names = assign.map((id) => peopleRef.current.find((p) => p.user_id === id)?.name ?? 'someone').join(', ');
        const base = b.type === 'UPDATE_CARD' && b.patch.assignees ? b.patch.assignees : card.assignees;
        const note = assign.length ? `added ${names} to {card} (mentioned)${joined ? ' and joined it' : ''}` : 'joined {card}';
        applyAction({ type: 'UPDATE_CARD', cardId: b.cardId, patch: { assignees: [...base, ...assign, ...(joined ? [me.id] : [])] }, note });
      }
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
    [applyAction, me, meta.id, meta.title],
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
  const [panel, setPanel] = useState<null | 'share' | 'labels' | 'archive' | 'activity' | 'background' | 'guests' | 'settings' | 'automation' | 'fields'>(null);
  const [memberTarget, setMemberTarget] = useState<MemberCardTarget | null>(null);
  // My unread notifications on this board, per card (red bell badge on the card, like Trello).
  const [unreadByCard, setUnreadByCard] = useState<Map<string, string[]>>(new Map());
  const [profileOf, setProfileOf] = useState<Person | null>(null);
  const [activityBy, setActivityBy] = useState<string | null>(null);
  const openMember = (person: Person, el: HTMLElement) => setMemberTarget({ person, rect: el.getBoundingClientRect() });
  const [customBg, setCustomBg] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
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
    const onNotifs = (e: Event) => {
      const rows = (e as CustomEvent<NotificationRow[]>).detail ?? [];
      const m = new Map<string, string[]>();
      for (const n of rows) if (n.board_id === meta.id && n.card_id && !n.read_at) m.set(n.card_id, [...(m.get(n.card_id) ?? []), n.id]);
      setUnreadByCard(m);
    };
    window.addEventListener('karlo:notifs', onNotifs);
    window.dispatchEvent(new CustomEvent('karlo:notifs-refresh'));
    return () => window.removeEventListener('karlo:notifs', onNotifs);
  }, [meta.id]);
  // Opening a card reads its notifications.
  useEffect(() => {
    const ids = openCardId ? unreadByCard.get(openCardId) : undefined;
    if (!ids?.length) return;
    setUnreadByCard((m) => {
      const next = new Map(m);
      next.delete(openCardId!);
      return next;
    });
    void markRead(ids).then(() => window.dispatchEvent(new CustomEvent('karlo:notifs-refresh')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCardId, unreadByCard]);
  useEffect(() => {
    if (openCardRequest && data?.cards[openCardRequest.cardId]) setOpenCardId(openCardRequest.cardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCardRequest?.nonce, !!data]);
  useEffect(() => {
    setOpenCardId(null);
    setFilters(NO_FILTERS);
  }, [meta.id]);

  const peopleMap = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  // "✓ Saved" only shows briefly after a save; problems (offline/error) stay visible.
  const [savedFaded, setSavedFaded] = useState(true);
  useEffect(() => {
    if (status !== 'saved') {
      setSavedFaded(false);
      return;
    }
    const t = setTimeout(() => setSavedFaded(true), 2000);
    return () => clearTimeout(t);
  }, [status]);
  // Project expenses: only the partners get data back; the owner may set them up.
  const expenseState = useExpenses(meta.id);
  const isOwner = meta.role === 'owner';
  const canSeeExpenses = expenseState.allowed || isOwner;
  const prefs = usePrefs();
  const [customizeViews, setCustomizeViews] = useState(false);
  const views = arrange(VIEWS, prefs.viewOrder, prefs.hiddenViews).filter((v) => v.id !== 'expenses' || canSeeExpenses);
  const baseView: View = view === 'expenses' && expenseState.loaded && !canSeeExpenses ? 'board' : view;
  // A view you've hidden falls back to your first visible one.
  const shownView: View = views.some((v) => v.id === baseView) || !views.length ? baseView : (views[0].id as View);
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
        {meta.role !== 'member' && <span className={`role-pill role-${meta.role} on-dark hide-phone`}>{ROLE_INFO[meta.role].label}</span>}

        <span className="menu-anchor hide-phone">
          {(() => {
            const cur = views.find((v) => v.id === shownView) ?? views[0];
            return (
              <button className="btn translucent views-btn" onClick={() => setViewsOpen(!viewsOpen)} title="Views">
                <cur.Icon size={16} /> {cur.label} <ChevronDown size={14} />
              </button>
            );
          })()}
          <Menu open={viewsOpen} onClose={() => setViewsOpen(false)} align="left">
            <div className="menu-title">Views</div>
            {views.map((v) => (
              <button key={v.id} className={shownView === v.id ? 'menu-on' : ''} onClick={() => (setViewsOpen(false), setViewSaved(v.id))}>
                <v.Icon size={17} /> {v.label}
              </button>
            ))}
            <hr />
            <button className="menu-subtle" onClick={() => (setViewsOpen(false), setCustomizeViews(true))}>
              <SlidersHorizontal size={15} /> Customize views…
            </button>
          </Menu>
        </span>

        {shownView !== 'expenses' && (
        <button className={`btn translucent hide-phone ${hasFilters(filters) ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)}>
          <Filter size={15} /> Filter{hasFilters(filters) ? ' •' : ''}
        </button>
        )}

        <span className="header-spacer" />
        <span className={`sync-status sync-${status} ${status === 'saved' && savedFaded ? 'faded' : ''}`} aria-live="polite">{STATUS_TEXT[status]}</span>
        <span className="header-people hide-phone">
          {people.slice(0, 5).map((p) => (
            <button key={p.user_id} className="header-avatar" title={p.name} onClick={(e) => openMember(p, e.currentTarget)}>
              <Avatar id={p.user_id} name={p.name} src={p.avatar_url} size={30} />
            </button>
          ))}
          {people.length > 5 && (
            <button className="header-avatar more" onClick={() => setPanel('share')} title="All members">
              +{people.length - 5}
            </button>
          )}
        </span>
        {switcher}
        <button className="btn translucent hide-phone" onClick={() => setPanel('share')}>
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
            {editable && <button onClick={() => (setMenuOpen(false), setPanel('fields'))}><SlidersHorizontal size={16} /> Custom fields</button>}
            {editable && guestNames.length > 0 && (
              <button onClick={() => (setMenuOpen(false), setPanel('guests'))}><Link2 size={16} /> Link imported people ({guestNames.length})</button>
            )}
            <button onClick={() => (setMenuOpen(false), setPanel('settings'))}><SlidersHorizontal size={16} /> Board settings</button>
            <button onClick={() => (setMenuOpen(false), setPanel('automation'))}><Zap size={16} /> Automation{data?.automations?.some((r) => r.on) ? ` (${data.automations.filter((r) => r.on).length})` : ''}</button>
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
                  if (!(await askConfirm({ title: `Delete “${meta.title}”?`, message: 'The board, its cards and files are deleted for everyone. This cannot be undone.', confirmLabel: 'Delete board', tone: 'danger' }))) return;
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
                  if (!(await askConfirm({ title: `Leave “${meta.title}”?`, message: "You'll lose access until someone invites you again.", confirmLabel: 'Leave board', tone: 'danger' }))) return;
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

      {/* Phone only: Trello-style bottom bar (hidden on wider screens via CSS). */}
      <nav className="phone-bar" aria-label="Board actions">
        <span className="menu-anchor">
          {(() => {
            const cur = views.find((v) => v.id === shownView) ?? views[0];
            return (
              <button className={viewsOpen ? 'on' : ''} onClick={() => setViewsOpen(!viewsOpen)}>
                <cur.Icon size={20} />
                <span>
                  {cur.label} <ChevronDown size={12} />
                </span>
              </button>
            );
          })()}
          <Menu open={viewsOpen} onClose={() => setViewsOpen(false)} align="up">
            <div className="menu-title">Views</div>
            {views.map((v) => (
              <button key={v.id} className={shownView === v.id ? 'menu-on' : ''} onClick={() => (setViewsOpen(false), setViewSaved(v.id))}>
                <v.Icon size={17} /> {v.label}
              </button>
            ))}
            <hr />
            <button className="menu-subtle" onClick={() => (setViewsOpen(false), setCustomizeViews(true))}>
              <SlidersHorizontal size={15} /> Customize views…
            </button>
          </Menu>
        </span>
        {shownView !== 'expenses' && (
        <button className={showFilters || hasFilters(filters) ? 'on' : ''} onClick={() => setShowFilters(!showFilters)}>
          <Filter size={20} />
          <span>Filter{hasFilters(filters) ? ' •' : ''}</span>
        </button>
        )}
        <button onClick={() => setPanel('share')}>
          <UserPlus size={20} />
          <span>Share</span>
        </button>
        <button onClick={() => window.dispatchEvent(new CustomEvent('karlo:switch-boards'))}>
          <LayoutGrid size={20} />
          <span>Boards</span>
        </button>
      </nav>

      {showFilters && data && shownView !== 'expenses' && (
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
            <option value="owned">Created / owned by me</option>
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
      ) : shownView === 'board' ? (
        <KanbanView unreadByCard={unreadByCard} boardId={meta.id} data={data} dispatch={dispatch} editable={editable} admin={admin} filters={filters} meId={me.id} people={peopleMap} onOpenCard={setOpenCardId} />
      ) : shownView === 'table' ? (
        <TableView data={data} dispatch={dispatch} editable={editable} admin={admin} filters={filters} meId={me.id} people={peopleMap} onOpenCard={setOpenCardId} />
      ) : shownView === 'calendar' ? (
        <CalendarView data={data} filters={filters} meId={me.id} onOpenCard={setOpenCardId} />
      ) : shownView === 'dashboard' ? (
        <DashboardView
          data={data}
          dispatch={dispatch}
          editable={editable}
          filters={filters}
          meId={me.id}
          people={peopleMap}
          onFilter={(patch) => {
            setFilters({ ...filters, ...patch });
            setShowFilters(true);
          }}
        />
      ) : shownView === 'timeline' ? (
        <TimelineView data={data} dispatch={dispatch} editable={editable} filters={filters} meId={me.id} people={peopleMap} onOpenCard={setOpenCardId} />
      ) : shownView === 'time' ? (
        <TimeView data={data} people={peopleMap} meId={me.id} onOpenCard={setOpenCardId} />
      ) : shownView === 'expenses' ? (
        <ExpensesView boardId={meta.id} boardTitle={meta.title} isOwner={isOwner} state={expenseState} data={data} people={peopleMap} me={me} onOpenCard={setOpenCardId} />
      ) : (
        <MapView data={data} filters={filters} meId={me.id} onOpenCard={setOpenCardId} />
      )}

      {openCard && data && (
        <CardModal
          key={openCard.id}
          isAdmin={admin}
          expenseState={expenseState.allowed ? expenseState : undefined}
          onPersonClick={(person, el) => openMember(person, el)}
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
          <h4>Dubai</h4>
          <div className="bg-grid">
            {DUBAI_PHOTOS.map((u) => (
              <button
                key={u}
                className={`bg-thumb ${background === u ? 'on' : ''}`}
                style={{ backgroundImage: `url("${photoUrl(u, 320)}")` }}
                onClick={() => dispatch({ type: 'SET_BACKGROUND', url: u })}
                aria-label="Use this Dubai photo"
              />
            ))}
          </div>
          <h4>Nature & cities</h4>
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

      {data && (
        <RunningTimer
          cards={Object.values(data.cards)}
          meId={me.id}
          hideCardId={openCardId}
          onOpen={setOpenCardId}
          onStop={(cardId) => dispatch({ type: 'TIMER_STOP', cardId })}
        />
      )}
      {data && (
        <VoiceAssistant
          boardId={meta.id}
          data={data}
          people={people.filter((p) => p.role !== 'viewer')}
          me={me}
          canAddCards={editable && (boardSettings(data).addCards === 'editors' || admin)}
          money={expenseState.allowed ? expenseState.settings : null}
          dispatch={dispatch}
          onOpenCard={setOpenCardId}
        />
      )}
      {customizeViews && (
        <ViewsCustomizer userId={me.id} all={VIEWS.filter((v) => v.id !== 'expenses' || canSeeExpenses)} order={prefs.viewOrder} hidden={prefs.hiddenViews} onClose={() => setCustomizeViews(false)} />
      )}
      {pendingMove && data && (
        <DuePrompt
          cardTitle={data.cards[pendingMove.cardId]?.title ?? 'this card'}
          listTitle={data.lists[pendingMove.toListId]?.title ?? 'This list'}
          onCancel={() => setPendingMove(null)}
          onConfirm={(due) => {
            const mv = pendingMove;
            setPendingMove(null);
            dispatch({ type: 'UPDATE_CARD', cardId: mv.cardId, patch: { due }, note: `set {card} due ${due}` });
            allowMove.current = mv.cardId;
            dispatch(mv);
          }}
        />
      )}
      {panel === 'settings' && data && <BoardSettingsModal data={data} admin={admin} dispatch={dispatch} onClose={closePanel} />}
      {panel === 'automation' && data && <AutomationModal data={data} admin={admin} people={people} dispatch={dispatch} onClose={closePanel} ctx={{ by: { id: me.id, name: me.name }, boardId: meta.id, boardTitle: meta.title, origin: publicOrigin() }} />}
      {panel === 'fields' && data && (
        <Modal title="Custom fields" onClose={closePanel}>
          <FieldsEditor fields={data.customFields ?? []} dispatch={dispatch} />
        </Modal>
      )}
      {panel === 'labels' && data && (
        <Modal title="Board labels" onClose={closePanel}>
          <LabelsEditor labels={data.labels} onChange={(labels) => dispatch({ type: 'SET_LABELS', labels })} />
        </Modal>
      )}

      {panel === 'activity' && data && (
        <Modal
          wide
          title={
            <span className="act-title">
              <History size={20} />
              {activityBy
                ? (() => {
                    const p = people.find((x) => x.name === activityBy);
                    return p ? `${p.name} (${handleOf(p)})` : activityBy;
                  })()
                : 'Activity'}
            </span>
          }
          onClose={() => {
            setActivityBy(null);
            closePanel();
          }}
        >
          {activityBy && (
            <button className="link-btn activity-all" onClick={() => setActivityBy(null)}>
              Show everyone’s activity
            </button>
          )}
          <ActivityFeed
            data={data}
            people={people}
            by={activityBy}
            onOpenCard={(id) => {
              setPanel(null);
              setActivityBy(null);
              setOpenCardId(id);
            }}
          />
        </Modal>
      )}

      {memberTarget && (
        <MemberCard
          target={memberTarget}
          isMe={memberTarget.person.user_id === me.id}
          canAddToWorkspace={admin && memberTarget.person.via === 'board' && memberTarget.person.user_id !== me.id}
          onClose={() => setMemberTarget(null)}
          onViewProfile={() => {
            setProfileOf(memberTarget.person);
            setMemberTarget(null);
          }}
          onViewActivity={() => {
            setActivityBy(memberTarget.person.name);
            setMemberTarget(null);
            setPanel('activity');
          }}
          onAddToWorkspace={async () => {
            await api.inviteMember(memberTarget.person.email, 'member', { workspaceId: meta.workspace_id });
            loadPeople();
          }}
          onEditProfile={() => {
            setMemberTarget(null);
            window.dispatchEvent(new CustomEvent('karlo:edit-profile'));
          }}
        />
      )}

      {profileOf && data && (
        <Modal onClose={() => setProfileOf(null)}>
          {(() => {
            const p = peopleMap.get(profileOf.user_id) ?? profileOf;
            const assigned = Object.values(data.cards).filter((c) => !c.archived && c.assignees.includes(p.user_id));
            const done = assigned.filter((c) => c.completed || c.dueDone).length;
            return (
              <div className="profile-view">
                <div className="profile-view-head">
                  <Avatar id={p.user_id} name={p.name} src={p.avatar_url} size={96} />
                  <div>
                    <h3>{p.name}</h3>
                    <div className="muted">@{handleOf(p)}</div>
                    {p.title && <div className="profile-view-title">{p.title}</div>}
                    <div className="muted">{p.email}</div>
                    <span className={`role-pill role-${p.role}`}>{ROLE_INFO[p.role].label}</span>
                  </div>
                </div>
                <h4>
                  Cards on this board ({assigned.length}
                  {assigned.length ? ` · ${done} done` : ''})
                </h4>
                <ul className="profile-cards">
                  {assigned.map((c) => (
                    <li key={c.id}>
                      <button
                        className="link-btn"
                        onClick={() => {
                          setProfileOf(null);
                          setOpenCardId(c.id);
                        }}
                      >
                        {c.completed ? '✓ ' : ''}
                        {c.title}
                      </button>
                    </li>
                  ))}
                  {assigned.length === 0 && <li className="muted">No cards assigned on this board.</li>}
                </ul>
                <button
                  className="btn"
                  onClick={() => {
                    setActivityBy(p.name);
                    setProfileOf(null);
                    setPanel('activity');
                  }}
                >
                  View board activity
                </button>
              </div>
            );
          })()}
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
                      onClick={async () => (await askConfirm({ title: `Delete list “${l.title}”?`, message: 'The list and its cards are deleted permanently. This cannot be undone.', confirmLabel: 'Delete list', tone: 'danger' })) && dispatch({ type: 'DELETE_LIST', listId: l.id })}
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
                      onClick={async () => (await askConfirm({ title: `Delete “${c.title}”?`, message: 'The card is deleted permanently. This cannot be undone.', confirmLabel: 'Delete card', tone: 'danger' })) && dispatch({ type: 'DELETE_CARD', cardId: c.id })}
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
