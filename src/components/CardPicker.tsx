import { Check, ChevronDown, Search, SquareKanban, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDate } from '../lib/filters';
import type { BoardData, Card } from '../lib/types';
import { LABEL_COLORS } from '../lib/types';

/** Searchable card chooser: type to filter by title, list or label; arrows + Enter to pick. */
export function CardPicker({
  data,
  value,
  onChange,
  placeholder = 'Link this to a card (optional)',
}: {
  data: BoardData;
  value: string | null;
  onChange: (cardId: string | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const labels = useMemo(() => new Map(data.labels.map((l) => [l.id, l])), [data.labels]);

  // Every open card with its list, in board order.
  const all = useMemo(
    () =>
      data.listOrder
        .filter((l) => data.lists[l] && !data.lists[l].archived)
        .flatMap((l) =>
          data.lists[l].cardIds
            .map((id) => data.cards[id])
            .filter((c): c is Card => !!c && !c.archived)
            .map((c) => ({ c, list: data.lists[l].title })),
        ),
    [data],
  );
  const query = q.trim().toLowerCase();
  const hits = useMemo(
    () =>
      query
        ? all.filter(({ c, list }) =>
            `${c.title} ${list} ${c.labelIds.map((id) => labels.get(id)?.name ?? '').join(' ')}`.toLowerCase().includes(query),
          )
        : all,
    [all, query, labels],
  );
  const selected = value ? all.find((x) => x.c.id === value) : undefined;

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(Math.max(0, all.findIndex((x) => x.c.id === value)));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, all, value]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  const Row = ({ c, list }: { c: Card; list: string }) => (
    <>
      <span className="cp-title">{c.title || 'Untitled card'}</span>
      <span className="cp-meta">
        <span className="cp-list">
          <SquareKanban size={11} /> {list}
        </span>
        {c.labelIds.slice(0, 4).map((id) => {
          const l = labels.get(id);
          return l ? <span key={id} className="cp-label" style={{ background: LABEL_COLORS[l.color] }} title={l.name} /> : null;
        })}
        {c.due && <span className="cp-due">Due {formatDate(c.due)}</span>}
        {c.completed && <span className="cp-done">Done</span>}
      </span>
    </>
  );

  return (
    <div className={`cp ${open ? 'open' : ''}`}>
      {!open ? (
        <button type="button" className={`cp-field ${selected ? 'has' : ''}`} onClick={() => setOpen(true)}>
          {selected ? (
            <span className="cp-selected">
              <Row c={selected.c} list={selected.list} />
            </span>
          ) : (
            <span className="cp-placeholder">{placeholder}</span>
          )}
          {selected ? (
            <span
              role="button"
              tabIndex={0}
              className="cp-clear"
              aria-label="Remove card link"
              title="Remove card link"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(null);
                }
              }}
            >
              <X size={14} />
            </span>
          ) : (
            <ChevronDown size={16} className="cp-chev" />
          )}
        </button>
      ) : (
        <div className="cp-panel" role="combobox" aria-expanded="true">
          <label className="cp-search">
            <Search size={15} />
            <input
              ref={inputRef}
              value={q}
              placeholder={`Search ${all.length} cards by name, list or label`}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive(Math.min(active + 1, hits.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive(Math.max(active - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (hits[active]) pick(hits[active].c.id);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
              aria-label="Search cards"
            />
            <button type="button" className="cp-close" onClick={() => setOpen(false)} aria-label="Close">
              <X size={14} />
            </button>
          </label>
          <div className="cp-list-box" ref={listRef} role="listbox">
            {value && !query && (
              <button type="button" className="cp-option cp-none" onClick={() => pick(null)}>
                <X size={13} /> No card
              </button>
            )}
            {hits.map(({ c, list }, i) => (
              <button
                type="button"
                key={c.id}
                data-i={i}
                role="option"
                aria-selected={c.id === value}
                className={`cp-option ${i === active ? 'active' : ''} ${c.id === value ? 'chosen' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c.id)}
              >
                <span className="cp-opt-body">
                  <Row c={c} list={list} />
                </span>
                {c.id === value && <Check size={15} className="cp-tick" />}
              </button>
            ))}
            {hits.length === 0 && <p className="cp-empty">No cards match “{q.trim()}”.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
