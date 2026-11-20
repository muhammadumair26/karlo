import { CalendarClock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

/** Asked when a card without a due date moves into a list that needs one. */
export function DuePrompt({
  cardTitle,
  listTitle,
  onConfirm,
  onCancel,
}: {
  cardTitle: string;
  listTitle: string;
  onConfirm: (due: string) => void;
  onCancel: () => void;
}) {
  const [due, setDue] = useState('');
  const dateRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const quick = [
    { label: 'Today', v: plusDays(0) },
    { label: 'Tomorrow', v: plusDays(1) },
    { label: 'In 3 days', v: plusDays(3) },
    { label: 'In a week', v: plusDays(7) },
  ];

  return createPortal(
    <div className="kd-backdrop" onMouseDown={onCancel}>
      <div className="kd kd-access dp" role="dialog" aria-modal="true" aria-labelledby="dp-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="kd-head">
          <span className="kd-icon" aria-hidden>
            <CalendarClock size={20} />
          </span>
          <h3 id="dp-title">When is it due?</h3>
        </div>
        <div className="kd-msg">
          <strong>{listTitle}</strong> needs a due date. Set one for “{cardTitle}” to move it there.
        </div>
        <div className="dp-pick">
          {quick.map((q) => (
            <button type="button" key={q.label} className={`acf-chip ${due === q.v ? 'on' : ''}`} onClick={() => setDue(q.v)}>
              {q.label}
            </button>
          ))}
          <input ref={dateRef} type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" autoFocus />
        </div>
        <div className="kd-actions">
          <button className="btn kd-cancel" onClick={onCancel}>
            Keep it where it is
          </button>
          <button className="btn kd-ok primary" disabled={!due} onClick={() => due && onConfirm(due)}>
            Set date &amp; move
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
