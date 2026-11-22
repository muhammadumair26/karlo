import { cardListId, type BoardActionBody } from './board';
import { PRIORITIES, type AutoAction, type AutomationRule, type AutoTrigger, type BoardData, type Card } from './types';

/**
 * Board automations: "when a card … then …". Run in the browser of the person whose change triggered
 * them, as ordinary board changes (so they sync, show in Activity and can be undone like any edit).
 * Follow-up changes made by an automation don't trigger more automations (no loops).
 */

export interface AutoNotify {
  userIds: string[];
  cardId: string;
  body: string;
}

/** A message to post to another app (Zapier, Make, n8n, Slack, Teams, Discord …). */
export interface AutoWebhook {
  url: string;
  format: 'json' | 'chat';
  payload: Record<string, unknown>;
}

/** Who made the change and where — used for comments and webhook messages. */
export interface AutoContext {
  by?: { id: string; name: string };
  boardId?: string;
  boardTitle?: string;
  personName?: (id: string) => string;
  origin?: string; // site that card links point to
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Which triggers this change fires, with the card it's about. */
function firedBy(before: BoardData, a: BoardActionBody): { cardId: string; hits: (t: AutoTrigger) => boolean } | null {
  if (a.type === 'MOVE_CARD') {
    const from = cardListId(before, a.cardId);
    if (!from || from === a.toListId) return null;
    return { cardId: a.cardId, hits: (t) => t.type === 'moved_to' && t.listId === a.toListId };
  }
  if (a.type === 'ADD_CARD') {
    const c = { assignees: a.assignees ?? [], due: a.due ?? null };
    return {
      cardId: a.cardId,
      hits: (t) => (t.type === 'added_to' && t.listId === a.listId) || t.type === 'created' || (t.type === 'member_added' && c.assignees.length > 0) || (t.type === 'due_set' && !!c.due),
    };
  }
  if (a.type === 'ADD_COMMENT') return before.cards[a.cardId] ? { cardId: a.cardId, hits: (t) => t.type === 'comment_added' } : null;
  if (a.type === 'ADD_ATTACHMENTS') return before.cards[a.cardId] && a.attachments.length ? { cardId: a.cardId, hits: (t) => t.type === 'attachment_added' } : null;
  if (a.type === 'UPDATE_CARD') {
    const c = before.cards[a.cardId];
    if (!c) return null;
    const p = a.patch;
    const completedNow = p.completed === true && !c.completed;
    const reopenedNow = p.completed === false && c.completed;
    const allDone = (l: Card['checklist']) => l.length > 0 && l.every((i) => i.done);
    const checklistNow = !!p.checklist && allDone(p.checklist) && !allDone(c.checklist);
    const newLabels = p.labelIds ? p.labelIds.filter((id) => !c.labelIds.includes(id)) : [];
    const newMember = !!p.assignees && p.assignees.some((id) => !c.assignees.includes(id));
    const priorityNow = p.priority !== undefined && p.priority !== c.priority ? p.priority : null;
    const dueNow = p.due !== undefined && !!p.due && p.due !== c.due;
    const archivedNow = p.archived === true && !c.archived;
    return {
      cardId: a.cardId,
      hits: (t) => {
        switch (t.type) {
          case 'completed':
            return completedNow;
          case 'uncompleted':
            return reopenedNow;
          case 'checklist_done':
            return checklistNow;
          case 'label_added':
            return newLabels.includes(t.labelId);
          case 'member_added':
            return newMember;
          case 'priority_set':
            return priorityNow === t.priority;
          case 'due_set':
            return dueNow;
          case 'archived':
            return archivedNow;
          default:
            return false;
        }
      },
    };
  }
  return null;
}

/** The changes, notifications and webhook messages that the board's automations add after `a` was applied to `before`. */
export function automationFollowUps(
  before: BoardData,
  after: BoardData,
  a: BoardActionBody,
  today = new Date(),
  ctx: AutoContext = {},
): { actions: BoardActionBody[]; notify: AutoNotify[]; webhooks: AutoWebhook[] } {
  const rules = (before.automations ?? []).filter((r) => r.on);
  const out = { actions: [] as BoardActionBody[], notify: [] as AutoNotify[], webhooks: [] as AutoWebhook[] };
  if (!rules.length) return out;
  const fired = firedBy(before, a);
  if (!fired) return out;
  const card = after.cards[fired.cardId];
  if (!card) return out;

  for (const rule of rules.filter((r) => fired.hits(r.trigger))) {
    const patch: Partial<Card> = {};
    let moveTo: string | null = null;
    const did: string[] = [];
    const comments: string[] = [];
    const hooks: Extract<AutoAction, { type: 'webhook' }>[] = [];
    for (const x of rule.actions) {
      const c = { ...card, ...patch };
      switch (x.type) {
        case 'complete':
          if (!c.completed) (patch.completed = true), did.push('marked {card} complete');
          break;
        case 'uncomplete':
          if (c.completed) (patch.completed = false), did.push('marked {card} not complete');
          break;
        case 'move_to':
          if (after.lists[x.listId] && cardListId(after, card.id) !== x.listId) moveTo = x.listId;
          break;
        case 'assign': {
          const id = x.userId === '@owner' ? card.createdBy : x.userId;
          if (id && !c.assignees.includes(id)) (patch.assignees = [...c.assignees, id]), did.push('added a member to {card}');
          break;
        }
        case 'unassign': {
          const next = x.userId === '@all' ? [] : c.assignees.filter((id) => id !== x.userId);
          if (next.length !== c.assignees.length) (patch.assignees = next), did.push('removed a member from {card}');
          break;
        }
        case 'due_in': {
          const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Math.max(0, Math.round(x.days)));
          if (c.due !== iso(d)) (patch.due = iso(d)), (patch.dueDone = false), did.push(`set the due date of {card}`);
          break;
        }
        case 'clear_due':
          if (c.due) (patch.due = null), did.push('removed the due date of {card}');
          break;
        case 'start_today':
          if (c.start !== iso(today)) (patch.start = iso(today)), did.push('set the start date of {card}');
          break;
        case 'add_label':
          if (after.labels.some((l) => l.id === x.labelId) && !c.labelIds.includes(x.labelId)) (patch.labelIds = [...c.labelIds, x.labelId]), did.push('added a label to {card}');
          break;
        case 'remove_label':
          if (c.labelIds.includes(x.labelId)) (patch.labelIds = c.labelIds.filter((id) => id !== x.labelId)), did.push('removed a label from {card}');
          break;
        case 'set_priority':
          if (c.priority !== x.priority) (patch.priority = x.priority), did.push('changed the priority of {card}');
          break;
        case 'check_all':
          if (c.checklist.some((i) => !i.done)) (patch.checklist = c.checklist.map((i) => ({ ...i, done: true }))), did.push('ticked the checklist of {card}');
          break;
        case 'add_checklist': {
          const have = new Set(c.checklist.map((i) => i.text.trim().toLowerCase()));
          const add = x.items.map((t) => t.trim()).filter((t) => t && !have.has(t.toLowerCase()) && !!have.add(t.toLowerCase()));
          if (add.length) (patch.checklist = [...c.checklist, ...add.map((text) => ({ id: rid(), text, done: false }))]), did.push('added checklist items to {card}');
          break;
        }
        case 'archive':
          if (!c.archived) (patch.archived = true), did.push('archived {card}');
          break;
        case 'add_comment':
          if (x.text.trim()) comments.push(x.text.trim());
          break;
        case 'notify': {
          const ids =
            x.to === 'members' ? [...new Set([...c.assignees, ...(c.owners ?? [])])] : x.to === 'owners' ? [...new Set(c.owners?.length ? c.owners : [c.createdBy])] : [x.to];
          out.notify.push({ userIds: ids.filter(Boolean), cardId: card.id, body: x.message.trim() || 'An automation ran on this card' });
          break;
        }
        case 'webhook':
          if (/^https?:\/\//i.test(x.url.trim())) hooks.push(x);
          break;
      }
    }
    // A comment on the card is posted before the card is archived or moved.
    for (const text of comments)
      out.actions.push({ type: 'ADD_COMMENT', cardId: card.id, comment: { id: rid(), authorId: ctx.by?.id ?? card.createdBy, authorName: ctx.by?.name ?? 'Automation', text, createdAt: today.getTime() } });
    if (Object.keys(patch).length) out.actions.push({ type: 'UPDATE_CARD', cardId: card.id, patch, note: `Automation: ${did.join(', ')}` });
    if (moveTo) out.actions.push({ type: 'MOVE_CARD', cardId: card.id, toListId: moveTo, toIndex: 0 });
    if (hooks.length) {
      const final = { ...card, ...patch };
      const listId = moveTo ?? cardListId(after, card.id);
      const payload = webhookPayload(rule.trigger, final, listId ? (after.lists[listId]?.title ?? '') : '', after, ctx, today);
      for (const h of hooks) out.webhooks.push({ url: h.url.trim(), format: h.format, payload });
    }
  }
  return out;
}

/** What a webhook receives: the event plus the card, in plain fields that other apps can map. */
function webhookPayload(t: AutoTrigger, card: Card, list: string, d: BoardData, ctx: AutoContext, at: Date): Record<string, unknown> {
  const name = ctx.personName ?? (() => 'someone');
  const origin = ctx.origin ?? 'https://karlo.orionsoftsol.com';
  const url = ctx.boardId ? `${origin}/?board=${ctx.boardId}&card=${card.id}` : origin;
  const event = `When ${triggerText(t, d)}`;
  const text = `⚡ ${ctx.by?.name ?? 'Someone'} · ${card.title}${list ? ` (${list})` : ''}${ctx.boardTitle ? ` — ${ctx.boardTitle}` : ''}\n${event}\n${url}`;
  return {
    source: 'karlo',
    event: t.type,
    event_text: event,
    at: at.toISOString(),
    by: ctx.by?.name ?? null,
    board: { id: ctx.boardId ?? null, title: ctx.boardTitle ?? null },
    card: {
      id: card.id,
      title: card.title,
      description: card.description,
      list,
      url,
      completed: card.completed,
      priority: card.priority,
      start: card.start,
      due: card.due,
      labels: card.labelIds.map((id) => d.labels.find((l) => l.id === id)?.name || '').filter(Boolean),
      members: card.assignees.map(name),
      checklist: { done: card.checklist.filter((i) => i.done).length, total: card.checklist.length },
    },
    text, // Slack, Teams, Google Chat
    content: text, // Discord
  };
}

/**
 * Sends the webhook messages. In a browser, other sites usually block replies to us (CORS), so the
 * message is sent as a "simple" request — it still arrives, we just can't read the answer.
 */
export async function sendWebhooks(hooks: AutoWebhook[]): Promise<void> {
  const browser = typeof document !== 'undefined';
  await Promise.all(
    hooks.map(async (h) => {
      const body = JSON.stringify(h.format === 'chat' ? { text: h.payload.text, content: h.payload.content } : h.payload);
      try {
        if (browser) await fetch(h.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body });
        else await fetch(h.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      } catch {
        /* the other app is down or the link is wrong — nothing to undo */
      }
    }),
  );
}

/** A sample message, for the "Send test" button. */
export function testWebhook(url: string, format: 'json' | 'chat', d: BoardData, ctx: AutoContext): Promise<void> {
  const card: Card = {
    id: 'test',
    title: 'Test card from Karlo',
    description: 'This is a test message from a Karlo automation.',
    labelIds: [],
    assignees: [],
    owners: [],
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
    createdAt: Date.now(),
    createdBy: ctx.by?.id ?? '',
  };
  return sendWebhooks([{ url: url.trim(), format, payload: webhookPayload({ type: 'created' }, card, '', d, ctx, new Date()) }]);
}

// ---------------------------------------------------------------- choices for the editor (website and phone app)

export const TRIGGER_CHOICES: { v: AutoTrigger['type']; label: string }[] = [
  { v: 'moved_to', label: 'A card is moved to…' },
  { v: 'added_to', label: 'A card is added to…' },
  { v: 'created', label: 'A new card is added (any list)' },
  { v: 'completed', label: 'A card is marked complete' },
  { v: 'uncompleted', label: 'A card is marked not complete' },
  { v: 'checklist_done', label: "A card's checklist is all ticked" },
  { v: 'label_added', label: 'A label is added…' },
  { v: 'member_added', label: 'Someone is made responsible' },
  { v: 'priority_set', label: 'The priority is set to…' },
  { v: 'due_set', label: 'A due date is set' },
  { v: 'comment_added', label: 'Someone comments' },
  { v: 'attachment_added', label: 'A file or link is attached' },
  { v: 'archived', label: 'A card is archived' },
];

export const ACTION_CHOICES: { v: AutoAction['type']; label: string; group: string }[] = [
  { v: 'complete', label: 'Mark it complete', group: 'Card' },
  { v: 'uncomplete', label: 'Mark it not complete', group: 'Card' },
  { v: 'move_to', label: 'Move it to a list', group: 'Card' },
  { v: 'archive', label: 'Archive it', group: 'Card' },
  { v: 'set_priority', label: 'Set the priority', group: 'Card' },
  { v: 'add_label', label: 'Add a label', group: 'Card' },
  { v: 'remove_label', label: 'Remove a label', group: 'Card' },
  { v: 'assign', label: 'Add a responsible person', group: 'People' },
  { v: 'unassign', label: 'Remove a responsible person', group: 'People' },
  { v: 'due_in', label: 'Set the due date', group: 'Dates' },
  { v: 'clear_due', label: 'Remove the due date', group: 'Dates' },
  { v: 'start_today', label: 'Set the start date to today', group: 'Dates' },
  { v: 'check_all', label: 'Tick every checklist item', group: 'Checklist' },
  { v: 'add_checklist', label: 'Add checklist items', group: 'Checklist' },
  { v: 'add_comment', label: 'Post a comment', group: 'Messages' },
  { v: 'notify', label: 'Send a notification', group: 'Messages' },
  { v: 'webhook', label: 'Send to a webhook (Zapier, Slack …)', group: 'Messages' },
];

/** Steps that may be added more than once. */
export const REPEATABLE: AutoAction['type'][] = ['notify', 'webhook', 'add_comment', 'add_label', 'remove_label', 'assign', 'unassign'];

export function blankTrigger(k: AutoTrigger['type'], d: BoardData, listId: string): AutoTrigger {
  switch (k) {
    case 'moved_to':
    case 'added_to':
      return { type: k, listId };
    case 'label_added':
      return { type: k, labelId: d.labels[0]?.id ?? '' };
    case 'priority_set':
      return { type: k, priority: 'urgent' };
    default:
      return { type: k } as AutoTrigger;
  }
}

export function blankAction(k: AutoAction['type'], d: BoardData, lists: { id: string }[], notList = ''): AutoAction {
  switch (k) {
    case 'move_to':
      return { type: k, listId: lists.find((l) => l.id !== notList)?.id ?? lists[0]?.id ?? '' };
    case 'assign':
      return { type: k, userId: '@owner' };
    case 'unassign':
      return { type: k, userId: '@all' };
    case 'due_in':
      return { type: k, days: 3 };
    case 'add_label':
    case 'remove_label':
      return { type: k, labelId: d.labels[0]?.id ?? '' };
    case 'set_priority':
      return { type: k, priority: 'high' };
    case 'add_checklist':
      return { type: k, items: [] };
    case 'add_comment':
      return { type: k, text: '' };
    case 'notify':
      return { type: k, to: 'members', message: '' };
    case 'webhook':
      return { type: k, url: '', format: 'json' };
    default:
      return { type: k } as AutoAction;
  }
}

export const validWebhookUrl = (u: string) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(u.trim());

export function ruleIsValid(t: AutoTrigger, actions: AutoAction[]): boolean {
  if (!actions.length) return false;
  if ((t.type === 'moved_to' || t.type === 'added_to') && !t.listId) return false;
  if (t.type === 'label_added' && !t.labelId) return false;
  return actions.every((a) => {
    switch (a.type) {
      case 'add_label':
      case 'remove_label':
        return !!a.labelId;
      case 'move_to':
        return !!a.listId;
      case 'add_checklist':
        return a.items.some((x) => x.trim());
      case 'add_comment':
        return !!a.text.trim();
      case 'webhook':
        return validWebhookUrl(a.url);
      default:
        return true;
    }
  });
}

// ---------------------------------------------------------------- plain-language labels for the settings screen

export function triggerText(t: AutoTrigger, d: BoardData): string {
  const ln = (id: string) => `“${d.lists[id]?.title ?? 'deleted list'}”`;
  switch (t.type) {
    case 'moved_to':
      return `a card is moved to ${ln(t.listId)}`;
    case 'added_to':
      return `a card is added to ${ln(t.listId)}`;
    case 'completed':
      return 'a card is marked complete';
    case 'checklist_done':
      return "a card's checklist is all ticked";
    case 'created':
      return 'a new card is added';
    case 'uncompleted':
      return 'a card is marked not complete';
    case 'label_added':
      return `label “${d.labels.find((l) => l.id === t.labelId)?.name || 'label'}” is added to a card`;
    case 'member_added':
      return 'someone is made responsible for a card';
    case 'priority_set':
      return `a card's priority is set to ${PRIORITIES.find((p) => p.value === t.priority)?.label ?? t.priority}`;
    case 'due_set':
      return 'a due date is set on a card';
    case 'comment_added':
      return 'someone comments on a card';
    case 'attachment_added':
      return 'a file or link is attached to a card';
    case 'archived':
      return 'a card is archived';
  }
}

export function actionText(x: AutoAction, d: BoardData, personName: (id: string) => string): string {
  switch (x.type) {
    case 'complete':
      return 'mark it complete';
    case 'uncomplete':
      return 'mark it not complete';
    case 'move_to':
      return `move it to “${d.lists[x.listId]?.title ?? 'deleted list'}”`;
    case 'assign':
      return `add ${x.userId === '@owner' ? 'the card owner' : personName(x.userId)} as responsible`;
    case 'due_in':
      return x.days === 0 ? 'set due today' : x.days === 1 ? 'set due tomorrow' : `set due in ${x.days} days`;
    case 'clear_due':
      return 'remove the due date';
    case 'add_label':
      return `add label “${d.labels.find((l) => l.id === x.labelId)?.name || 'label'}”`;
    case 'check_all':
      return 'tick every checklist item';
    case 'notify':
      return `notify ${x.to === 'members' ? 'its members' : x.to === 'owners' ? 'its owner' : personName(x.to)}${x.message ? `: “${x.message}”` : ''}`;
    case 'remove_label':
      return `remove label “${d.labels.find((l) => l.id === x.labelId)?.name || 'label'}”`;
    case 'unassign':
      return x.userId === '@all' ? 'remove everyone responsible' : `remove ${personName(x.userId)} as responsible`;
    case 'set_priority':
      return `set priority to ${PRIORITIES.find((p) => p.value === x.priority)?.label ?? x.priority}`;
    case 'start_today':
      return 'set the start date to today';
    case 'add_checklist':
      return `add ${x.items.filter((i) => i.trim()).length} checklist item${x.items.filter((i) => i.trim()).length === 1 ? '' : 's'}`;
    case 'add_comment':
      return `comment “${x.text}”`;
    case 'archive':
      return 'archive it';
    case 'webhook': {
      let host = x.url;
      try {
        host = new URL(x.url).host;
      } catch {
        /* keep as typed */
      }
      return `send it to ${host}${x.format === 'chat' ? ' as a chat message' : ''}`;
    }
  }
}

/** Ready-made rules to start from. */
export function suggestedRules(d: BoardData, uid: () => string): { title: string; rule: AutomationRule }[] {
  const find = (re: RegExp) => d.listOrder.map((id) => d.lists[id]).find((l) => l && !l.archived && re.test(l.title));
  const done = find(/^(done|completed?|finished)$/i);
  const doing = find(/progress|doing|working/i);
  const out: { title: string; rule: AutomationRule }[] = [];
  if (done)
    out.push({
      title: `Moved to ${done.title} → complete and tell the owner`,
      rule: { id: uid(), on: true, trigger: { type: 'moved_to', listId: done.id }, actions: [{ type: 'complete' }, { type: 'check_all' }, { type: 'notify', to: 'owners', message: 'This card is done' }] },
    });
  if (done)
    out.push({
      title: `Marked complete → move to ${done.title}`,
      rule: { id: uid(), on: true, trigger: { type: 'completed' }, actions: [{ type: 'move_to', listId: done.id }] },
    });
  if (doing)
    out.push({
      title: `Moved to ${doing.title} → owner responsible, due in 3 days`,
      rule: { id: uid(), on: true, trigger: { type: 'moved_to', listId: doing.id }, actions: [{ type: 'assign', userId: '@owner' }, { type: 'due_in', days: 3 }] },
    });
  out.push({
    title: 'Checklist finished → mark complete',
    rule: { id: uid(), on: true, trigger: { type: 'checklist_done' }, actions: [{ type: 'complete' }] },
  });
  return out;
}
