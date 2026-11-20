import { cardListId, type BoardActionBody } from './board';
import type { AutoAction, AutomationRule, AutoTrigger, BoardData, Card } from './types';

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

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Which triggers this change fires, with the card it's about. */
function firedBy(before: BoardData, a: BoardActionBody): { cardId: string; hits: (t: AutoTrigger) => boolean } | null {
  if (a.type === 'MOVE_CARD') {
    const from = cardListId(before, a.cardId);
    if (!from || from === a.toListId) return null;
    return { cardId: a.cardId, hits: (t) => t.type === 'moved_to' && t.listId === a.toListId };
  }
  if (a.type === 'ADD_CARD') return { cardId: a.cardId, hits: (t) => t.type === 'added_to' && t.listId === a.listId };
  if (a.type === 'UPDATE_CARD') {
    const c = before.cards[a.cardId];
    if (!c) return null;
    const completedNow = a.patch.completed === true && !c.completed;
    const list = a.patch.checklist;
    const allDone = (l: Card['checklist']) => l.length > 0 && l.every((i) => i.done);
    const checklistNow = !!list && allDone(list) && !allDone(c.checklist);
    if (!completedNow && !checklistNow) return null;
    return { cardId: a.cardId, hits: (t) => (t.type === 'completed' && completedNow) || (t.type === 'checklist_done' && checklistNow) };
  }
  return null;
}

/** The changes and notifications that the board's automations add after `a` was applied to `before`. */
export function automationFollowUps(
  before: BoardData,
  after: BoardData,
  a: BoardActionBody,
  today = new Date(),
): { actions: BoardActionBody[]; notify: AutoNotify[] } {
  const rules = (before.automations ?? []).filter((r) => r.on);
  const out = { actions: [] as BoardActionBody[], notify: [] as AutoNotify[] };
  if (!rules.length) return out;
  const fired = firedBy(before, a);
  if (!fired) return out;
  const card = after.cards[fired.cardId];
  if (!card) return out;

  for (const rule of rules.filter((r) => fired.hits(r.trigger))) {
    const patch: Partial<Card> = {};
    let moveTo: string | null = null;
    const did: string[] = [];
    const cur = { ...card, ...patch };
    for (const x of rule.actions) {
      const c = { ...cur, ...patch };
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
        case 'due_in': {
          const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Math.max(0, Math.round(x.days)));
          if (c.due !== iso(d)) (patch.due = iso(d)), (patch.dueDone = false), did.push(`set the due date of {card}`);
          break;
        }
        case 'clear_due':
          if (c.due) (patch.due = null), did.push('removed the due date of {card}');
          break;
        case 'add_label':
          if (after.labels.some((l) => l.id === x.labelId) && !c.labelIds.includes(x.labelId)) (patch.labelIds = [...c.labelIds, x.labelId]), did.push('added a label to {card}');
          break;
        case 'check_all':
          if (c.checklist.some((i) => !i.done)) (patch.checklist = c.checklist.map((i) => ({ ...i, done: true }))), did.push('ticked the checklist of {card}');
          break;
        case 'notify': {
          const ids =
            x.to === 'members' ? [...new Set([...c.assignees, ...(c.owners ?? [])])] : x.to === 'owners' ? [...new Set(c.owners?.length ? c.owners : [c.createdBy])] : [x.to];
          out.notify.push({ userIds: ids.filter(Boolean), cardId: card.id, body: x.message.trim() || 'An automation ran on this card' });
          break;
        }
      }
    }
    if (Object.keys(patch).length) out.actions.push({ type: 'UPDATE_CARD', cardId: card.id, patch, note: `Automation: ${did.join(', ')}` });
    if (moveTo) out.actions.push({ type: 'MOVE_CARD', cardId: card.id, toListId: moveTo, toIndex: 0 });
  }
  return out;
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
