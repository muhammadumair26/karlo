import type { Activity, Attachment, BoardData, Card, Comment, DashboardTile, Label, List } from './types';

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
    lists[id] = { id, title: l.title ?? 'Untitled', cardIds: Array.isArray(l.cardIds) ? l.cardIds : [], archived: !!l.archived };
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
      description,
      archived: !!c.archived,
      dueDone: !!c.dueDone,
      start: c.start ?? null,
      due: c.due ?? null,
    });
  }
  const listOrder = (d.listOrder ?? Object.keys(lists)).filter((id) => lists[id]);
  for (const l of Object.values(lists)) l.cardIds = l.cardIds.filter((id) => cards[id]);
  return { lists, listOrder, cards, labels: d.labels ?? [], activity: d.activity ?? [], background: d.background ?? null, dashboard: Array.isArray(d.dashboard) ? d.dashboard : null };
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
  | { type: 'ADD_CARD'; listId: string; cardId: string; title: string }
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
  | { type: 'MAP_GUEST'; name: string; userId: string | null };

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
      if (!l) return d;
      return {
        ...d,
        lists: { ...d.lists, [l.id]: { ...l, archived: a.archived } },
        activity: log(d, a, `${a.archived ? 'archived' : 'restored'} list “${l.title}”`),
      };
    }
    case 'DELETE_LIST': {
      const l = d.lists[a.listId];
      if (!l) return d;
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
      const c = newCard(a.cardId, a.title, a.meta.by.id, a.meta.at);
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
      return {
        ...d,
        cards: { ...d.cards, [c.id]: { ...c, ...a.patch } },
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
