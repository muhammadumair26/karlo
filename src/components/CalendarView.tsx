import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';
import { CalendarSyncModal } from './CalendarSync';
import type { Filters } from '../lib/filters';
import { dueStatus, matches } from '../lib/filters';
import type { BoardData, Card } from '../lib/types';
import { LABEL_COLORS } from '../lib/types';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function CalendarView({
  data,
  filters,
  meId,
  onOpenCard,
}: {
  data: BoardData;
  filters: Filters;
  meId: string;
  onOpenCard: (id: string) => void;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [sync, setSync] = useState(false);
  const labels = new Map(data.labels.map((l) => [l.id, l]));
  const activeListCards = new Set(
    data.listOrder.filter((id) => !data.lists[id]?.archived).flatMap((id) => data.lists[id]?.cardIds ?? []),
  );

  const byDay = new Map<string, Card[]>();
  let undated = 0;
  for (const c of Object.values(data.cards)) {
    if (!activeListCards.has(c.id) || !matches(c, filters, meId)) continue;
    if (!c.due) {
      undated++;
      continue;
    }
    byDay.set(c.due, [...(byDay.get(c.due) ?? []), c]);
  }

  // Grid starts on Monday.
  const first = new Date(month);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const today = iso(new Date());

  return (
    <div className="calendar">
      <div className="cal-head">
        <button className="btn translucent" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          ‹
        </button>
        <h3>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
        <button className="btn translucent" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          ›
        </button>
        <button
          className="btn translucent"
          onClick={() => {
            const d = new Date();
            setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
          }}
        >
          Today
        </button>
        {undated > 0 && <span className="cal-note">{undated} card(s) without a due date</span>}
        <span className="header-spacer" />
        <button className="btn translucent cal-sync" onClick={() => setSync(true)} title="Show your due dates in Google Calendar">
          <CalendarPlus size={15} /> Sync with Google Calendar
        </button>
        {sync && <CalendarSyncModal onClose={() => setSync(false)} />}
      </div>
      <div className="cal-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="cal-dow">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const key = iso(d);
          const cards = byDay.get(key) ?? [];
          return (
            <div key={key} className={`cal-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${key === today ? 'today' : ''}`}>
              <div className="cal-date">{d.getDate()}</div>
              {cards.map((c) => {
                const l = labels.get(c.labelIds[0]);
                return (
                  <button
                    key={c.id}
                    className={`cal-card due-${dueStatus(c)}`}
                    style={l ? { borderLeftColor: LABEL_COLORS[l.color] } : undefined}
                    onClick={() => onOpenCard(c.id)}
                    title={c.title}
                  >
                    {c.title}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
