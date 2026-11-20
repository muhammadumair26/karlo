import { Check, Clock, LayoutGrid, Search, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardMeta, Workspace } from '../lib/types';

const RECENT_KEY = 'karlo-recent-boards';

export function rememberBoard(id: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 8)));
  } catch {
    /* ignore */
  }
}
function recentBoards(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** "Switch boards" button + searchable list of every board (press B to open). */
export function BoardSwitcher({
  boards,
  workspaces,
  starred,
  activeId,
  onSelect,
}: {
  boards: BoardMeta[];
  workspaces: Workspace[];
  starred: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey && !e.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable && !document.querySelector('.modal-backdrop')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    // The phone bottom bar opens the switcher with this event.
    const openIt = () => setOpen(true);
    window.addEventListener('karlo:switch-boards', openIt);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('karlo:switch-boards', openIt);
    };
  }, []);
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const byId = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);
  const query = q.trim().toLowerCase();

  // Sections (when not searching) or a flat filtered list (when searching).
  const sections = useMemo(() => {
    if (query) {
      const hits = boards.filter((b) => b.title.toLowerCase().includes(query));
      return [{ title: `Results`, icon: <Search size={13} />, items: hits }];
    }
    const wsIds = new Set(workspaces.map((w) => w.id));
    const out: { title: string; icon?: React.ReactNode; items: BoardMeta[] }[] = [];
    const star = starred.map((id) => byId.get(id)).filter((b): b is BoardMeta => !!b);
    if (star.length) out.push({ title: 'Starred', icon: <Star size={13} />, items: star });
    const rec = recentBoards()
      .map((id) => byId.get(id))
      .filter((b): b is BoardMeta => !!b)
      .slice(0, 4);
    if (rec.length) out.push({ title: 'Recent', icon: <Clock size={13} />, items: rec });
    for (const w of workspaces) out.push({ title: w.name, items: boards.filter((b) => b.workspace_id === w.id) });
    const shared = boards.filter((b) => !wsIds.has(b.workspace_id));
    if (shared.length) out.push({ title: 'Shared with me', items: shared });
    return out;
  }, [query, boards, workspaces, starred, byId]);

  const flat = sections.flatMap((s) => s.items);
  const pick = (id: string) => {
    setOpen(false);
    if (id !== activeId) onSelect(id);
  };

  let n = -1;
  return (
    <span className="menu-anchor switcher">
      <button className="btn translucent switch-btn" onClick={() => setOpen(!open)} title="Switch boards (B)">
        <LayoutGrid size={16} /> <span className="switch-label">Switch boards</span>
      </button>
      {open && (
        <>
          <div className="switch-scrim" onClick={() => setOpen(false)} />
          <div className="switch-panel" role="dialog" aria-label="Switch boards">
            <div className="switch-search">
              <Search size={15} />
              <input
                ref={inputRef}
                placeholder="Search your boards"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive(Math.min(active + 1, flat.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive(Math.max(active - 1, 0));
                  } else if (e.key === 'Enter' && flat[active]) pick(flat[active].id);
                  else if (e.key === 'Escape') setOpen(false);
                }}
              />
            </div>
            <div className="switch-list">
              {sections.map((s) =>
                s.items.length === 0 ? null : (
                  <div key={s.title} className="switch-section">
                    <div className="switch-section-title">
                      {s.icon} {s.title}
                    </div>
                    <div className="switch-grid">
                      {s.items.map((b) => {
                        n++;
                        const i = n;
                        return (
                          <button
                            key={s.title + b.id}
                            className={`switch-tile ${i === active ? 'on' : ''} ${b.id === activeId ? 'current' : ''}`}
                            style={{ ['--tile' as string]: b.color }}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => pick(b.id)}
                          >
                            <span className="switch-tile-color" />
                            <span className="switch-tile-title">{b.title}</span>
                            {b.id === activeId && <Check size={14} className="switch-tick" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ),
              )}
              {flat.length === 0 && <p className="muted switch-empty">No boards match “{q.trim()}”.</p>}
            </div>
            <div className="switch-foot muted">Tip: press B anywhere to switch boards</div>
          </div>
        </>
      )}
    </span>
  );
}
