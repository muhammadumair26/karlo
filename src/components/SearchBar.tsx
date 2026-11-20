import { Kanban, Search, SquareCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cardListId, normalize } from '../lib/board';
import type { BoardData, BoardMeta } from '../lib/types';
import { supabase } from '../supabase';

interface Indexed {
  meta: BoardMeta;
  data: BoardData;
}

type Result =
  | { kind: 'board'; boardId: string; title: string; color: string; sub: string }
  | { kind: 'card'; boardId: string; cardId: string; title: string; color: string; sub: string; snippet?: string; archived: boolean };

function snippetAround(text: string, q: string, n = 70) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return undefined;
  const start = Math.max(0, i - 25);
  return (start > 0 ? '…' : '') + text.slice(start, start + n).replace(/\s+/g, ' ') + (start + n < text.length ? '…' : '');
}

function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q);
  if (!q || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** Searches every board you can see: board names, card titles, descriptions, comments, checklists, labels, list names. */
export function SearchBar({ boards, onOpen }: { boards: BoardMeta[]; onOpen: (boardId: string, cardId: string | null) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<Indexed[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses search (like Trello), unless you're already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // (Re)load all board contents when search opens, so results are fresh.
  const loadIndex = async () => {
    if (!supabase || loading) return;
    setLoading(true);
    const { data } = await supabase.from('boards').select('id, data');
    const byId = new Map(boards.map((b) => [b.id, b]));
    setIndex(
      (data ?? [])
        .filter((r) => byId.has(r.id as string))
        .map((r) => ({ meta: byId.get(r.id as string)!, data: normalize(r.data) })),
    );
    setLoading(false);
  };

  const query = q.trim().toLowerCase();
  const results = useMemo<Result[]>(() => {
    if (query.length < 2) return [];
    const out: Result[] = [];
    for (const b of boards) {
      if (b.title.toLowerCase().includes(query)) out.push({ kind: 'board', boardId: b.id, title: b.title, color: b.color, sub: 'Board' });
    }
    for (const { meta, data } of index ?? []) {
      const labels = new Map(data.labels.map((l) => [l.id, l.name]));
      for (const c of Object.values(data.cards)) {
        const lid = cardListId(data, c.id);
        const list = lid ? data.lists[lid] : undefined;
        if (!list) continue;
        const fields: [string, string][] = [
          ['', c.title],
          ['Description', c.description],
          ...c.comments.map((m): [string, string] => [`Comment by ${m.authorName}`, m.text]),
          ...c.checklist.map((i): [string, string] => ['Checklist', i.text]),
          ...c.attachments.map((a): [string, string] => ['Attachment', a.name || a.url]),
          ['Label', c.labelIds.map((id) => labels.get(id) ?? '').join(' ')],
          ['List', list.title],
        ];
        const hit = fields.find(([, text]) => text.toLowerCase().includes(query));
        if (!hit) continue;
        out.push({
          kind: 'card',
          boardId: meta.id,
          cardId: c.id,
          title: c.title,
          color: meta.color,
          sub: `${meta.title} · ${list.title}`,
          snippet: hit[0] ? `${hit[0]}: ${snippetAround(hit[1], query) ?? ''}` : undefined,
          archived: c.archived || list.archived,
        });
      }
    }
    // Title matches first, archived last.
    return out
      .sort((a, b) => {
        const at = a.title.toLowerCase().includes(query) ? 0 : 1;
        const bt = b.title.toLowerCase().includes(query) ? 0 : 1;
        const aa = a.kind === 'card' && a.archived ? 1 : 0;
        const ba = b.kind === 'card' && b.archived ? 1 : 0;
        return (a.kind === 'board' ? -1 : 0) - (b.kind === 'board' ? -1 : 0) || at - bt || aa - ba;
      })
      .slice(0, 30);
  }, [query, boards, index]);

  const go = (r: Result) => {
    onOpen(r.boardId, r.kind === 'card' ? r.cardId : null);
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
  };

  return (
    <div className={`searchbar ${open ? 'open' : ''}`}>
      <Search size={16} className="search-icon" />
      <input
        ref={inputRef}
        placeholder="Search cards, boards, comments…"
        value={q}
        onFocus={() => {
          setOpen(true);
          void loadIndex();
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(Math.min(active + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(Math.max(active - 1, 0));
          } else if (e.key === 'Enter' && results[active]) go(results[active]);
          else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      {!open && <kbd className="search-kbd">/</kbd>}
      {open && query.length >= 2 && (
        <div className="search-results" onMouseDown={(e) => e.preventDefault()}>
          {results.map((r, i) => (
            <button key={r.kind + r.boardId + (r.kind === 'card' ? r.cardId : '')} className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onClick={() => go(r)}>
              <span className="sr-icon" style={{ background: r.color }}>
                {r.kind === 'board' ? <Kanban size={14} /> : <SquareCheck size={14} />}
              </span>
              <span className="sr-text">
                <span className="sr-title">
                  <Highlight text={r.title} q={query} />
                  {r.kind === 'card' && r.archived && <span className="tiny-tag">archived</span>}
                </span>
                <span className="sr-sub">{r.sub}</span>
                {r.kind === 'card' && r.snippet && (
                  <span className="sr-snippet">
                    <Highlight text={r.snippet} q={query} />
                  </span>
                )}
              </span>
            </button>
          ))}
          {results.length === 0 && <div className="sr-empty">{loading ? 'Searching…' : `No results for “${q.trim()}”`}</div>}
        </div>
      )}
      {open && query.length < 2 && (
        <div className="search-results">
          <div className="sr-empty">Type at least 2 letters. Searches card titles, descriptions, comments, checklists, labels and board names.</div>
        </div>
      )}
    </div>
  );
}
