import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { handleOf } from '../lib/notify';
import type { Person } from '../lib/types';
import { Avatar } from './ui';

type El = HTMLTextAreaElement | HTMLInputElement;

/**
 * A textarea/input with @mention suggestions. Typing "@" lists everyone on the board;
 * keep typing to narrow it down, ↑/↓ to choose, Enter or Tab to insert.
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
  useImperativeHandle(ref, () => inner.current as El);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const others = people.filter((p) => p.user_id !== meId);
  const matches =
    query === null
      ? []
      : others.filter((p) => handleOf(p).toLowerCase().includes(query) || p.name.toLowerCase().includes(query)).slice(0, 8);

  const detect = (v: string, caret: number) => {
    const m = v.slice(0, caret).match(/(?:^|\s|\()@([\w.+-]*)$/);
    setQuery(m ? m[1].toLowerCase() : null);
    setActive(0);
  };

  const insert = (p: Person) => {
    const el = inner.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([\w.+-]*)$/, `@${handleOf(p)} `);
    onChange(before + value.slice(caret));
    setQuery(null);
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
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
    value,
    placeholder,
    autoFocus,
    onFocus,
    onKeyDown,
    onBlur: () => setTimeout(() => setQuery(null), 150),
    onChange: (e: React.ChangeEvent<El>) => {
      onChange(e.target.value);
      detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    onClick: (e: React.MouseEvent<El>) => detect(e.currentTarget.value, e.currentTarget.selectionStart ?? 0),
  };

  return (
    <div className={`mention-wrap ${className ?? ''}`}>
      {multiline ? (
        <textarea ref={inner as React.RefObject<HTMLTextAreaElement>} {...common} />
      ) : (
        <input ref={inner as React.RefObject<HTMLInputElement>} {...common} />
      )}
      {query !== null && (
        <div className="mention-list" onMouseDown={(e) => e.preventDefault()}>
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
