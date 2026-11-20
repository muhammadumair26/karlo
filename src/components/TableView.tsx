import { useState } from 'react';
import { cardListId } from '../lib/board';
import type { Filters } from '../lib/filters';
import { dueStatus, formatDate, matches } from '../lib/filters';
import type { BoardData, Card, Person } from '../lib/types';
import { LABEL_COLORS, PRIORITIES } from '../lib/types';
import { AvatarStack } from './ui';

type SortKey = 'title' | 'list' | 'priority' | 'due' | 'assignees' | 'created';

const PRIO_ORDER = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

export function TableView({
  data,
  filters,
  meId,
  people,
  onOpenCard,
}: {
  data: BoardData;
  filters: Filters;
  meId: string;
  people: Map<string, Person>;
  onOpenCard: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'list', dir: 1 });
  const labels = new Map(data.labels.map((l) => [l.id, l]));
  const listIndex = new Map(data.listOrder.map((id, i) => [id, i]));

  const rows = Object.values(data.cards)
    .filter((c) => matches(c, filters, meId))
    .map((c) => {
      const lid = cardListId(data, c.id);
      const list = lid ? data.lists[lid] : undefined;
      return { c, list, pos: list ? list.cardIds.indexOf(c.id) : 0 };
    })
    .filter((r) => r.list && !r.list.archived);

  const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]): number => {
    const x: Card = a.c;
    const y: Card = b.c;
    switch (sort.key) {
      case 'title':
        return x.title.localeCompare(y.title);
      case 'list':
        return (listIndex.get(a.list!.id)! - listIndex.get(b.list!.id)!) || a.pos - b.pos;
      case 'priority':
        return PRIO_ORDER[x.priority] - PRIO_ORDER[y.priority];
      case 'due':
        return (x.due ?? '9999').localeCompare(y.due ?? '9999');
      case 'assignees':
        return (people.get(x.assignees[0])?.name ?? '~').localeCompare(people.get(y.assignees[0])?.name ?? '~');
      case 'created':
        return x.createdAt - y.createdAt;
    }
  };
  rows.sort((a, b) => cmp(a, b) * sort.dir);

  const th = (key: SortKey, label: string) => (
    <th>
      <button className="th-btn" onClick={() => setSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : 1 })}>
        {label} {sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}
      </button>
    </th>
  );

  return (
    <div className="table-wrap">
      <table className="card-table">
        <thead>
          <tr>
            {th('title', 'Task')}
            {th('list', 'Status')}
            {th('assignees', 'Assignees')}
            <th>Labels</th>
            {th('priority', 'Priority')}
            {th('due', 'Due')}
            <th>Checklist</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, list }) => {
            const prio = PRIORITIES.find((p) => p.value === c.priority)!;
            const done = c.checklist.filter((i) => i.done).length;
            return (
              <tr key={c.id} onClick={() => onOpenCard(c.id)}>
                <td className="t-title">{c.title}</td>
                <td>
                  <span className="status-pill">{list!.title}</span>
                </td>
                <td>
                  <AvatarStack ids={c.assignees} people={people} size={22} max={4} />
                </td>
                <td>
                  <div className="t-labels">
                    {c.labelIds.map((id) => {
                      const l = labels.get(id);
                      return l ? (
                        <span key={id} className="label-chip-sm" style={{ background: LABEL_COLORS[l.color] }}>
                          {l.name || ' '}
                        </span>
                      ) : null;
                    })}
                  </div>
                </td>
                <td style={{ color: prio.color }}>{c.priority === 'none' ? '—' : `⚑ ${prio.label}`}</td>
                <td>{c.due ? <span className={`badge due-${dueStatus(c)}`}>{formatDate(c.due)}</span> : '—'}</td>
                <td>{c.checklist.length ? `${done}/${c.checklist.length}` : '—'}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted empty-row">
                No cards to show.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
