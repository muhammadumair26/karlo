import { CalendarDays } from 'lucide-react';
import { useRef, useState } from 'react';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
/** Next Monday (or a week today if it's Monday). */
const nextWeek = () => {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return iso(d);
};

/** "+ Add a card": title plus a required due date (quick picks or any date). */
export function AddCardForm({ onAdd }: { onAdd: (title: string, due: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [missing, setMissing] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  if (!open) {
    return (
      <button className="add-trigger" onClick={() => setOpen(true)}>
        + Add a card
      </button>
    );
  }

  const submit = () => {
    const t = text.trim();
    if (!t) return titleRef.current?.focus();
    if (!due) {
      setMissing(true);
      dateRef.current?.focus();
      return;
    }
    onAdd(t, due);
    setText('');
    setMissing(false);
    titleRef.current?.focus(); // keep the date for the next card
  };

  const quick = [
    { label: 'Today', v: plusDays(0) },
    { label: 'Tomorrow', v: plusDays(1) },
    { label: 'Next week', v: nextWeek() },
  ];

  return (
    <div className="add-form add-card-form">
      <textarea
        ref={titleRef}
        autoFocus
        placeholder="Enter a title for this card…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <div className={`acf-due ${missing && !due ? 'missing' : ''}`}>
        <span className="acf-label">
          <CalendarDays size={13} /> Due date <span className="acf-req">required</span>
        </span>
        <div className="acf-quick">
          {quick.map((q) => (
            <button type="button" key={q.label} className={`acf-chip ${due === q.v ? 'on' : ''}`} onClick={() => (setDue(q.v), setMissing(false))}>
              {q.label}
            </button>
          ))}
          <input
            ref={dateRef}
            type="date"
            value={due}
            onChange={(e) => (setDue(e.target.value), setMissing(false))}
            aria-label="Due date"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        {missing && !due && <span className="acf-hint">Pick a due date to add the card.</span>}
      </div>
      <div className="add-form-actions">
        <button className="btn primary" onClick={submit}>
          Add card
        </button>
        <button className="btn ghost" onClick={() => setOpen(false)} aria-label="Cancel">
          ✕
        </button>
      </div>
    </div>
  );
}
