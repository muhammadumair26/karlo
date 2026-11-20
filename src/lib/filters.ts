import type { Card, Priority } from './types';

export interface Filters {
  text: string;
  assignee: string; // '' | 'me' | 'none' | userId
  labelId: string;
  priority: Priority | '';
  due: '' | 'overdue' | 'week' | 'none' | 'done';
}

export const NO_FILTERS: Filters = { text: '', assignee: '', labelId: '', priority: '', due: '' };

export const hasFilters = (f: Filters) => !!(f.text || f.assignee || f.labelId || f.priority || f.due);

export function dayDiff(date: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(date + 'T00:00:00').getTime() - today.getTime()) / 86400000);
}

export function dueStatus(c: Pick<Card, 'due' | 'dueDone'>): 'done' | 'overdue' | 'soon' | 'later' | null {
  if (!c.due) return null;
  if (c.dueDone) return 'done';
  const d = dayDiff(c.due);
  if (d < 0) return 'overdue';
  if (d <= 1) return 'soon';
  return 'later';
}

export function formatDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function matches(c: Card, f: Filters, meId: string) {
  if (c.archived) return false;
  if (f.text) {
    const q = f.text.toLowerCase();
    if (!c.title.toLowerCase().includes(q) && !c.description.toLowerCase().includes(q)) return false;
  }
  if (f.assignee === 'me' && !c.assignees.includes(meId)) return false;
  if (f.assignee === 'owned' && !(c.owners ?? []).includes(meId)) return false;
  if (f.assignee === 'none' && c.assignees.length > 0) return false;
  if (f.assignee && !['me', 'none', 'owned'].includes(f.assignee) && !c.assignees.includes(f.assignee)) return false;
  if (f.labelId && !c.labelIds.includes(f.labelId)) return false;
  if (f.priority && c.priority !== f.priority) return false;
  if (f.due) {
    const s = dueStatus(c);
    if (f.due === 'none' && c.due) return false;
    if (f.due === 'overdue' && s !== 'overdue') return false;
    if (f.due === 'done' && s !== 'done') return false;
    if (f.due === 'week' && (!c.due || c.dueDone || dayDiff(c.due) < 0 || dayDiff(c.due) > 7)) return false;
  }
  return true;
}
