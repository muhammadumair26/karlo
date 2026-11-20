import { emptyBoard, newCard, normalize, uid } from './board';
import type { BoardData, Card, Label, Person, Priority } from './types';
import { LABEL_COLORS } from './types';

export interface ImportedBoard {
  title: string;
  color: string;
  data: BoardData;
}

export type ImportSource = 'trello' | 'clickup' | 'csv' | 'karlo';

// ------------------------------------------------------------------ CSV

/** RFC 4180 CSV parser (quotes, escaped quotes, newlines inside quotes, BOM). */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function toCSV(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = v === null || v === undefined ? '' : String(v);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

// ------------------------------------------------------------------ helpers

const pad = (n: number) => String(n).padStart(2, '0');

/** Accepts ISO strings, unix ms/seconds, and ClickUp-style "Friday, March 1st 2024". */
export function toDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  let d: Date | null = null;
  if (typeof v === 'number' || /^\d{9,13}$/.test(String(v).trim())) {
    const n = Number(v);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    const s = String(v)
      .trim()
      .replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s*/i, '')
      .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const t = Date.parse(s);
    if (!Number.isNaN(t)) d = new Date(t);
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function splitList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .replace(/^\[|\]$/g, '')
    .split(/[,;|]/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function toPriority(v: string | undefined): Priority {
  const s = (v ?? '').trim().toLowerCase();
  if (!s) return 'none';
  if (s.startsWith('urg') || s === '1') return 'urgent';
  if (s.startsWith('hi') || s === '2') return 'high';
  if (s.startsWith('norm') || s.startsWith('med') || s === '3') return 'medium';
  if (s.startsWith('lo') || s === '4') return 'low';
  return 'none';
}

const BOARD_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706'];

class Builder {
  data: BoardData = { ...emptyBoard(), labels: [] };
  private labelByName = new Map<string, string>();
  private listByName = new Map<string, string>();
  private colorIdx = 0;

  list(title: string, archived = false): string {
    const key = title.trim().toLowerCase() || '(no status)';
    const existing = this.listByName.get(key);
    if (existing) return existing;
    const id = uid();
    this.data.lists[id] = { id, title: title.trim() || 'No status', cardIds: [], archived };
    this.data.listOrder.push(id);
    this.listByName.set(key, id);
    return id;
  }

  label(name: string, color?: string): string {
    const key = `${name.trim().toLowerCase()}|${name ? '' : color}`;
    const existing = this.labelByName.get(key);
    if (existing) return existing;
    const keys = Object.keys(LABEL_COLORS);
    const c = color && LABEL_COLORS[color] ? color : keys[this.colorIdx++ % keys.length];
    const l: Label = { id: uid(), name: name.trim(), color: c };
    this.data.labels.push(l);
    this.labelByName.set(key, l.id);
    return l.id;
  }

  card(listId: string, title: string, extra: Partial<Card>, by = 'import') {
    const c = newCard(uid(), title || 'Untitled', by, extra.createdAt ?? Date.now(), extra);
    this.data.cards[c.id] = c;
    this.data.lists[listId].cardIds.push(c.id);
    return c;
  }

  done(title: string): ImportedBoard {
    if (this.data.labels.length === 0) this.data.labels = emptyBoard().labels;
    return { title, color: BOARD_COLORS[Math.floor(Math.random() * BOARD_COLORS.length)], data: normalize(this.data) };
  }
}

const footer = (source: string, names: string[]) =>
  names.length ? `\n\n— Imported from ${source}. Assigned to: ${names.join(', ')}` : '';

// ------------------------------------------------------------------ Trello

interface TrelloExport {
  name: string;
  prefs?: { backgroundColor?: string };
  lists: { id: string; name: string; closed: boolean; pos: number }[];
  cards: {
    id: string;
    name: string;
    desc: string;
    idList: string;
    closed: boolean;
    pos: number;
    due: string | null;
    start?: string | null;
    dueComplete?: boolean;
    idLabels: string[];
    idMembers?: string[];
    dateLastActivity?: string;
    attachments?: { name: string; url: string }[];
  }[];
  labels: { id: string; name: string; color: string | null }[];
  checklists?: { idCard: string; name: string; checkItems: { name: string; state: string; pos: number }[] }[];
  members?: { id: string; fullName: string; username: string }[];
  actions?: { type: string; date: string; data: { text?: string; card?: { id: string } }; memberCreator?: { fullName: string } }[];
}

export function importTrello(json: TrelloExport): ImportedBoard {
  if (!json || !Array.isArray(json.lists) || !Array.isArray(json.cards)) {
    throw new Error('This does not look like a Trello board export (missing lists/cards).');
  }
  const b = new Builder();
  const listMap = new Map<string, string>();
  for (const l of [...json.lists].sort((a, c) => a.pos - c.pos)) {
    const id = uid();
    b.data.lists[id] = { id, title: l.name, cardIds: [], archived: !!l.closed };
    b.data.listOrder.push(id);
    listMap.set(l.id, id);
  }
  const labelMap = new Map<string, string>();
  for (const l of json.labels ?? []) {
    const base = (l.color ?? 'gray').split('_')[0];
    const color = base === 'black' ? 'gray' : LABEL_COLORS[base] ? base : 'gray';
    const lab: Label = { id: uid(), name: l.name ?? '', color };
    b.data.labels.push(lab);
    labelMap.set(l.id, lab.id);
  }
  const members = new Map((json.members ?? []).map((m) => [m.id, m.fullName || m.username]));
  const checklistsByCard = new Map<string, NonNullable<TrelloExport['checklists']>>();
  for (const cl of json.checklists ?? []) checklistsByCard.set(cl.idCard, [...(checklistsByCard.get(cl.idCard) ?? []), cl]);
  const commentsByCard = new Map<string, { text: string; by: string; at: number }[]>();
  for (const a of json.actions ?? []) {
    if (a.type !== 'commentCard' || !a.data?.card?.id || !a.data.text) continue;
    const list = commentsByCard.get(a.data.card.id) ?? [];
    list.push({ text: a.data.text, by: a.memberCreator?.fullName ?? 'Trello user', at: Date.parse(a.date) || Date.now() });
    commentsByCard.set(a.data.card.id, list);
  }

  for (const c of [...json.cards].sort((a, d) => a.pos - d.pos)) {
    const listId = listMap.get(c.idList);
    if (!listId) continue;
    const checklist = (checklistsByCard.get(c.id) ?? []).flatMap((cl, _i, all) =>
      [...cl.checkItems]
        .sort((x, y) => x.pos - y.pos)
        .map((it) => ({ id: uid(), text: all.length > 1 ? `${cl.name}: ${it.name}` : it.name, done: it.state === 'complete' })),
    );
    const names = (c.idMembers ?? []).map((id) => members.get(id)).filter((n): n is string => !!n);
    b.card(listId, c.name, {
      description: (c.desc ?? '') + footer('Trello', names),
      due: toDate(c.due),
      start: toDate(c.start ?? null),
      dueDone: !!c.dueComplete,
      archived: !!c.closed,
      labelIds: c.idLabels.map((id) => labelMap.get(id)).filter((x): x is string => !!x),
      checklist,
      attachments: (c.attachments ?? [])
        .filter((a) => a.url)
        .map((a) => ({ id: uid(), name: a.name, url: a.url, addedAt: Date.now() })),
      comments: (commentsByCard.get(c.id) ?? [])
        .sort((x, y) => x.at - y.at)
        .map((cm) => ({ id: uid(), authorId: '', authorName: cm.by, text: cm.text, createdAt: cm.at })),
    });
  }
  const board = b.done(json.name || 'Trello board');
  if (json.prefs?.backgroundColor?.startsWith('#')) board.color = json.prefs.backgroundColor;
  return board;
}

// ------------------------------------------------------------------ ClickUp + generic CSV

const COLS = {
  title: ['task name', 'name', 'title', 'task', 'card name', 'card'],
  status: ['status', 'list', 'column', 'stage', 'state'],
  listName: ['list name', 'folder name', 'board', 'project'],
  description: ['task content', 'description', 'content', 'text content', 'notes', 'card description'],
  due: ['due date', 'due', 'deadline', 'due date text'],
  start: ['start date', 'start', 'start date text'],
  priority: ['priority'],
  tags: ['tags', 'labels', 'label', 'tag'],
  assignees: ['assignees', 'assignee', 'assigned to', 'members', 'owner'],
  checklist: ['checklists', 'checklist', 'subtasks'],
  comments: ['comments', 'comment'],
  completed: ['completed', 'done', 'complete'],
  created: ['date created', 'created', 'created at'],
};

function findCol(headers: string[], names: string[]) {
  const h = headers.map((x) => x.trim().toLowerCase());
  for (const n of names) {
    const i = h.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

function parseChecklist(v: string): { id: string; text: string; done: boolean }[] {
  if (!v.trim()) return [];
  try {
    const j = JSON.parse(v);
    const items: { id: string; text: string; done: boolean }[] = [];
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        if (typeof o.name === 'string' && ('resolved' in o || 'checked' in o || 'done' in o)) {
          items.push({ id: uid(), text: o.name, done: !!(o.resolved ?? o.checked ?? o.done) });
        } else Object.values(o).forEach(walk);
      }
    };
    walk(j);
    return items;
  } catch {
    return v
      .split(/\n|;/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ id: uid(), text: s.replace(/^\[(x| )\]\s*/i, ''), done: /^\[x\]/i.test(s) }));
  }
}

/** ClickUp CSV export, a Karlo CSV export, or any spreadsheet with a title column. */
export function importCSV(text: string, fileName: string, source: 'clickup' | 'csv'): ImportedBoard[] {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('The CSV file has no rows.');
  const [headers, ...body] = rows;
  const col = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, findCol(headers, names)])) as Record<keyof typeof COLS, number>;
  if (col.title === -1) {
    throw new Error(`Couldn't find a task name column. Found columns: ${headers.slice(0, 8).join(', ')}…`);
  }
  const get = (r: string[], k: keyof typeof COLS) => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '');
  const sourceName = source === 'clickup' ? 'ClickUp' : 'CSV';

  // One board per ClickUp list when the export spans several lists.
  const groups = new Map<string, string[][]>();
  for (const r of body) {
    const key = get(r, 'listName') || '';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const baseName = fileName.replace(/\.[^.]+$/, '');

  return [...groups.entries()].map(([group, rs]) => {
    const b = new Builder();
    for (const r of rs) {
      const title = get(r, 'title');
      if (!title) continue;
      const listId = b.list(get(r, 'status') || 'To Do');
      const names = splitList(get(r, 'assignees'));
      const completed = /^(true|yes|1|done|complete|completed)$/i.test(get(r, 'completed'));
      const commentsRaw = get(r, 'comments');
      b.card(listId, title, {
        description: get(r, 'description') + footer(sourceName, names),
        due: toDate(get(r, 'due')),
        start: toDate(get(r, 'start')),
        dueDone: completed,
        priority: toPriority(get(r, 'priority')),
        labelIds: splitList(get(r, 'tags')).map((t) => b.label(t)),
        checklist: parseChecklist(get(r, 'checklist')),
        comments: commentsRaw
          ? [{ id: uid(), authorId: '', authorName: `${sourceName} import`, text: commentsRaw, createdAt: Date.now() }]
          : [],
        createdAt: (() => {
          const d = toDate(get(r, 'created'));
          return d ? Date.parse(d) : Date.now();
        })(),
      });
    }
    // Put "done"-like statuses last, keep others in first-seen order.
    const isDone = (t: string) => /^(done|complete|completed|closed)$/i.test(t);
    b.data.listOrder.sort((x, y) => Number(isDone(b.data.lists[x].title)) - Number(isDone(b.data.lists[y].title)));
    return b.done(group ? group : baseName || `${sourceName} import`);
  });
}

// ------------------------------------------------------------------ Karlo backup

export interface KarloExport {
  app: 'karlo';
  format: 1;
  exportedAt: string;
  boards: ImportedBoard[];
}

export function importKarlo(json: KarloExport): ImportedBoard[] {
  if (json?.app !== 'karlo' || !Array.isArray(json.boards)) throw new Error('This is not a Karlo export file.');
  // Fresh ids aren't needed: board data ids are scoped to the board.
  return json.boards.map((b) => ({ title: b.title, color: b.color, data: normalize(b.data) }));
}

// ------------------------------------------------------------------ dispatcher

export async function importFiles(files: File[], source: ImportSource): Promise<ImportedBoard[]> {
  const out: ImportedBoard[] = [];
  for (const f of files) {
    const text = await f.text();
    const isJson = /^\s*[[{]/.test(text);
    try {
      if (source === 'trello') {
        if (!isJson) throw new Error('Trello imports need the JSON export file.');
        const j = JSON.parse(text);
        out.push(...(Array.isArray(j) ? j.map(importTrello) : [importTrello(j)]));
      } else if (source === 'karlo') {
        out.push(...importKarlo(JSON.parse(text)));
      } else {
        if (isJson) throw new Error('Please choose the CSV export file.');
        out.push(...importCSV(text, f.name, source));
      }
    } catch (e) {
      throw new Error(`${f.name}: ${(e as Error).message}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ export

export function boardToCSV(data: BoardData, people: Map<string, Person>): string {
  const labels = new Map(data.labels.map((l) => [l.id, l]));
  const rows: (string | number | boolean | null)[][] = [
    ['Title', 'List', 'Description', 'Labels', 'Assignees', 'Priority', 'Start Date', 'Due Date', 'Completed', 'Checklist', 'Comments', 'Archived', 'Created'],
  ];
  for (const lid of data.listOrder) {
    const l = data.lists[lid];
    for (const cid of l.cardIds) {
      const c = data.cards[cid];
      if (!c) continue;
      rows.push([
        c.title,
        l.title,
        c.description,
        c.labelIds.map((id) => labels.get(id)?.name || labels.get(id)?.color).filter(Boolean).join(', '),
        c.assignees.map((id) => people.get(id)?.name ?? id).join(', '),
        c.priority === 'none' ? '' : c.priority,
        c.start,
        c.due,
        c.dueDone,
        c.checklist.map((i) => `[${i.done ? 'x' : ' '}] ${i.text}`).join('\n'),
        c.comments.map((m) => `${m.authorName}: ${m.text}`).join('\n'),
        c.archived || l.archived,
        new Date(c.createdAt).toISOString().slice(0, 10),
      ]);
    }
  }
  return toCSV(rows);
}

export function karloExport(boards: ImportedBoard[]): string {
  const out: KarloExport = { app: 'karlo', format: 1, exportedAt: new Date().toISOString(), boards };
  return JSON.stringify(out, null, 2);
}
