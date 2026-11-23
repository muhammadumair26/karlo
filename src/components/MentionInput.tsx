import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { handleOf } from '../lib/notify';
import { editMentionView, mentionsToNames, namesToMentions } from '../lib/notifyRules';
import type { Person } from '../lib/types';
import { Avatar } from './ui';

type El = HTMLTextAreaElement | HTMLInputElement;

/**
 * A textarea/input with @mention suggestions. Typing "@" lists everyone on the board;
 * keep typing to narrow it down, ↑/↓ to choose, Enter or Tab to insert.
 * Mentions show as the person's name; the text is saved with their @handle.
 */
export const MentionInput = forwardRef<
  El | null,
  {
    value: string;
    onChange: (v: string) => void;
    people: Person[];
    meId?: string;
    multiline?: boolean;
    placeholder?: string;
    autoFocus?: boolean;
    className?: string;
    onFocus?: () => void;
    /** Enter (inputs) or Ctrl/⌘+Enter (textareas) when no suggestion list is open. */
    onSubmit?: () => void;
    onEscape?: () => void;
  }
>(function MentionInput({ value, onChange, people, meId, multiline, placeholder, autoFocus, className, onFocus, onSubmit, onEscape }, ref) {
  const inner = useRef<El>(null);
  const view = useMemo(() => mentionsToNames(value, people), [value, people]);
  const shown = view.text;
  useImperativeHandle(ref, () => inner.current as El);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  // Where the list fits: below the box, or above it when the phone keyboard leaves no room underneath.
  const [place, setPlace] = useState<{ up: boolean; max: number }>({ up: false, max: 320 });
  const open = query !== null;

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = wrap.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport; // excludes the on-screen keyboard on phones
      const top = vv ? vv.offsetTop : 0;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const below = bottom - r.bottom - 12;
      const above = r.top - top - 12;
      const up = below < 220 && above > below;
      setPlace({ up, max: Math.max(120, Math.min(320, up ? above : below)) });
    };
    measure();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => {
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  const others = people.filter((p) => p.user_id !== meId);
  const matches =
    query === null
      ? []
      : others.filter((p) => handleOf(p).toLowerCase().includes(query) || p.name.toLowerCase().includes(query)).slice(0, 8);

  const detect = (v: string, caret: number) => {
    if (view.spans.some((sp) => caret > sp.start && caret <= sp.end)) return setQuery(null);
    const m = v.slice(0, caret).match(/(?:^|\s|\()@([\w.+-]*)$/);
    setQuery(m ? m[1].toLowerCase() : null);
    setActive(0);
  };

  const insert = (p: Person) => {
    const el = inner.current;
    const caret = el?.selectionStart ?? shown.length;
    const from = shown.slice(0, caret).search(/@([\w.+-]*)$/);
    if (from < 0) return;
    const label = `@${p.name}`;
    const added = label.length + 1 - (caret - from);
    const text = shown.slice(0, from) + label + ' ' + shown.slice(caret);
    const spans = [...view.spans.map((sp) => (sp.start >= caret ? { ...sp, start: sp.start + added, end: sp.end + added } : sp)), { start: from, end: from + label.length, userId: p.user_id }];
    onChange(namesToMentions({ text, spans }, people));
    setQuery(null);
    const cursor = from + label.length + 1;
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<El>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((active + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((active - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insert(matches[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setQuery(null);
        return;
      }
    }
    if (e.key === 'Escape' && onEscape) {
      e.stopPropagation();
      onEscape();
    }
    if (e.key === 'Enter' && onSubmit && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  };

  const common = {
    value: shown,
    placeholder,
    autoFocus,
    onFocus,
    onKeyDown,
    onBlur: () => setTimeout(() => setQuery(null), 150),
    onChange: (e: React.ChangeEvent<El>) => {
      const el = e.target;
      const next = editMentionView(view, el.value);
      onChange(namesToMentions(next, people));
      // A whole mention was removed: keep the cursor where the person was typing.
      if (next.text !== el.value) {
        const caret = Math.max(0, (el.selectionStart ?? 0) - (el.value.length - next.text.length));
        setTimeout(() => el.setSelectionRange(caret, caret), 0);
      }
      detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    onClick: (e: React.MouseEvent<El>) => detect(e.currentTarget.value, e.currentTarget.selectionStart ?? 0),
  };

  return (
    <div ref={wrap} className={`mention-wrap ${className ?? ''}`}>
      {multiline ? (
        <textarea ref={inner as React.RefObject<HTMLTextAreaElement>} {...common} />
      ) : (
        <input ref={inner as React.RefObject<HTMLInputElement>} {...common} />
      )}
      {query !== null && (
        <div className={`mention-list${place.up ? ' up' : ''}`} style={{ maxHeight: place.max }} onMouseDown={(e) => e.preventDefault()}>
          <div className="mention-hint">Mention someone — they'll be notified</div>
          {matches.map((p, i) => (
            <button key={p.user_id} className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onClick={() => insert(p)}>
              <Avatar id={p.user_id} name={p.name} src={p.avatar_url} size={26} />
              <span className="mention-name">
                {p.name}
                <span className="muted">@{handleOf(p)}</span>
              </span>
            </button>
          ))}
          {matches.length === 0 && (
            <div className="mention-empty">
              {others.length === 0 ? 'Nobody else is on this board yet — invite people with Share.' : 'No one matches.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
