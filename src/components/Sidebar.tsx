import { useState } from 'react';
import type { BoardMeta, Workspace } from '../lib/types';
import { canEdit } from '../lib/types';
import { AddForm } from './Editable';

export function Sidebar({
  workspaces,
  boards,
  activeBoardId,
  onSelect,
  onNewBoard,
  onNewWorkspace,
  onOpenWorkspace,
  onImport,
  onExportAll,
}: {
  workspaces: Workspace[];
  boards: BoardMeta[];
  activeBoardId: string | null;
  onSelect: (id: string) => void;
  onNewBoard: (workspaceId: string, title: string) => void;
  onNewWorkspace: (name: string) => void;
  onOpenWorkspace: (id: string) => void;
  onImport: () => void;
  onExportAll: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const wsIds = new Set(workspaces.map((w) => w.id));
  const shared = boards.filter((b) => !wsIds.has(b.workspace_id));

  const boardItem = (b: BoardMeta) => (
    <li key={b.id} className={b.id === activeBoardId ? 'active' : ''}>
      <button onClick={() => onSelect(b.id)}>
        <span className="swatch" style={{ background: b.color }} />
        <span className="ellipsis">{b.title}</span>
        {b.role === 'viewer' && <span className="tiny-pill">view</span>}
      </button>
    </li>
  );

  return (
    <aside className="sidebar">
      {workspaces.map((w) => {
        const wsBoards = boards.filter((b) => b.workspace_id === w.id);
        const isCollapsed = collapsed[w.id];
        return (
          <section key={w.id} className="ws">
            <div className="ws-head">
              <button className="ws-toggle" onClick={() => setCollapsed({ ...collapsed, [w.id]: !isCollapsed })}>
                <span className={`chev ${isCollapsed ? '' : 'open'}`}>›</span>
                <span className="ws-icon">{w.name.trim()[0]?.toUpperCase() ?? 'W'}</span>
                <span className="ellipsis">{w.name}</span>
              </button>
              <button className="icon-btn light small" title="Members & settings" onClick={() => onOpenWorkspace(w.id)}>
                👥
              </button>
            </div>
            {!isCollapsed && (
              <>
                <ul>{wsBoards.map(boardItem)}</ul>
                {canEdit(w.role) && (
                  <AddForm label="New board" placeholder="Board title…" submitLabel="Create" onAdd={(t) => onNewBoard(w.id, t)} />
                )}
              </>
            )}
          </section>
        );
      })}

      {shared.length > 0 && (
        <section className="ws">
          <div className="ws-head">
            <span className="ws-label">Shared with me</span>
          </div>
          <ul>{shared.map(boardItem)}</ul>
        </section>
      )}

      <div className="sidebar-footer">
        <AddForm label="New workspace" placeholder="Team or workspace name…" submitLabel="Create" onAdd={onNewWorkspace} />
        <button className="add-trigger" onClick={onImport}>
          ⇪ Import (Trello, ClickUp, CSV)
        </button>
        <button className="add-trigger" onClick={onExportAll}>
          ⇩ Export all boards
        </button>
      </div>
    </aside>
  );
}
