import type { Activity, Attachment, BoardData, Card, Comment, CustomField, DashboardTile, FieldValue, Label, List, BoardSettings, AutomationRule, TimeEntry } from './types';
import { formatDuration } from './time';

export const uid = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(36).slice(2, 10) + Date.now().toString(36));

export function emptyBoard(): BoardData {
  return {
    lists: {},
    listOrder: [],
    cards: {},
    labels: [
      { id: uid(), name: 'Feature', color: 'green' },
      { id: uid(), name: 'Bug', color: 'red' },
      { id: uid(), name: 'Design', color: 'purple' },
      { id: uid(), name: 'Urgent', color: 'orange' },
    ],
    activity: [],
    background: null,
    dashboard: null,
  };
}

export function starterBoard(): BoardData {
  const d = emptyBoard();
  for (const t of ['To Do', 'In Progress', 'Review', 'Done']) {
    const id = uid();
    d.lists[id] = { id, title: t, cardIds: [], archived: false };
    d.listOrder.push(id);
  }
  return d;
}

export function newCard(id: string, title: string, by: string, at: number, extra: Partial<Card> = {}): Card {
  return {
    id,
    title,
    description: '',
    labelIds: [],
    assignees: [],
    owners: /^[0-9a-f-]{36}$/i.test(by) ? [by] : [],
    guests: [],
    completed: false,
    priority: 'none',
    start: null,
    due: null,
    dueDone: false,
    checklist: [],
    comments: [],
    attachments: [],
    location: null,
    cover: null,
    time: [],
    archived: false,
    createdAt: at,
    createdBy: by,
    ...extra,
  };
}

/** Fill in defaults so older or imported data never crashes the UI. */
// Older imports wrote people into the description; move them to `guests`.
const IMPORT_FOOTER = /\n*— Imported from (?:Trello|ClickUp|CSV)\. Assigned to: (.+)$/;

export function normalize(raw: unknown): BoardData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<BoardData>;
  const lists: Record<string, List> = {};
  for (const [id, l] of Object.entries(d.lists ?? {})) {
    lists[id] = { id, title: l.title ?? 'Untitled', cardIds: Array.isArray(l.cardIds) ? l.cardIds : [], archived: !!l.archived, ...(l.protected ? { protected: true } : {}), ...(l.requireDue ? { requireDue: true } : {}) };
  }
  const cards: Record<string, Card> = {};
  for (const [id, c] of Object.entries(d.cards ?? {})) {
    let description = c.description ?? '';
    let guests = c.guests ?? [];
    const m = description.match(IMPORT_FOOTER);
    if (m) {
      description = description.slice(0, m.index).trimEnd();
      guests = [...new Set([...guests, ...m[1].split(',').map((x) => x.trim()).filter(Boolean)])];
    }
    cards[id] = newCard(id, c.title ?? 'Untitled', c.createdBy ?? '', c.createdAt ?? Date.now(), {
      ...c,
      guests,
      owners: Array.isArray(c.owners) ? c.owners : c.createdBy && /^[0-9a-f-]{36}$/i.test(c.createdBy) ? [c.createdBy] : [],
      completed: !!c.completed,
      labelIds: c.labelIds ?? [],
      assignees: c.assignees ?? [],
      checklist: c.checklist ?? [],
      comments: c.comments ?? [],
      attachments: c.attachments ?? [],
      location: c.location && typeof c.location.lat === 'number' ? c.location : null,
      cover: c.cover && (c.attachments ?? []).some((x) => x.id === c.cover) ? c.cover : null,
      priority: c.priority ?? 'none',
      time: Array.isArray(c.time) ? c.time.filter((t) => t && typeof t.start === 'number') : [],
      ...(c.fields && typeof c.fields === 'object' ? { fields: c.fields } : {}),
      description,
      archived: !!c.archived,
      dueDone: !!c.dueDone,
      start: c.start ?? null,
      due: c.due ?? null,
    });
  }
  const listOrder = (d.listOrder ?? Object.keys(lists)).filter((id) => lists[id]);
  for (const l of Object.values(lists)) l.cardIds = l.cardIds.filter((id) => cards[id]);
  return { lists, listOrder, cards, labels: d.labels ?? [], activity: d.activity ?? [], background: d.background ?? null, dashboard: Array.isArray(d.dashboard) ? d.dashboard : null, ...(d.settings && typeof d.settings === 'object' ? { settings: d.settings } : {}), ...(Array.isArray(d.automations) ? { automations: d.automations } : {}), ...(Array.isArray(d.customFields) ? { customFields: d.customFields } : {}) };
}

// ------------------------------------------------------------------ actions

export interface ActionMeta {
  id: string;
  at: number;
  by: { id: string; name: string };
}

export type BoardActionBody =
  | { type: 'ADD_LIST'; listId: string; title: string }
  | { type: 'RENAME_LIST'; listId: string; title: string }
  | { type: 'ARCHIVE_LIST'; listId: string; archived: boolean }
  | { type: 'DELETE_LIST'; listId: string }
  | { type: 'MOVE_LIST'; listId: string; toIndex: number }
  | { type: 'ADD_CARD'; listId: string; cardId: string; title: string; due?: string | null; assignees?: string[] }
  | { type: 'UPDATE_CARD'; cardId: string; patch: Partial<Card>; note?: string }
  | { type: 'MOVE_CARD'; cardId: string; toListId: string; toIndex: number }
  | { type: 'DELETE_CARD'; cardId: string }
  | { type: 'ADD_COMMENT'; cardId: string; comment: Comment }
  | { type: 'DELETE_COMMENT'; cardId: string; commentId: string }
  | { type: 'SET_LABELS'; labels: Label[] }
  | { type: 'ADD_ATTACHMENTS'; cardId: string; attachments: Attachment[]; autoCover?: boolean }
  | { type: 'DELETE_ATTACHMENT'; cardId: string; attachmentId: string }
  | { type: 'SET_BACKGROUND'; url: string | null }
  | { type: 'SET_DASHBOARD'; tiles: DashboardTile[] }
  | { type: 'SET_SETTINGS'; settings: BoardSettings; note?: string }
  | { type: 'SET_AUTOMATIONS'; rules: AutomationRule[]; note?: string }
  | { type: 'SET_LIST_RULES'; listId: string; rules: { protected?: boolean; requireDue?: boolean } }
  | { type: 'MAP_GUEST'; name: string; userId: string | null }
  /** Replaces the board's custom field definitions (values of removed fields are dropped). */
  | { type: 'SET_FIELDS'; fields: CustomField[]; note?: string }
  /** Sets one custom field on one card; null clears it. */
  | { type: 'SET_FIELD_VALUE'; cardId: string; fieldId: string; value: FieldValue | null }
  /** Starts my timer on a card (stopping any other timer of mine on this board). */
  | { type: 'TIMER_START'; cardId: string; entryId: string }
  /** Stops my running timer on a card. */
  | { type: 'TIMER_STOP'; cardId: string }
  | { type: 'ADD_TIME'; cardId: string; entry: TimeEntry }
  | { type: 'DELETE_TIME'; cardId: string; entryId: string };

export type BoardAction = BoardActionBody & { meta: ActionMeta };

const MAX_ACTIVITY = 300;

function log(d: BoardData, a: BoardAction, text: string, cardId?: string, attachmentId?: string): Activity[] {
  const entry: Activity = { id: a.meta.id + (attachmentId ? ':' + attachmentId : ''), at: a.meta.at, by: a.meta.by.name, text, cardId, attachmentId };
  return [entry, ...d.activity].slice(0, MAX_ACTIVITY);
}

function listOf(d: BoardData, cardId: string): List | undefined {
  return Object.values(d.lists).find((l) => l.cardIds.includes(cardId));
}

/**
 * Pure and deterministic (ids and timestamps come from the action), so pending
 * local actions can be replayed on top of a newer server copy when two people edit at once.
 */
export function boardReducer(d: BoardData, a: BoardAction): BoardData {
  switch (a.type) {
    case 'ADD_LIST': {
      if (d.lists[a.listId]) return d;
      return {
        ...d,
        lists: { ...d.lists, [a.listId]: { id: a.listId, title: a.title, cardIds: [], archived: false } },
        listOrder: [...d.listOrder, a.listId],
        activity: log(d, a, `added list “${a.title}”`),
      };
    }
    case 'RENAME_LIST': {
      const l = d.lists[a.listId];
      if (!l) return d;
      return { ...d, lists: { ...d.lists, [l.id]: { ...l, title: a.title } }, activity: log(d, a, `renamed list “${l.title}” to “${a.title}”`) };
    }
    case 'ARCHIVE_LIST': {
      const l = d.lists[a.listId];
      if (!l || (l.protected && a.archived)) return d; // protected lists stay
      return {
        ...d,
        lists: { ...d.lists, [l.id]: { ...l, archived: a.archived } },
        activity: log(d, a, `${a.archived ? 'archived' : 'restored'} list “${l.title}”`),
      };
    }
    case 'DELETE_LIST': {
      const l = d.lists[a.listId];
      if (!l || l.protected) return d; // protected lists can't be deleted
      const lists = { ...d.lists };
      const cards = { ...d.cards };
      for (const cid of l.cardIds) delete cards[cid];
      delete lists[a.listId];
      return { ...d, lists, cards, listOrder: d.listOrder.filter((id) => id !== a.listId), activity: log(d, a, `deleted list “${l.title}”`) };
    }
    case 'MOVE_LIST': {
      const from = d.listOrder.indexOf(a.listId);
      if (from === -1) return d;
      const ids = [...d.listOrder];
      ids.splice(from, 1);
      const to = Math.max(0, Math.min(ids.length, from < a.toIndex ? a.toIndex - 1 : a.toIndex));
      ids.splice(to, 0, a.listId);
      return { ...d, listOrder: ids };
    }
    case 'ADD_CARD': {
      const l = d.lists[a.listId];
      if (!l || d.cards[a.cardId]) return d;
      const c = newCard(a.cardId, a.title, a.meta.by.id, a.meta.at, { ...(a.due ? { due: a.due } : {}), ...(a.assignees?.length ? { assignees: a.assignees } : {}) });
      return {
        ...d,
        cards: { ...d.cards, [c.id]: c },
        lists: { ...d.lists, [l.id]: { ...l, cardIds: [...l.cardIds, c.id] } },
        activity: log(d, a, `added “${a.title}” to ${l.title}`, c.id),
      };
    }
    case 'UPDATE_CARD': {
      const c = d.cards[a.cardId];
      if (!c) return d;
      // Ownership is fixed: the creator owns the card, and who/when it was created never changes.
      const { owners: _o, createdBy: _b, createdAt: _t, ...patch } = a.patch;
      if (Object.keys(patch).length === 0) return d;
      return {
        ...d,
        cards: { ...d.cards, [c.id]: { ...c, ...patch } },
        activity: a.note ? log(d, a, a.note.replace('{card}', `“${c.title}”`), c.id) : d.activity,
      };
    }
    case 'MOVE_CARD': {
      const from = listOf(d, a.cardId);
      const toList = d.lists[a.toListId];
      if (!from || !toList) return d;
      const lists = { ...d.lists };
      const fromIds = [...from.cardIds];
      const fromIndex = fromIds.indexOf(a.cardId);
      fromIds.splice(fromIndex, 1);
      if (from.id === toList.id) {
        const to = Math.max(0, Math.min(fromIds.length, fromIndex < a.toIndex ? a.toIndex - 1 : a.toIndex));
        fromIds.splice(to, 0, a.cardId);
        lists[from.id] = { ...from, cardIds: fromIds };
        return { ...d, lists };
      }
      lists[from.id] = { ...from, cardIds: fromIds };
      const toIds = [...toList.cardIds];
      toIds.splice(Math.max(0, Math.min(toIds.length, a.toIndex)), 0, a.cardId);
      lists[toList.id] = { ...toList, cardIds: toIds };
      const title = d.cards[a.cardId]?.title ?? 'card';
      return { ...d, lists, activity: log(d, a, `moved “${title}” from ${from.title} to ${toList.title}`, a.cardId) };
    }
    case 'DELETE_CARD': {
      const c = d.cards[a.cardId];
      if (!c) return d;
      const cards = { ...d.cards };
      delete cards[a.cardId];
      const l = listOf(d, a.cardId);
      const lists = l ? { ...d.lists, [l.id]: { ...l, cardIds: l.cardIds.filter((id) => id !== a.cardId) } } : d.lists;
      return { ...d, cards, lists, activity: log(d, a, `deleted “${c.title}”`) };
    }
    case 'ADD_COMMENT': {
      const c = d.cards[a.cardId];
      if (!c || c.comments.some((x) => x.id === a.comment.id)) return d;
      return {
        ...d,
        cards: { ...d.cards, [c.id]: { ...c, comments: [...c.comments, a.comment] } },
        activity: log(d, a, `commented on “${c.title}”`, c.id),
      };
    }
    case 'TIMER_START': {
      const c = d.cards[a.cardId];
      if (!c || c.time.some((t) => t.id === a.entryId)) return d;
      const me = a.meta.by.id;
      let cards = d.cards;
      let activity = d.activity;
      // One timer per person: stop whatever else I was timing on this board.
      for (const other of Object.values(d.cards)) {
        const run = other.time.find((t) => t.userId === me && t.end === null);
        if (!run) continue;
        const end = Math.max(run.start, a.meta.at);
        cards = { ...cards, [other.id]: { ...other, time: other.time.map((t) => (t.id === run.id ? { ...t, end } : t)) } };
        activity = log({ ...d, activity }, a, `tracked ${formatDuration(end - run.start)} on “${other.title}”`, other.id);
      }
      const cur = cards[c.id];
      const entry: TimeEntry = { id: a.entryId, userId: me, name: a.meta.by.name, start: a.meta.at, end: null };
      return { ...d, cards: { ...cards, [c.id]: { ...cur, time: [...cur.time, entry] } }, activity: log({ ...d, activity }, a, `started a timer on “${c.title}”`, c.id) };
    }
    case 'TIMER_STOP': {
      const c = d.cards[a.cardId];
      const run = c?.time.find((t) => t.userId === a.meta.by.id && t.end === null);
      if (!c || !run) return d;
      const end = Math.max(run.start, a.meta.at);
      return {
        ...d,
        cards: { ...d.cards, [c.id]: { ...c, time: c.time.map((t) => (t.id === run.id ? { ...t, end } : t)) } },
        activity: log(d, a, `tracked ${formatDuration(end - run.start)} on “${c.title}”`, c.id),
      };
    }
    case 'ADD_TIME': {
      const c = d.cards[a.cardId];
      const e = a.entry;
      if (!c || c.time.some((t) => t.id === e.id) || e.end === null || e.end <= e.start) return d;
      return {
        ...d,
        cards: { ...d.cards, [c.id]: { ...c, time: [...c.time, e] } },
        activity: log(d, a, `added ${formatDuration(e.end - e.start)} of time${e.userId !== a.meta.by.id ? ` for ${e.name}` : ''} on “${c.title}”`, c.id),
      };
    }
    case 'DELETE_TIME': {
      const c = d.cards[a.cardId];
      const e = c?.time.find((t) => t.id === a.entryId);
      if (!c || !e) return d;
      return {
        ...d,
        cards: { ...d.cards, [c.id]: { ...c, time: c.time.filter((t) => t.id !== a.entryId) } },
        activity: log(d, a, `removed ${e.end ? formatDuration(e.end - e.start) : 'a running timer'} of time on “${c.title}”`, c.id),
      };
    }
    case 'DELETE_COMMENT': {
      const c = d.cards[a.cardId];
      if (!c) return d;
      return { ...d, cards: { ...d.cards, [c.id]: { ...c, comments: c.comments.filter((x) => x.id !== a.commentId) } } };
    }
    case 'ADD_ATTACHMENTS': {
      const c = d.cards[a.cardId];
      if (!c) return d;
      const fresh = a.attachments.filter((x) => !c.attachments.some((y) => y.id === x.id));
      if (fresh.length === 0) return d;
      // Like Trello: the first image becomes the cover if the card has none.
      const firstImage = fresh.find((x) => (x.mime ?? '').startsWith('image/'));
      const cover = c.cover ?? (a.autoCover && firstImage ? firstImage.id : null);
      let activity = d.activity;
      for (const x of fresh) {
        activity = log({ ...d, activity }, a, `attached ${x.name || x.url} to “${c.title}”`, c.id, x.id);
      }
      return { ...d, cards: { ...d.cards, [c.id]: { ...c, attachments: [...c.attachments, ...fresh], cover } }, activity };
    }
    case 'DELETE_ATTACHMENT': {
      const c = d.cards[a.cardId];
      if (!c) return d;
      const att = c.attachments.find((x) => x.id === a.attachmentId);
      if (!att) return d;
      return {
        ...d,
        cards: {
          ...d.cards,
          [c.id]: { ...c, attachments: c.attachments.filter((x) => x.id !== a.attachmentId), cover: c.cover === a.attachmentId ? null : c.cover },
        },
        activity: log(d, a, `deleted the attachment ${att.name || att.url} from “${c.title}”`, c.id),
      };
    }
    case 'SET_DASHBOARD':
      return { ...d, dashboard: a.tiles };
    case 'SET_LIST_RULES': {
      const l = d.lists[a.listId];
      if (!l) return d;
      const next = { ...l, ...a.rules };
      const what = [
        a.rules.protected !== undefined ? (a.rules.protected ? 'protected' : 'unprotected') : '',
        a.rules.requireDue !== undefined ? (a.rules.requireDue ? 'now asks for a due date' : 'no longer asks for a due date') : '',
      ].filter(Boolean);
      return { ...d, lists: { ...d.lists, [l.id]: next }, activity: log(d, a, `list “${l.title}” ${what.join(' and ')}`) };
    }
    case 'SET_SETTINGS':
      return { ...d, settings: a.settings, activity: log(d, a, a.note || 'changed the board settings') };
    case 'SET_AUTOMATIONS':
      return { ...d, automations: a.rules, activity: log(d, a, a.note || 'changed the board automations') };
    case 'SET_BACKGROUND':
      return { ...d, background: a.url, activity: log(d, a, a.url ? 'changed the board background' : 'removed the board background') };
    case 'MAP_GUEST': {
      // Replace an imported person's name with a real teammate on every card (or just drop the name).
      const cards: Record<string, Card> = {};
      let n = 0;
      for (const [id, c] of Object.entries(d.cards)) {
        if (!c.guests.includes(a.name)) {
          cards[id] = c;
          continue;
        }
        n++;
        const assignees = a.userId && !c.assignees.includes(a.userId) ? [...c.assignees, a.userId] : c.assignees;
        cards[id] = { ...c, guests: c.guests.filter((g) => g !== a.name), assignees };
      }
      return { ...d, cards, activity: log(d, a, `${a.userId ? 'linked' : 'removed'} imported person “${a.name}” on ${n} card(s)`) };
    }
    case 'SET_FIELDS': {
      const keep = new Map(a.fields.map((f) => [f.id, f]));
      const cards: Record<string, Card> = {};
      for (const [id, c] of Object.entries(d.cards)) {
        const entries = Object.entries(c.fields ?? {});
        let changed = false;
        const next: [string, FieldValue][] = [];
        for (const [fid, v] of entries) {
          const f = keep.get(fid);
          const opts = new Set((f?.options ?? []).map((o) => o.id));
          // A removed field or choice is cleared from the cards that used it.
          if (!f) changed = true;
          else if (f.type === 'dropdown' && !opts.has(v as string)) changed = true;
          else if (f.type === 'multiselect' && Array.isArray(v)) {
            const kept = v.filter((x) => opts.has(x));
            if (kept.length !== v.length) changed = true;
            if (kept.length) next.push([fid, kept]);
          } else next.push([fid, v]);
        }
        cards[id] = changed ? { ...c, fields: Object.fromEntries(next) } : c;
      }
      return { ...d, customFields: a.fields, cards, activity: log(d, a, a.note || 'updated the custom fields') };
    }
    case 'SET_FIELD_VALUE': {
      const c = d.cards[a.cardId];
      const f = (d.customFields ?? []).find((x) => x.id === a.fieldId);
      if (!c || !f) return d;
      const fields = { ...(c.fields ?? {}) };
      const v = a.value;
      const empty = v === null || v === '' || v === false || (f.type === 'rating' && v === 0) || (Array.isArray(v) && v.length === 0);
      if (empty) {
        if (!(a.fieldId in fields)) return d;
        delete fields[a.fieldId];
      } else {
        if (JSON.stringify(fields[a.fieldId]) === JSON.stringify(v)) return d;
        fields[a.fieldId] = v;
      }
      const optLabel = (id: string) => (f.options ?? []).find((o) => o.id === id)?.label ?? '';
      const shown = empty
        ? ''
        : f.type === 'dropdown'
          ? optLabel(v as string)
          : f.type === 'multiselect'
            ? (v as string[]).map(optLabel).filter(Boolean).join(', ')
            : f.type === 'rating'
              ? `${v}★`
              : f.type === 'longtext' || f.type === 'person'
                ? ''
                : String(v);
      const text = empty
        ? `cleared ${f.name} on “${c.title}”`
        : f.type === 'checkbox'
          ? `ticked ${f.name} on “${c.title}”`
          : !shown
            ? `updated ${f.name} on “${c.title}”`
            : `set ${f.name} on “${c.title}” to ${shown}`;
      return { ...d, cards: { ...d.cards, [c.id]: { ...c, fields } }, activity: log(d, a, text, c.id) };
    }
    case 'SET_LABELS': {
      const ids = new Set(a.labels.map((l) => l.id));
      const cards: Record<string, Card> = {};
      for (const [id, c] of Object.entries(d.cards)) {
        cards[id] = c.labelIds.every((l) => ids.has(l)) ? c : { ...c, labelIds: c.labelIds.filter((l) => ids.has(l)) };
      }
      return { ...d, labels: a.labels, cards, activity: log(d, a, 'updated board labels') };
    }
  }
}

/** Which list a card lives in. */
export function cardListId(d: BoardData, cardId: string): string | undefined {
  return listOf(d, cardId)?.id;
}
