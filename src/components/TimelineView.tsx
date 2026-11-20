import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardActionBody } from '../lib/board';
import type { Filters } from '../lib/filters';
import { matches } from '../lib/filters';
import type { BoardData, Card, Person } from '../lib/types';
import { LABEL_COLORS } from '../lib/types';
import { Avatar } from './ui';

// Whole days since 1970 (UTC), so daylight-saving never shifts a bar.
const toDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
};
const fromDay = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);
const localToday = () => {
  const t = new Date();
  return Math.round(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / 864e5);
};
const dayDate = (n: number) => new Date(n * 864e5);

type Scale = 'day' | 'week' | 'month';
const PX: Record<Scale, number> = { day: 44, week: 20, month: 7 };
const ROW = 40;

interface Drag {
  cardId: string;
  mode: 'move' | 'resize';
  x0: number;
  delta: number;
  moved: boolean;
}

/** Gantt-style timeline: one bar per card from start to due date, grouped by list. Drag to reschedule. */
export function TimelineView({
  data,
  dispatch,
  editable,
  filters,
  meId,
  people,
  onOpenCard,
}: {
  data: BoardData;
  dispatch: (a: BoardActionBody) => void;
  editable: boolean;
  filters: Filters;
  meId: string;
  people: Map<string, Person>;
  onOpenCard: (id: string) => void;
}) {
  const [scale, setScale] = useState<Scale>('week');
  const [drag, setDragState] = useState<Drag | null>(null);
  // Mirror in a ref so a very quick press-and-release still sees the drag that just started.
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const scroller = useRef<HTMLDivElement>(null);
  const px = PX[scale];
  const today = localToday();

  const groups = useMemo(() => {
    return data.listOrder
      .filter((id) => !data.lists[id].archived)
      .map((id) => ({
        list: data.lists[id],
        cards: data.lists[id].cardIds.map((cid) => data.cards[cid]).filter((c): c is Card => !!c && matches(c, filters, meId)),
      }))
      .filter((g) => g.cards.length > 0);
  }, [data, filters, meId]);

  const span = (c: Card): [number, number] | null => {
    if (!c.start && !c.due) return null;
    const s = toDay(c.start ?? c.due!);
    const e = toDay(c.due ?? c.start!);
    return s <= e ? [s, e] : [e, s];
  };

  const scheduled = groups.map((g) => ({ ...g, cards: g.cards.filter((c) => span(c)) })).filter((g) => g.cards.length);
  const unscheduled = groups.flatMap((g) => g.cards.filter((c) => !span(c)).map((c) => ({ c, list: g.list.title })));

  // Visible range: everything scheduled plus some breathing room around today.
  const allDays = scheduled.flatMap((g) => g.cards.flatMap((c) => span(c)!));
  const min = Math.min(today - 7, ...allDays) - 3;
  const max = Math.max(today + (scale === 'month' ? 120 : 45), ...allDays) + 7;
  const days = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const width = days.length * px;

  // Start scrolled so today is near the left.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, (today - min - 3) * px);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // Month labels across the top.
  const months: { label: string; left: number; width: number }[] = [];
  for (const d of days) {
    const dt = dayDate(d);
    const label = dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const last = months[months.length - 1];
    if (last && last.label === label) last.width += px;
    else months.push({ label, left: (d - min) * px, width: px });
  }

  const onPointerDown = (e: React.PointerEvent, c: Card, mode: Drag['mode']) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* not a real pointer (e.g. synthetic) */
    }
    setDrag({ cardId: c.id, mode, x0: e.clientX, delta: 0, moved: false });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.x0) / px);
    if (delta !== drag.delta || (!drag.moved && Math.abs(e.clientX - drag.x0) > 3)) setDrag({ ...drag, delta, moved: drag.moved || Math.abs(e.clientX - drag.x0) > 3 });
  };
  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    const c = data.cards[drag.cardId];
    if (!drag.moved) onOpenCard(drag.cardId);
    else if (c && drag.delta !== 0) {
      const [s, e] = span(c)!;
      if (drag.mode === 'move') {
        const patch: Partial<Card> = {};
        if (c.start) patch.start = fromDay(toDay(c.start) + drag.delta);
        if (c.due) patch.due = fromDay(toDay(c.due) + drag.delta);
        dispatch({ type: 'UPDATE_CARD', cardId: c.id, patch, note: c.due ? `moved {card} to ${fromDay(e + drag.delta)}` : undefined });
      } else {
        const newEnd = Math.max(s, e + drag.delta);
        const patch: Partial<Card> = { due: fromDay(newEnd) };
        if (!c.start && newEnd !== s) patch.start = fromDay(s);
        dispatch({ type: 'UPDATE_CARD', cardId: c.id, patch, note: `set {card} due ${fromDay(newEnd)}` });
      }
    }
    setDrag(null);
  };

  const barColor = (c: Card) => {
    const l = data.labels.find((x) => x.id === c.labelIds[0]);
    return l ? LABEL_COLORS[l.color] : '#579dff';
  };

  let rowIndex = 0;
  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <div className="seg on-dark">
          {(['day', 'week', 'month'] as Scale[]).map((s) => (
            <button key={s} className={scale === s ? 'on' : ''} onClick={() => setScale(s)}>
              {s === 'day' ? 'Day' : s === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
        <button
          className="btn translucent"
          onClick={() => scroller.current?.scrollTo({ left: Math.max(0, (today - min - 3) * px), behavior: 'smooth' })}
        >
          Today
        </button>
        {editable && <span className="tl-hint">Drag a bar to move it · drag its right edge to change the due date</span>}
      </div>

      <div className="tl-frame">
        <div className="tl-scroll" ref={scroller} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}>
          <div className="tl-inner" style={{ width: width + 240 }}>
            {/* header */}
            <div className="tl-head">
              <div className="tl-corner">Card</div>
              <div className="tl-axis" style={{ width }}>
                <div className="tl-months">
                  {months.map((m) => (
                    <span key={m.label + m.left} style={{ left: m.left, width: m.width }}>
                      {m.width > 60 ? m.label : ''}
                    </span>
                  ))}
                </div>
                <div className="tl-days">
                  {days.map((d) => {
                    const dt = dayDate(d);
                    const dow = dt.getUTCDay();
                    const show = scale === 'day' || (scale === 'week' && (dow === 1 || px >= 28)) || (scale === 'month' && dt.getUTCDate() === 1);
                    return (
                      <span key={d} className={`${d === today ? 'today' : ''} ${dow === 0 || dow === 6 ? 'weekend' : ''}`} style={{ width: px }}>
                        {show ? (scale === 'day' ? `${['S', 'M', 'T', 'W', 'T', 'F', 'S'][dow]} ${dt.getUTCDate()}` : dt.getUTCDate()) : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* rows */}
            <div className="tl-body" style={{ backgroundSize: `${px * 7}px 100%` }}>
              <div className="tl-today" style={{ left: 240 + (today - min) * px + px / 2 }} />
              {scheduled.map((g) => (
                <div key={g.list.id}>
                  <div className="tl-group">
                    <span className="tl-group-name">{g.list.title}</span>
                    <span className="muted">{g.cards.length}</span>
                  </div>
                  {g.cards.map((c) => {
                    rowIndex++;
                    let [s, e] = span(c)!;
                    if (drag?.cardId === c.id && drag.moved) {
                      if (drag.mode === 'move') {
                        s += drag.delta;
                        e += drag.delta;
                      } else e = Math.max(s, e + drag.delta);
                    }
                    const assignee = c.assignees[0] ? people.get(c.assignees[0]) : undefined;
                    return (
                      <div key={c.id} className="tl-row" style={{ height: ROW }}>
                        <button className="tl-label" onClick={() => onOpenCard(c.id)} title={c.title}>
                          {c.completed && <span className="tl-done">✓</span>}
                          {c.title}
                        </button>
                        <div className="tl-lane" style={{ width }}>
                          <div
                            className={`tl-bar ${c.completed || c.dueDone ? 'done' : ''} ${drag?.cardId === c.id ? 'dragging' : ''}`}
                            style={{ left: (s - min) * px + 2, width: Math.max(px - 4, (e - s + 1) * px - 4), background: barColor(c) }}
                            onPointerDown={(ev) => onPointerDown(ev, c, 'move')}
                            title={`${c.title}\n${c.start ?? c.due} → ${c.due ?? c.start}`}
                          >
                            {assignee && <Avatar id={assignee.user_id} name={assignee.name} src={assignee.avatar_url} size={20} />}
                            <span className="tl-bar-text">{c.title}</span>
                            {editable && <span className="tl-resize" onPointerDown={(ev) => onPointerDown(ev, c, 'resize')} />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {rowIndex === 0 && <div className="tl-empty">No cards have dates yet. Give cards a start or due date to see them here.</div>}
            </div>
          </div>
        </div>
      </div>

      {unscheduled.length > 0 && (
        <details className="tl-unscheduled">
          <summary>Unscheduled ({unscheduled.length}) — cards without dates</summary>
          <ul>
            {unscheduled.map(({ c, list }) => (
              <li key={c.id}>
                <button className="link-btn" onClick={() => onOpenCard(c.id)}>
                  {c.title}
                </button>
                <span className="muted"> · {list}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
