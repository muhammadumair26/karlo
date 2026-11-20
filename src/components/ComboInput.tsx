import { Check, ChevronDown, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * A text field with Karlo's own suggestion list (instead of the browser's <datalist>, which pops up
 * in odd places). Type to filter, arrows + Enter to pick, or keep what you typed as a new value.
 */
export function ComboInput({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  newLabel = 'Add',
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  ariaLabel?: string;
  newLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false); // filter only after the person starts typing
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = value.trim().toLowerCase();
  const shown = useMemo(() => (typed && q ? options.filter((o) => o.toLowerCase().includes(q)) : options), [options, q, typed]);
  const exact = options.some((o) => o.toLowerCase() === q);
  const canAdd = typed && !!q && !exact;
  const total = shown.length + (canAdd ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    setTyped(false);
  };
  const openList = () => {
    setOpen(true);
    setTyped(false);
    setActive(Math.max(0, options.findIndex((o) => o === value)));
  };

  return (
    <div className={`combo ${open ? 'open' : ''}`} ref={wrap}>
      <div className="combo-field">
        <input
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onFocus={openList}
          onClick={() => !open && openList()}
          onChange={(e) => {
            onChange(e.target.value);
            setTyped(true);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (!open) openList();
              else setActive(Math.min(active + 1, total - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(Math.max(active - 1, 0));
            } else if (e.key === 'Enter' && open) {
              e.preventDefault();
              if (active < shown.length) choose(shown[active]);
              else if (canAdd) choose(value.trim());
              else setOpen(false);
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === 'Tab') setOpen(false);
          }}
        />
        <button type="button" className="combo-toggle" tabIndex={-1} aria-label="Show options" onMouseDown={(e) => e.preventDefault()} onClick={() => (open ? setOpen(false) : openList())}>
          <ChevronDown size={16} />
        </button>
      </div>
      {open && total > 0 && (
        <div className="combo-list" role="listbox" ref={listRef}>
          {shown.map((o, i) => (
            <button
              type="button"
              key={o}
              data-i={i}
              role="option"
              aria-selected={o === value}
              className={`combo-opt ${i === active ? 'active' : ''} ${o === value ? 'chosen' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o)}
            >
              <span>{o}</span>
              {o === value && <Check size={14} />}
            </button>
          ))}
          {canAdd && (
            <button
              type="button"
              data-i={shown.length}
              className={`combo-opt combo-add ${active === shown.length ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(shown.length)}
              onClick={() => choose(value.trim())}
            >
              <Plus size={14} /> {newLabel} “{value.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
