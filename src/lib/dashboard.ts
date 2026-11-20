import { cardListId } from './board';
import type { Filters } from './filters';
import { dueStatus, matches } from './filters';
import type { BoardData, Card, DashboardMetric, DashboardTile, Person } from './types';
import { LABEL_COLORS, PRIORITIES } from './types';

/** Validated categorical order (see dataviz palette): fixed, never cycled; 9th+ folds into "Other". */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const OTHER = '#a5adba';

export const METRICS: { id: DashboardMetric; label: string }[] = [
  { id: 'list', label: 'Cards per list' },
  { id: 'label', label: 'Cards per label' },
  { id: 'member', label: 'Cards per member' },
  { id: 'due', label: 'Cards per due date' },
  { id: 'priority', label: 'Cards per priority' },
  { id: 'status', label: 'Completed vs open' },
];

export const DEFAULT_TILES: DashboardTile[] = [
  { id: 'd-list', metric: 'list', chart: 'bar' },
  { id: 'd-member', metric: 'member', chart: 'bar' },
  { id: 'd-due', metric: 'due', chart: 'pie' },
  { id: 'd-label', metric: 'label', chart: 'bar' },
];

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Active (not archived, not in an archived list) cards that pass the filters. */
export function activeCards(data: BoardData, filters: Filters, meId: string) {
  const out: { c: Card; listId: string }[] = [];
  for (const c of Object.values(data.cards)) {
    const lid = cardListId(data, c.id);
    if (!lid || data.lists[lid]?.archived || !matches(c, filters, meId)) continue;
    out.push({ c, listId: lid });
  }
  return out;
}

/** Category buckets a card falls in for a metric (a card can be in several labels/members). */
function categoriesOf(metric: DashboardMetric, c: Card, listId: string): string[] {
  switch (metric) {
    case 'list':
      return [listId];
    case 'label':
      return c.labelIds.length ? c.labelIds : ['__none'];
    case 'member': {
      const ids = [...c.assignees, ...c.guests.map((g) => 'guest:' + g)];
      return ids.length ? ids : ['__none'];
    }
    case 'due':
      return [dueStatus(c) ?? 'none'];
    case 'priority':
      return [c.priority];
    case 'status':
      return [c.completed || c.dueDone ? 'done' : 'open'];
  }
}

const DUE_META: Record<string, { label: string; color: string }> = {
  done: { label: '✓ Complete', color: '#1f845a' },
  overdue: { label: '⚠ Overdue', color: '#c9372c' },
  soon: { label: '⏱ Due soon', color: '#e2b203' },
  later: { label: 'Due later', color: '#2a78d6' },
  none: { label: 'No due date', color: OTHER },
};

/** Ordered category list for a metric, with stable colours (colour follows the entity, not its rank). */
export function categories(metric: DashboardMetric, data: BoardData, people: Map<string, Person>): { key: string; label: string; color: string }[] {
  switch (metric) {
    case 'list':
      return data.listOrder
        .filter((id) => !data.lists[id].archived)
        .map((id, i) => ({ key: id, label: data.lists[id].title, color: SERIES[i] ?? OTHER }));
    case 'label':
      return [
        ...data.labels.map((l) => ({ key: l.id, label: l.name || l.color, color: LABEL_COLORS[l.color] ?? OTHER })),
        { key: '__none', label: 'No label', color: OTHER },
      ];
    case 'member': {
      const ids = new Set<string>();
      for (const c of Object.values(data.cards)) {
        c.assignees.forEach((id) => ids.add(id));
        c.guests.forEach((g) => ids.add('guest:' + g));
      }
      const sorted = [...ids].sort((a, b) => nameOf(a, people).localeCompare(nameOf(b, people)));
      return [
        ...sorted.map((id, i) => ({ key: id, label: nameOf(id, people), color: SERIES[i] ?? OTHER })),
        { key: '__none', label: 'Unassigned', color: OTHER },
      ];
    }
    case 'due':
      return Object.entries(DUE_META).map(([key, m]) => ({ key, ...m }));
    case 'priority':
      return PRIORITIES.map((p) => ({ key: p.value, label: p.label, color: p.value === 'none' ? OTHER : p.color }));
    case 'status':
      return [
        { key: 'open', label: 'Open', color: '#2a78d6' },
        { key: 'done', label: '✓ Completed', color: '#1f845a' },
      ];
  }
}

const nameOf = (id: string, people: Map<string, Person>) =>
  id.startsWith('guest:') ? `${id.slice(6)} (imported)` : people.get(id)?.name ?? 'Former member';

/** Counts per category right now (bar / pie). Categories with 0 are dropped except for lists and status. */
export function slices(metric: DashboardMetric, data: BoardData, filters: Filters, meId: string, people: Map<string, Person>): Slice[] {
  const counts = new Map<string, number>();
  for (const { c, listId } of activeCards(data, filters, meId)) {
    for (const k of categoriesOf(metric, c, listId)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const keepZero = metric === 'list' || metric === 'status';
  return categories(metric, data, people)
    .map((cat) => ({ ...cat, value: counts.get(cat.key) ?? 0 }))
    .filter((s) => keepZero || s.value > 0);
}

/** For pies: more than 8 categories fold into "Other" (no generated 9th colour). */
export function foldForPie(s: Slice[]): Slice[] {
  const nonZero = s.filter((x) => x.value > 0);
  if (nonZero.length <= 8) return nonZero;
  const sorted = [...nonZero].sort((a, b) => b.value - a.value);
  const keep = sorted.slice(0, 7);
  const rest = sorted.slice(7).reduce((n, x) => n + x.value, 0);
  return [...keep, { key: '__other', label: 'Other', value: rest, color: OTHER }];
}

// ---------------------------------------------------------------- line charts (history)

const DAY = 86400000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export interface Series {
  key: string;
  label: string;
  color: string;
  points: number[]; // one per day
}

/**
 * Cards per category at the end of each day over the last N days.
 * A card counts from the day it was created. For lists, the card's list on each day is rebuilt
 * from the board's move history ("moved … from A to B"); other metrics use the card's current value.
 */
export function history(
  metric: DashboardMetric,
  days: number,
  data: BoardData,
  filters: Filters,
  meId: string,
  people: Map<string, Person>,
): { days: number[]; series: Series[] } {
  const today = startOfDay(Date.now());
  const dayStarts = Array.from({ length: days }, (_, i) => today - (days - 1 - i) * DAY);
  const cats = categories(metric, data, people);
  const listIdByTitle = new Map(data.listOrder.map((id) => [data.lists[id].title, id]));

  // Moves per card, newest first.
  const moves = new Map<string, { at: number; from: string; to: string }[]>();
  if (metric === 'list') {
    for (const a of data.activity) {
      if (!a.cardId) continue;
      const m = a.text.match(/^moved “.*” from (.+) to (.+)$/);
      if (!m) continue;
      const from = listIdByTitle.get(m[1]);
      const to = listIdByTitle.get(m[2]);
      if (!from || !to) continue;
      moves.set(a.cardId, [...(moves.get(a.cardId) ?? []), { at: a.at, from, to }]);
    }
  }

  const counts = new Map<string, number[]>(cats.map((c) => [c.key, dayStarts.map(() => 0)]));
  for (const { c, listId } of activeCards(data, filters, meId)) {
    const cardMoves = (moves.get(c.id) ?? []).sort((x, y) => y.at - x.at);
    dayStarts.forEach((ds, i) => {
      const end = ds + DAY - 1;
      if (c.createdAt > end) return; // didn't exist yet
      let ks: string[];
      if (metric === 'list') {
        // Undo moves that happened after this day.
        let where = listId;
        for (const mv of cardMoves) if (mv.at > end && mv.to === where) where = mv.from;
        ks = [where];
      } else ks = categoriesOf(metric, c, listId);
      for (const k of ks) {
        const arr = counts.get(k);
        if (arr) arr[i]++;
      }
    });
  }

  let series: Series[] = cats
    .map((c) => ({ key: c.key, label: c.label, color: c.color, points: counts.get(c.key)! }))
    .filter((s) => s.points.some((v) => v > 0));
  // Line charts: max 8 coloured series; the rest fold into "Other".
  if (series.length > 8) {
    const sorted = [...series].sort((a, b) => b.points[b.points.length - 1] - a.points[a.points.length - 1]);
    const keep = sorted.slice(0, 7);
    const rest = sorted.slice(7);
    series = [...keep, { key: '__other', label: 'Other', color: OTHER, points: dayStarts.map((_, i) => rest.reduce((n, s) => n + s.points[i], 0)) }];
  }
  return { days: dayStarts, series };
}

export const metricLabel = (m: DashboardMetric) => METRICS.find((x) => x.id === m)?.label ?? m;
