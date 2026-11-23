import type { BoardActionBody } from './board';
import { cardListId } from './board';
import { formatDate } from './filters';
import type { BoardData, Me, Person } from './types';
import { boardSettings } from './types';

/** Who hears about a card change. Pure (no network), shared by the website and the phone app. */

export type NotificationKind = 'mention' | 'assigned' | 'comment' | 'attachment' | 'moved' | 'due' | 'completed' | 'reminder' | 'digest' | 'automation';

export interface NotificationRow {
  id: string;
  user_id: string;
  actor_id: string | null; // null = sent by Karlo itself (reminders, digest)
  board_id: string | null; // null = not about one board (daily digest)
  card_id: string | null;
  kind: NotificationKind;
  card_title: string;
  list_title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  actor?: { name: string; avatar_url: string | null } | null;
  board?: { title: string; color: string } | null;
}

/** @handle used for mentions: the part of the email before "@". */
export const handleOf = (p: Pick<Person, 'email'>) => p.email.split('@')[0];

/** Where a mention sits in a text box, which shows it by name ("@Zeeshan Ahmed") instead of the saved "@handle". */
export interface MentionSpan {
  start: number;
  end: number;
  userId: string;
}
export interface MentionView {
  text: string;
  spans: MentionSpan[];
}

/** Saved text (with @handles) → what a text box shows (with @names), plus where each name is. */
export function mentionsToNames(text: string, people: Person[]): MentionView {
  const spans: MentionSpan[] = [];
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/@([\w.+-]+)/g)) {
    const raw = m[1].replace(/\.+$/, ''); // "thanks @ali." — the dot ends the sentence
    const who = people.find((p) => handleOf(p).toLowerCase() === raw.toLowerCase());
    if (!who || m.index === undefined) continue;
    out += text.slice(last, m.index);
    const label = `@${who.name}`;
    spans.push({ start: out.length, end: out.length + label.length, userId: who.user_id });
    out += label;
    last = m.index + 1 + raw.length;
  }
  return { text: out + text.slice(last), spans };
}

/** What a text box shows → the text to save: each name mention back to its @handle. */
export function namesToMentions(view: MentionView, people: Person[]): string {
  let out = '';
  let last = 0;
  for (const sp of [...view.spans].sort((a, b) => a.start - b.start)) {
    const who = people.find((p) => p.user_id === sp.userId);
    if (!who) continue;
    out += view.text.slice(last, sp.start) + `@${handleOf(who)}`;
    last = sp.end;
  }
  return out + view.text.slice(last);
}

/**
 * The text box changed from `prev` to `next`. Mentions outside the change keep their place; one that
 * was cut into (e.g. backspace at its end) is removed whole, like in chat apps.
 */
export function editMentionView(prev: MentionView, next: string): MentionView {
  const a = prev.text;
  let p = 0;
  while (p < a.length && p < next.length && a[p] === next[p]) p++;
  let q = 0;
  while (q < a.length - p && q < next.length - p && a[a.length - 1 - q] === next[next.length - 1 - q]) q++;
  const oldEnd = a.length - q; // changed part: a[p, oldEnd) → next[p, newEnd)
  const newEnd = next.length - q;
  const delta = next.length - a.length;
  const spans: MentionSpan[] = [];
  const cut: [number, number][] = []; // leftover pieces of broken mentions, in `next`
  for (const sp of prev.spans) {
    if (sp.end <= p) spans.push(sp);
    else if (sp.start >= oldEnd) spans.push({ ...sp, start: sp.start + delta, end: sp.end + delta });
    else {
      if (sp.start < p) cut.push([sp.start, p]);
      if (sp.end > oldEnd) cut.push([newEnd, sp.end + delta]);
    }
  }
  let text = next;
  for (const [s, e] of cut.sort((x, y) => y[0] - x[0])) {
    text = text.slice(0, s) + text.slice(e);
    const n = e - s;
    for (const sp of spans) if (sp.start >= e) (sp.start -= n), (sp.end -= n);
  }
  return { text, spans };
}

/** User ids of people @mentioned in a piece of text. */
export function mentionedIds(text: string, people: Person[]): string[] {
  const handles = new Set((text.match(/@[\w.+-]+/g) ?? []).map((m) => m.slice(1).toLowerCase()));
  return people.filter((p) => handles.has(handleOf(p).toLowerCase())).map((p) => p.user_id);
}

/**
 * People newly @mentioned on a card by this change (comment, description or new checklist item)
 * who aren't members or owners yet — they become responsible for the card.
 */
export function newMentionAssignees(before: BoardData, a: BoardActionBody, people: Person[]): string[] {
  const cardId = 'cardId' in a ? a.cardId : null;
  const card = cardId ? before.cards[cardId] : undefined;
  if (!card) return [];
  let ids: string[] = [];
  if (a.type === 'ADD_COMMENT') ids = mentionedIds(a.comment.text, people);
  else if (a.type === 'UPDATE_CARD') {
    const p = a.patch;
    if (p.description !== undefined) {
      const was = new Set(mentionedIds(card.description, people));
      ids.push(...mentionedIds(p.description, people).filter((id) => !was.has(id)));
    }
    if (p.checklist) {
      const old = new Map(card.checklist.map((i) => [i.id, i.text]));
      for (const item of p.checklist) {
        const was = new Set(mentionedIds(old.get(item.id) ?? '', people));
        ids.push(...mentionedIds(item.text, people).filter((id) => !was.has(id)));
      }
    }
  }
  // Owners are already responsible: mentioning them only notifies them.
  const members = new Set([...card.assignees, ...card.owners, card.createdBy, ...((a.type === 'UPDATE_CARD' && a.patch.assignees) || [])]);
  return [...new Set(ids)].filter((id) => !members.has(id));
}

const snippet = (t: string, n = 90) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

export type Draft = Omit<NotificationRow, 'id' | 'created_at' | 'read_at' | 'actor' | 'board' | 'actor_id'>;

/**
 * Works out who should be notified about a card change, Trello-style:
 * - people @mentioned in comments, descriptions or checklist items
 * - people newly added to a card
 * - card members, for comments, attachments, moves, due dates and completion
 * Never notifies the person making the change.
 */
export function notificationsFor(before: BoardData, a: BoardActionBody, me: Me, people: Person[], boardId: string): Draft[] {
  const cardId = 'cardId' in a ? a.cardId : null;
  if (!cardId) return [];
  const card = before.cards[cardId];
  if (!card) return [];
  const listId = cardListId(before, cardId);
  const base = { board_id: boardId, card_id: cardId, card_title: card.title, list_title: listId ? before.lists[listId]?.title ?? '' : '' };
  const out: Draft[] = [];
  const told = new Set<string>([me.id]);
  const send = (ids: string[], kind: NotificationKind, body: string) => {
    for (const id of ids) {
      if (told.has(id)) continue;
      told.add(id);
      out.push({ ...base, user_id: id, kind, body });
    }
  };
  // Members and owners (creator + co-owners) hear about activity on the card.
  const members = [...new Set([...card.assignees, ...(card.owners ?? [])])];

  if (a.type === 'ADD_COMMENT') {
    send(mentionedIds(a.comment.text, people), 'mention', `Mentioned you: “${snippet(a.comment.text)}”`);
    send(members, 'comment', `Commented: “${snippet(a.comment.text)}”`);
  } else if (a.type === 'ADD_ATTACHMENTS') {
    const names = a.attachments.map((x) => x.name || x.url);
    send(members, 'attachment', names.length === 1 ? `Attached ${names[0]}` : `Attached ${names.length} files: ${snippet(names.join(', '))}`);
  } else if (a.type === 'MOVE_CARD') {
    const toTitle = before.lists[a.toListId]?.title;
    if (a.toListId !== listId && toTitle) send(members, 'moved', `Moved this card from ${base.list_title} to ${toTitle}`);
  } else if (a.type === 'UPDATE_CARD') {
    const p = a.patch;
    if (p.assignees) {
      send(p.assignees.filter((id) => !card.assignees.includes(id)), 'assigned', 'Added you to this card');
    }
    if (p.owners) {
      send(p.owners.filter((id) => !(card.owners ?? []).includes(id)), 'assigned', 'Made you an owner of this card');
    }
    if (p.description !== undefined) {
      const was = new Set(mentionedIds(card.description, people));
      send(mentionedIds(p.description, people).filter((id) => !was.has(id)), 'mention', 'Mentioned you in the description');
    }
    if (p.checklist) {
      const oldIds = new Set(card.checklist.map((i) => i.id));
      for (const item of p.checklist.filter((i) => !oldIds.has(i.id))) {
        send(mentionedIds(item.text, people), 'mention', `Mentioned you in a checklist item: “${snippet(item.text)}”`);
      }
    }
    if (p.attachments && p.attachments.length > card.attachments.length) {
      const added = p.attachments[p.attachments.length - 1];
      send(members, 'attachment', `Attached ${added.name || added.url}`);
    }
    if (p.due && p.due !== card.due) send(members, 'due', `Set the due date to ${formatDate(p.due)}`);
    if (p.completed === true && !card.completed) send(members, 'completed', 'Marked this card complete');
  }
  return out;
}


/** Card changes that count as "working on" a card (deleting or archiving doesn't). */
const EDIT_TYPES = new Set<BoardActionBody['type']>([
  'UPDATE_CARD', 'MOVE_CARD', 'ADD_COMMENT', 'ADD_ATTACHMENTS', 'SET_FIELD_VALUE', 'TIMER_START', 'ADD_TIME',
]);

/**
 * Board setting "Editing a card adds you": someone who changes a card they don't own and
 * aren't a member of becomes a member of it.
 */
export function joinsOnEdit(before: BoardData, a: BoardActionBody, userId: string): boolean {
  if (!userId || !boardSettings(before).editJoins || !EDIT_TYPES.has(a.type) || !('cardId' in a)) return false;
  if (a.type === 'UPDATE_CARD') {
    const keys = Object.keys(a.patch);
    // Changing the members yourself is a deliberate choice; archiving isn't working on the card.
    if (keys.includes('assignees') || keys.every((k) => k === 'archived')) return false;
  }
  const c = before.cards[a.cardId];
  if (!c) return false;
  return !c.owners.includes(userId) && c.createdBy !== userId && !c.assignees.includes(userId);
}
