import { supabase } from '../supabase';
import type { BoardActionBody } from './board';
import { cardListId } from './board';
import { formatDate } from './filters';
import type { BoardData, Me, Person } from './types';

export type NotificationKind = 'mention' | 'assigned' | 'comment' | 'attachment' | 'moved' | 'due' | 'completed';

export interface NotificationRow {
  id: string;
  user_id: string;
  actor_id: string;
  board_id: string;
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

/** User ids of people @mentioned in a piece of text. */
export function mentionedIds(text: string, people: Person[]): string[] {
  const handles = new Set((text.match(/@[\w.+-]+/g) ?? []).map((m) => m.slice(1).toLowerCase()));
  return people.filter((p) => handles.has(handleOf(p).toLowerCase())).map((p) => p.user_id);
}

/**
 * People newly @mentioned on a card by this change (comment, description or new checklist item)
 * who aren't members yet — they become responsible for the card.
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
  const members = new Set([...card.assignees, ...((a.type === 'UPDATE_CARD' && a.patch.assignees) || [])]);
  return [...new Set(ids)].filter((id) => !members.has(id));
}

const snippet = (t: string, n = 90) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

type Draft = Omit<NotificationRow, 'id' | 'created_at' | 'read_at' | 'actor' | 'board' | 'actor_id'>;

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

export async function sendNotifications(rows: Draft[]) {
  if (!supabase || rows.length === 0) return;
  const { error } = await supabase.from('notifications').insert(rows);
  if (error) console.warn('Karlo: could not send notifications', error.message);
}

export async function loadNotifications(): Promise<NotificationRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('*, actor:profiles!notifications_actor_id_fkey(name, avatar_url), board:boards(title, color)')
    .order('created_at', { ascending: false })
    .limit(150);
  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationRow[];
}

export async function markRead(ids: string[]) {
  if (!supabase || ids.length === 0) return;
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).is('read_at', null);
}

export async function markUnread(id: string) {
  if (!supabase) return;
  await supabase.from('notifications').update({ read_at: null }).eq('id', id);
}
