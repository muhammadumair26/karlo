import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import type { Filters } from '../lib/filters';
import { hasFilters, NO_FILTERS } from '../lib/filters';
import { boardToCSV, karloExport } from '../lib/importers';
import type { BoardMeta, Me, Person } from '../lib/types';
import { BOARD_COLORS, canAdmin, canEdit, PRIORITIES, ROLE_INFO } from '../lib/types';
import { useBoardSync, type SyncStatus } from '../lib/useBoardSync';
import { CalendarView } from './CalendarView';
import { CardModal } from './CardModal';
import { EditableText } from './Editable';
import { KanbanView } from './KanbanView';
import { LabelsEditor } from './LabelsEditor';
import { MembersPanel } from './MembersPanel';
import { TableView } from './TableView';
import { AvatarStack, download, Menu, Modal, timeAgo } from './ui';

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
  onBoardGone,
  onMetaChanged,
}: {
  meta: BoardMeta;
  me: Me;
  onBoardGone: () => void;
  onMetaChanged: () => void;
}) {
  const { data, status, loadError, dispatch } = useBoardSync(meta.id, me);
  const [people, setPeople] = useState<Person[]>([]);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as View) || 'board';
    } catch {
      return 'board';
    }
  });
  const [panel, setPanel] = useState<null | 'share' | 'labels' | 'archive' | 'activity'>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const editable = canEdit(meta.role);
  const admin = canAdmin(meta.role);

  const loadPeople = useCallback(() => {
    api.boardPeople(meta.id).then(setPeople).catch(() => {});
  }, [meta.id]);
  useEffect(loadPeople, [loadPeople]);
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

  const exportJSON = () =>
    data && download(`${meta.title}.karlo.json`, karloExport([{ title: meta.title, color: meta.color, data }]));
  const exportCSV = () => data && download(`${meta.title}.csv`, boardToCSV(data, peopleMap), 'text/csv');

  return (
    <>
      <div className="board-header">
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
        {meta.role !== 'member' && <span className={`role-pill role-${meta.role} on-dark`}>{ROLE_INFO[meta.role].label}</span>}

        <div className="seg on-dark">
          {(['board', 'table', 'calendar'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setViewSaved(v)}>
              {v === 'board' ? '▦ Board' : v === 'table' ? '☰ Table' : '📅 Calendar'}
            </button>
          ))}
        </div>

        <button className={`btn translucent ${hasFilters(filters) ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)}>
          ⚲ Filter{hasFilters(filters) ? ' •' : ''}
        </button>

        <span className="header-spacer" />
        <span className={`sync-status sync-${status}`}>{STATUS_TEXT[status]}</span>
        <button className="people-btn" onClick={() => setPanel('share')} title="Members">
          <AvatarStack ids={people.map((p) => p.user_id)} people={peopleMap} max={4} size={28} />
        </button>
        <button className="btn translucent" onClick={() => setPanel('share')}>
          👤+ Share
        </button>
        <span className="menu-anchor">
          <button className="btn translucent" onClick={() => setMenuOpen(!menuOpen)} aria-label="Board menu">
            ⋯
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
            {editable && <button onClick={() => (setMenuOpen(false), setPanel('labels'))}>🏷 Labels</button>}
            <button onClick={() => (setMenuOpen(false), setPanel('activity'))}>🕘 Activity</button>
            <button onClick={() => (setMenuOpen(false), setPanel('archive'))}>
              🗄 Archived items ({archivedCards.length + archivedLists.length})
            </button>
            <hr />
            <button onClick={() => (setMenuOpen(false), exportJSON())}>⇩ Export board (JSON)</button>
            <button onClick={() => (setMenuOpen(false), exportCSV())}>⇩ Export cards (CSV / Excel)</button>
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
                Delete board
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
                Leave board
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
        <KanbanView data={data} dispatch={dispatch} editable={editable} filters={filters} meId={me.id} people={peopleMap} onOpenCard={setOpenCardId} />
      ) : view === 'table' ? (
        <TableView data={data} filters={filters} meId={me.id} people={peopleMap} onOpenCard={setOpenCardId} />
      ) : (
        <CalendarView data={data} filters={filters} meId={me.id} onOpenCard={setOpenCardId} />
      )}

      {openCard && data && (
        <CardModal
          key={openCard.id}
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
