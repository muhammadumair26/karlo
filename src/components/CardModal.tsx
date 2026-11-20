import { useEffect, useState } from 'react';
import type { Action } from '../store';
import { uid } from '../store';
import type { Card } from '../types';
import { LABEL_COLORS } from '../types';

export function CardModal({
  card,
  listTitle,
  dispatch,
  onClose,
}: {
  card: Card;
  listTitle: string;
  dispatch: React.Dispatch<Action>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [desc, setDesc] = useState(card.description);
  const [newItem, setNewItem] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (patch: Partial<Card>) => dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch });

  const done = card.checklist.filter((i) => i.done).length;
  const pct = card.checklist.length ? Math.round((done / card.checklist.length) * 100) : 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <input
          className="modal-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== card.title && update({ title: title.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="modal-sub">
          in list <strong>{listTitle}</strong>
        </div>

        <div className="modal-grid">
          <section>
            <h4>Labels</h4>
            <div className="label-picker">
              {LABEL_COLORS.map((l) => {
                const on = card.labels.includes(l);
                return (
                  <button
                    key={l}
                    className={`label-chip label-${l} ${on ? 'on' : ''}`}
                    onClick={() => update({ labels: on ? card.labels.filter((x) => x !== l) : [...card.labels, l] })}
                    aria-pressed={on}
                    title={l}
                  >
                    {on ? '✓' : ''}
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <h4>Due date</h4>
            <div className="due-row">
              <input type="date" value={card.due ?? ''} onChange={(e) => update({ due: e.target.value || null })} />
              {card.due && (
                <button className="btn ghost small" onClick={() => update({ due: null })}>
                  Clear
                </button>
              )}
            </div>
          </section>
        </div>

        <section>
          <h4>Description</h4>
          <textarea
            className="modal-desc"
            placeholder="Add a more detailed description…"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => desc !== card.description && update({ description: desc })}
          />
        </section>

        <section>
          <h4>Checklist {card.checklist.length > 0 && <span className="muted">{pct}%</span>}</h4>
          {card.checklist.length > 0 && (
            <div className="progress">
              <div className={`progress-fill ${pct === 100 ? 'complete' : ''}`} style={{ width: `${pct}%` }} />
            </div>
          )}
          <ul className="checklist">
            {card.checklist.map((item) => (
              <li key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() =>
                      update({ checklist: card.checklist.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) })
                    }
                  />
                  <span className={item.done ? 'struck' : ''}>{item.text}</span>
                </label>
                <button
                  className="btn ghost small"
                  onClick={() => update({ checklist: card.checklist.filter((i) => i.id !== item.id) })}
                  aria-label="Remove item"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <form
            className="checklist-add"
            onSubmit={(e) => {
              e.preventDefault();
              const t = newItem.trim();
              if (!t) return;
              update({ checklist: [...card.checklist, { id: uid(), text: t, done: false }] });
              setNewItem('');
            }}
          >
            <input placeholder="Add an item…" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
            <button className="btn" type="submit">
              Add
            </button>
          </form>
        </section>

        <div className="modal-footer">
          <span className="muted">Created {new Date(card.createdAt).toLocaleString()}</span>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('Delete this card?')) {
                dispatch({ type: 'DELETE_CARD', cardId: card.id });
                onClose();
              }
            }}
          >
            Delete card
          </button>
        </div>
      </div>
    </div>
  );
}
