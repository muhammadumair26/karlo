import { Plus, Timer, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { uid, type BoardActionBody } from '../lib/board';
import { cardTimeMs, entryMs, formatClock, formatDuration, parseDuration } from '../lib/time';
import type { Card, Me, Person } from '../lib/types';
import { Avatar } from './ui';

/** Current time, ticking every second while `live` is on (for running timers). */
export function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return now;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** "Time tracked" section of a card: totals per person, the log, and adding time by hand. */
export function CardTime({
  card,
  me,
  people,
  editable,
  isAdmin,
  dispatch,
}: {
  card: Card;
  me: Me;
  people: Person[];
  editable: boolean;
  isAdmin: boolean;
  dispatch: (a: BoardActionBody) => void;
}) {
  const entries = useMemo(() => card.time ?? [], [card.time]);
  const running = entries.some((t) => t.end === null);
  const now = useNow(running);
  const [adding, setAdding] = useState(false);
  const [dur, setDur] = useState('');
  const [date, setDate] = useState(todayIso);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const avatars = useMemo(() => new Map(people.map((p) => [p.user_id, p.avatar_url ?? null])), [people]);

  const total = cardTimeMs(card, now);
  const byPerson = useMemo(() => {
    const m = new Map<string, { name: string; ms: number; live: boolean }>();
    for (const t of entries) {
      const cur = m.get(t.userId) ?? { name: t.name, ms: 0, live: false };
      cur.ms += entryMs(t, now);
      cur.live ||= t.end === null;
      m.set(t.userId, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].ms - a[1].ms);
  }, [entries, now]);
  const sorted = [...entries].sort((a, b) => (b.end === null ? 1 : 0) - (a.end === null ? 1 : 0) || b.start - a.start);
  const shown = all ? sorted : sorted.slice(0, 5);

  const save = () => {
    const ms = parseDuration(dur);
    if (!ms) return setErr('Type how long, e.g. 45m, 1h 30m or 1.5h.');
    if (ms > 24 * 3_600_000) return setErr('That’s more than a day — split it into separate entries.');
    const [y, mo, d] = date.split('-').map(Number);
    const isToday = date === todayIso();
    const end = isToday ? Date.now() : new Date(y, mo - 1, d, 17, 0).getTime();
    if (end > Date.now() + 60_000) return setErr('The date can’t be in the future.');
    dispatch({ type: 'ADD_TIME', cardId: card.id, entry: { id: uid(), userId: me.id, name: me.name, start: end - ms, end, ...(note.trim() ? { note: note.trim() } : {}) } });
    setDur('');
    setNote('');
    setErr(null);
    setAdding(false);
  };

  return (
    <section className="cw-section ct">
      <div className="cw-section-head">
        <Timer size={20} />
        <h4>Time tracked</h4>
        {total > 0 && <span className={`ct-total ${running ? 'live' : ''}`}>{running ? formatClock(total) : formatDuration(total)}</span>}
      </div>

      <div className="cw-indent">
        {byPerson.length > 1 && (
          <div className="ct-people">
            {byPerson.map(([id, p]) => (
              <span key={id} className={`ct-person ${p.live ? 'live' : ''}`}>
                <Avatar id={id} name={p.name} src={avatars.get(id) ?? null} size={20} />
                {p.name.split(' ')[0]} <b>{formatDuration(p.ms)}</b>
              </span>
            ))}
          </div>
        )}

        {entries.length === 0 && !adding && <p className="muted ct-empty">No time yet. Start the timer above, or log time you’ve already spent.</p>}

        {shown.length > 0 && (
          <ul className="ct-list">
            {shown.map((t) => (
              <li key={t.id} className={t.end === null ? 'live' : ''}>
                <Avatar id={t.userId} name={t.name} src={avatars.get(t.userId) ?? null} size={26} />
                <div className="ct-what">
                  <span>
                    <b>{t.userId === me.id ? 'You' : t.name}</b>
                    {t.note && <> · {t.note}</>}
                  </span>
                  <small className="muted">{t.end === null ? `Running since ${when(t.start)}` : when(t.start)}</small>
                </div>
                <span className="ct-dur">{t.end === null ? formatClock(entryMs(t, now)) : formatDuration(entryMs(t, now))}</span>
                {editable && (t.userId === me.id || isAdmin) && (
                  <button className="icon-btn" title="Remove this time" aria-label="Remove this time" onClick={() => dispatch({ type: 'DELETE_TIME', cardId: card.id, entryId: t.id })}>
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {sorted.length > 5 && (
          <button className="btn ghost small ct-more" onClick={() => setAll(!all)}>
            {all ? 'Show less' : `Show all ${sorted.length}`}
          </button>
        )}

        {editable &&
          (adding ? (
            <form
              className="ct-form"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="ct-form-row">
                <input className="text-input" autoFocus placeholder="How long? e.g. 1h 30m" value={dur} onChange={(e) => (setDur(e.target.value), setErr(null))} aria-label="Duration" />
                <input className="text-input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
              </div>
              <input className="text-input" placeholder="What did you do? (optional)" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
              {err && <p className="error-text ct-err">{err}</p>}
              <div className="add-form-actions">
                <button className="btn primary" type="submit" disabled={!dur.trim()}>
                  Log time
                </button>
                <button className="btn ghost" type="button" onClick={() => (setAdding(false), setErr(null))}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button className="btn small ct-add" onClick={() => setAdding(true)}>
              <Plus size={14} /> Log time manually
            </button>
          ))}
      </div>
    </section>
  );
}

/** Floating "timer running" pill on the board, so a running timer is never forgotten. */
export function RunningTimer({
  cards,
  meId,
  hideCardId,
  onOpen,
  onStop,
}: {
  cards: Card[];
  meId: string;
  hideCardId: string | null;
  onOpen: (cardId: string) => void;
  onStop: (cardId: string) => void;
}) {
  const found = cards.map((c) => ({ c, t: (c.time ?? []).find((t) => t.userId === meId && t.end === null) })).find((x) => x.t);
  const now = useNow(!!found);
  if (!found?.t || found.c.id === hideCardId) return null;
  return (
    <div className="run-timer" role="status">
      <span className="run-dot" />
      <button className="run-open" onClick={() => onOpen(found.c.id)} title="Open this card">
        <span className="run-title">{found.c.title}</span>
        <span className="run-clock">{formatClock(now - found.t.start)}</span>
      </button>
      <button className="run-stop" onClick={() => onStop(found.c.id)} title="Stop timer" aria-label="Stop timer">
        <span className="run-square" />
      </button>
    </div>
  );
}
