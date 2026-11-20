import { AlertTriangle, CheckCircle2, Clock, Layers } from 'lucide-react';
import { useState } from 'react';
import { cardListId } from '../lib/board';
import type { Filters } from '../lib/filters';
import { dayDiff, dueStatus, matches } from '../lib/filters';
import type { BoardData, Card, Person } from '../lib/types';
import { LABEL_COLORS, PRIORITIES } from '../lib/types';

interface Bar {
  key: string;
  label: string;
  value: number;
  color?: string;
}

/** Horizontal bar chart: one series (no legend), value at the bar end, hover tooltip per bar. */
function BarChart({ title, bars, total, onPick }: { title: string; bars: Bar[]; total: number; onPick?: (key: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <section className="dash-card">
      <h4>{title}</h4>
      {bars.length === 0 && <p className="muted">Nothing to show yet.</p>}
      <div className="bars" role="table" aria-label={title}>
        {bars.map((b) => {
          const pct = total ? Math.round((b.value / total) * 100) : 0;
          return (
            <div
              key={b.key}
              className={`bar-row ${onPick ? 'clickable' : ''}`}
              role="row"
              onMouseEnter={() => setHover(b.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick?.(b.key)}
            >
              <span className="bar-label" role="cell" title={b.label}>
                {b.label}
              </span>
              <span className="bar-track" role="cell">
                <span className="bar-fill" style={{ width: `${Math.max(b.value ? 2 : 0, (b.value / max) * 100)}%`, background: b.color ?? '#579dff' }} />
                {hover === b.key && (
                  <span className="bar-tip">
                    <strong>{b.label}</strong>
                    <span>
                      {b.value} card{b.value === 1 ? '' : 's'} · {pct}%
                    </span>
                  </span>
                )}
              </span>
              <span className="bar-value" role="cell">
                {b.value}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardView({
  data,
  filters,
  meId,
  people,
  onFilter,
}: {
  data: BoardData;
  filters: Filters;
  meId: string;
  people: Map<string, Person>;
  onFilter: (patch: Partial<Filters>) => void;
}) {
  const cards: { c: Card; listId: string }[] = [];
  for (const c of Object.values(data.cards)) {
    const lid = cardListId(data, c.id);
    if (!lid || data.lists[lid]?.archived || !matches(c, filters, meId)) continue;
    cards.push({ c, listId: lid });
  }
  const total = cards.length;
  const completed = cards.filter(({ c }) => c.completed || c.dueDone).length;
  const overdue = cards.filter(({ c }) => dueStatus(c) === 'overdue').length;
  const week = cards.filter(({ c }) => c.due && !c.dueDone && dayDiff(c.due) >= 0 && dayDiff(c.due) <= 7).length;

  const perList: Bar[] = data.listOrder
    .filter((id) => !data.lists[id].archived)
    .map((id) => ({ key: id, label: data.lists[id].title, value: cards.filter((x) => x.listId === id).length }));

  const memberCounts = new Map<string, number>();
  let unassigned = 0;
  for (const { c } of cards) {
    if (c.assignees.length === 0 && c.guests.length === 0) unassigned++;
    for (const id of c.assignees) memberCounts.set(id, (memberCounts.get(id) ?? 0) + 1);
    for (const g of c.guests) memberCounts.set('guest:' + g, (memberCounts.get('guest:' + g) ?? 0) + 1);
  }
  const perMember: Bar[] = [...memberCounts.entries()]
    .map(([id, value]) => ({ key: id, label: id.startsWith('guest:') ? `${id.slice(6)} (imported)` : people.get(id)?.name ?? 'Former member', value }))
    .sort((a, b) => b.value - a.value);
  if (unassigned) perMember.push({ key: 'none', label: 'Unassigned', value: unassigned, color: '#a5adba' });

  const perLabel: Bar[] = data.labels
    .map((l) => ({ key: l.id, label: l.name || l.color, value: cards.filter(({ c }) => c.labelIds.includes(l.id)).length, color: LABEL_COLORS[l.color] }))
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value);

  // Status colours always come with words, never colour alone.
  const due: Bar[] = [
    { key: 'done', label: '✓ Complete', value: cards.filter(({ c }) => dueStatus(c) === 'done').length, color: '#1f845a' },
    { key: 'overdue', label: '⚠ Overdue', value: overdue, color: '#c9372c' },
    { key: 'soon', label: '⏱ Due soon', value: cards.filter(({ c }) => dueStatus(c) === 'soon').length, color: '#e2b203' },
    { key: 'later', label: 'Due later', value: cards.filter(({ c }) => dueStatus(c) === 'later').length, color: '#579dff' },
    { key: 'none', label: 'No due date', value: cards.filter(({ c }) => !c.due).length, color: '#a5adba' },
  ];

  const perPriority: Bar[] = PRIORITIES.map((p) => ({
    key: p.value,
    label: p.label,
    value: cards.filter(({ c }) => c.priority === p.value).length,
    color: p.color,
  })).filter((b) => b.value > 0);

  return (
    <div className="dashboard">
      <div className="stat-row">
        <div className="stat">
          <Layers size={18} />
          <span className="stat-num">{total}</span>
          <span className="stat-label">Cards</span>
        </div>
        <div className="stat good">
          <CheckCircle2 size={18} />
          <span className="stat-num">{completed}</span>
          <span className="stat-label">Completed{total ? ` · ${Math.round((completed / total) * 100)}%` : ''}</span>
        </div>
        <button className="stat bad" onClick={() => onFilter({ due: 'overdue' })} title="Show overdue cards">
          <AlertTriangle size={18} />
          <span className="stat-num">{overdue}</span>
          <span className="stat-label">Overdue</span>
        </button>
        <button className="stat warn" onClick={() => onFilter({ due: 'week' })} title="Show cards due in the next 7 days">
          <Clock size={18} />
          <span className="stat-num">{week}</span>
          <span className="stat-label">Due in 7 days</span>
        </button>
      </div>
      <div className="dash-grid">
        <BarChart title="Cards per list" bars={perList} total={total} />
        <BarChart title="Cards per member" bars={perMember} total={total} onPick={(k) => !k.startsWith('guest:') && onFilter({ assignee: k })} />
        <BarChart
          title="Due date status"
          bars={due}
          total={total}
          onPick={(k) => onFilter({ due: k === 'soon' || k === 'later' ? 'week' : (k as Filters['due']) })}
        />
        <BarChart title="Cards per label" bars={perLabel} total={total} onPick={(k) => onFilter({ labelId: k })} />
        {perPriority.length > 0 && (
          <BarChart title="Cards per priority" bars={perPriority} total={total} onPick={(k) => onFilter({ priority: k as Filters['priority'] })} />
        )}
      </div>
      <p className="dash-note">Click a bar or tile to filter. Numbers follow the active filters.</p>
    </div>
  );
}
