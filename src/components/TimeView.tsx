import { Download, Timer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cardListId } from '../lib/board';
import { formatDuration } from '../lib/time';
import type { BoardData, Person } from '../lib/types';
import { useNow } from './CardTime';
import { Avatar, download } from './ui';

type Range = 'week' | 'lastweek' | 'month' | '30d' | 'all';
const RANGES: { id: Range; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'lastweek', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
];

const DAY = 86_400_000;
const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** Monday 00:00 of the week containing `ms`. */
const startOfWeek = (ms: number) => {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};
const addDays = (ms: number, n: number) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

function rangeBounds(r: Range, now: number, earliest: number): [number, number] {
  switch (r) {
    case 'week':
      return [startOfWeek(now), addDays(startOfWeek(now), 7)];
    case 'lastweek':
      return [addDays(startOfWeek(now), -7), startOfWeek(now)];
    case 'month': {
      const d = new Date(now);
      return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
    }
    case '30d':
      return [addDays(startOfDay(now), -29), addDays(startOfDay(now), 1)];
    default:
      return [startOfDay(earliest), addDays(startOfDay(now), 1)];
  }
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const hours = (ms: number) => (ms / 3_600_000).toFixed(2);
/** Short chart label: "45m", "2h", "6.5h". */
const short = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${Number((ms / 3_600_000).toFixed(1))}h`);

/** Board-wide time report: how much time went where, by person, card and day. */
export function TimeView({
  data,
  people,
  meId,
  onOpenCard,
}: {
  data: BoardData;
  people: Map<string, Person>;
  meId: string;
  onOpenCard: (cardId: string) => void;
}) {
  const [range, setRange] = useState<Range>('week');
  const [who, setWho] = useState<string>('');
  const cards = useMemo(() => Object.values(data.cards).filter((c) => (c.time ?? []).length > 0), [data.cards]);
  const running = cards.some((c) => c.time.some((t) => t.end === null));
  const now = useNow(running);

  const earliest = useMemo(() => Math.min(Date.now(), ...cards.flatMap((c) => c.time.map((t) => t.start))), [cards]);
  const [from, to] = rangeBounds(range, now, earliest);
  const everyone = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cards) for (const t of c.time) m.set(t.userId, people.get(t.userId)?.name ?? t.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [cards, people]);

  const r = useMemo(() => {
    const byPerson = new Map<string, { name: string; ms: number; live: boolean }>();
    const byCard = new Map<string, { ms: number; people: Set<string>; live: boolean }>();
    const rows: { start: number; ms: number; person: string; cardId: string; note: string }[] = [];
    let total = 0;
    for (const c of cards) {
      for (const t of c.time) {
        if (who && t.userId !== who) continue;
        const end = t.end ?? Math.max(t.start, now);
        const ms = overlap(t.start, end, from, to);
        if (ms <= 0) continue;
        total += ms;
        const name = people.get(t.userId)?.name ?? t.name;
        const p = byPerson.get(t.userId) ?? { name, ms: 0, live: false };
        p.ms += ms;
        p.live ||= t.end === null;
        byPerson.set(t.userId, p);
        const k = byCard.get(c.id) ?? { ms: 0, people: new Set<string>(), live: false };
        k.ms += ms;
        k.people.add(t.userId);
        k.live ||= t.end === null;
        byCard.set(c.id, k);
        rows.push({ start: Math.max(t.start, from), ms, person: name, cardId: c.id, note: t.note ?? '' });
      }
    }
    // Daily totals (only for ranges up to ~a month, where a day-by-day chart reads well).
    const days: { day: number; ms: number }[] = [];
    if ((to - from) / DAY <= 31.5) {
      for (let d = from; d < to; d = addDays(d, 1)) {
        const next = addDays(d, 1);
        let ms = 0;
        for (const c of cards)
          for (const t of c.time) {
            if (who && t.userId !== who) continue;
            ms += overlap(t.start, t.end ?? Math.max(t.start, now), d, next);
          }
        days.push({ day: d, ms });
      }
    }
    return {
      total,
      days,
      rows: rows.sort((a, b) => b.start - a.start),
      people: [...byPerson.entries()].sort((a, b) => b[1].ms - a[1].ms),
      cards: [...byCard.entries()].sort((a, b) => b[1].ms - a[1].ms),
    };
  }, [cards, who, from, to, now, people]);

  const maxDay = Math.max(1, ...r.days.map((d) => d.ms));
  const maxPerson = Math.max(1, ...r.people.map(([, p]) => p.ms));
  const maxCard = Math.max(1, ...r.cards.map(([, c]) => c.ms));
  const today = startOfDay(now);
  const daysWorked = r.days.filter((d) => d.ms > 0).length;

  const exportCsv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [['Date', 'Person', 'Card', 'List', 'Note', 'Minutes', 'Hours'].join(',')];
    for (const x of r.rows) {
      const c = data.cards[x.cardId];
      const list = data.lists[cardListId(data, x.cardId) ?? '']?.title ?? '';
      lines.push([new Date(x.start).toISOString().slice(0, 10), x.person, c?.title ?? '', list, x.note, String(Math.round(x.ms / 60000)), hours(x.ms)].map(esc).join(','));
    }
    download(`karlo-time-${range}.csv`, lines.join('\n'), 'text/csv');
  };

  return (
    <div className="tv-wrap time-view">
      <div className="tm-scroll">
        <div className="tm-head">
          <div className="tm-ranges" role="tablist">
            {RANGES.map((x) => (
              <button key={x.id} role="tab" aria-selected={range === x.id} className={range === x.id ? 'on' : ''} onClick={() => setRange(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
          <span className="header-spacer" />
          <select className="field-select tm-who" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person">
            <option value="">Everyone</option>
            {everyone.map(([id, name]) => (
              <option key={id} value={id}>
                {id === meId ? `${name} (you)` : name}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={exportCsv} disabled={!r.rows.length} title="Download as a spreadsheet (CSV)">
            <Download size={14} /> Export
          </button>
        </div>

        {cards.length === 0 ? (
          <div className="tm-empty">
            <Timer size={34} />
            <h3>No time tracked yet</h3>
            <p className="muted">Open a card and press “Start timer”, or log time you’ve already spent. It all adds up here.</p>
          </div>
        ) : (
          <>
            <div className="tm-stats">
              <div className="tm-stat">
                <span>Total time</span>
                <b>{formatDuration(r.total)}</b>
              </div>
              <div className="tm-stat">
                <span>Cards</span>
                <b>{r.cards.length}</b>
              </div>
              <div className="tm-stat">
                <span>People</span>
                <b>{r.people.length}</b>
              </div>
              {r.days.length > 0 && (
                <div className="tm-stat">
                  <span>Per working day</span>
                  <b>{daysWorked ? formatDuration(r.total / daysWorked) : '—'}</b>
                </div>
              )}
            </div>

            {r.days.length > 0 && (
              <section className="tm-card">
                <h4>By day</h4>
                <div className={`tm-chart ${r.days.length > 10 ? 'dense' : ''}`}>
                  {r.days.map((d) => (
                    <div key={d.day} className={`tm-col ${d.day === today ? 'today' : ''}`} title={`${new Date(d.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${d.ms ? formatDuration(d.ms) : 'no time'}`}>
                      <span className="tm-val">{d.ms ? short(d.ms) : ''}</span>
                      <div className="tm-bar-track">
                        <div className="tm-bar" style={{ height: `${(d.ms / maxDay) * 100}%` }} />
                      </div>
                      <span className="tm-day">
                        {r.days.length > 10 ? new Date(d.day).getDate() : new Date(d.day).toLocaleDateString(undefined, { weekday: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {r.total === 0 ? (
              <p className="muted tm-none">No time in this period{who ? ' for this person' : ''}.</p>
            ) : (
              <div className="tm-grid">
                <section className="tm-card">
                  <h4>By person</h4>
                  <ul className="tm-rows">
                    {r.people.map(([id, p]) => (
                      <li key={id}>
                        <Avatar id={id} name={p.name} src={people.get(id)?.avatar_url ?? null} size={28} />
                        <div className="tm-row-main">
                          <div className="tm-row-top">
                            <span className="tm-name">
                              {p.name}
                              {p.live && <span className="tm-live" title="Timer running" />}
                            </span>
                            <b>{formatDuration(p.ms)}</b>
                          </div>
                          <div className="tm-meter">
                            <div style={{ width: `${(p.ms / maxPerson) * 100}%` }} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="tm-card">
                  <h4>By card</h4>
                  <ul className="tm-rows">
                    {r.cards.map(([id, k]) => {
                      const c = data.cards[id];
                      const list = data.lists[cardListId(data, id) ?? '']?.title;
                      return (
                        <li key={id}>
                          <div className="tm-row-main">
                            <div className="tm-row-top">
                              <button className="tm-card-link" onClick={() => onOpenCard(id)}>
                                {c?.title ?? 'Card'}
                                {k.live && <span className="tm-live" title="Timer running" />}
                              </button>
                              <b>{formatDuration(k.ms)}</b>
                            </div>
                            <div className="tm-meter">
                              <div style={{ width: `${(k.ms / maxCard) * 100}%` }} />
                            </div>
                            <small className="muted">
                              {list ? `${list} · ` : ''}
                              {[...k.people].map((u) => (people.get(u)?.name ?? c?.time.find((t) => t.userId === u)?.name ?? '').split(' ')[0]).join(', ')}
                            </small>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
