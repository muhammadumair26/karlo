/* Card helpers that run on the device itself: free, instant, and nothing leaves the phone.
   They read the card (title, description, checklist, dates, comments) and suggest a summary,
   checklist steps or a clearer description. Simple rules, not AI — the user decides what to apply. */
import { cardTimeMs, formatDuration } from './time';
import { dueStatus, formatDate } from './filters';
import type { Card } from './types';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const BUG = /\b(bug|issue|error|fix|broken|crash|fail|failing|not working|doesn'?t work|wrong|missing)\b/i;
export const looksLikeBug = (c: Card) => BUG.test(c.title) || BUG.test(c.description.slice(0, 200));

function daysUntil(date: string) {
  const d = new Date(date + 'T00:00:00').getTime();
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d - t.getTime()) / 86_400_000);
}

/** Where the card stands, and the most useful next step. */
export function summarise(card: Card, opts: { listTitle?: string; names: (id: string) => string }) {
  const parts: string[] = [];
  const open = card.checklist.filter((i) => !i.done);
  const done = card.checklist.length - open.length;

  parts.push(card.completed ? `“${clip(card.title, 80)}” is marked complete.` : `“${clip(card.title, 80)}” is ${opts.listTitle ? `in ${opts.listTitle}` : 'open'}.`);

  const who = card.assignees.map(opts.names).filter(Boolean);
  if (who.length) parts.push(`${who.join(', ')} ${who.length > 1 ? 'are' : 'is'} on it.`);
  else if (!card.completed) parts.push('Nobody is assigned yet.');

  if (card.due) {
    const st = dueStatus(card);
    const d = daysUntil(card.due);
    if (st === 'done') parts.push(`The due date (${formatDate(card.due)}) is met.`);
    else if (st === 'overdue') parts.push(`It was due ${formatDate(card.due)} — ${plural(-d, 'day')} overdue.`);
    else parts.push(d === 0 ? 'It’s due today.' : d === 1 ? 'It’s due tomorrow.' : `It’s due ${formatDate(card.due)} (in ${plural(d, 'day')}).`);
  }
  if (card.checklist.length) parts.push(`Checklist: ${done} of ${card.checklist.length} done.`);
  const ms = cardTimeMs(card, Date.now());
  if (ms > 0) parts.push(`${formatDuration(ms)} tracked so far.`);
  if (card.comments.length) {
    const last = [...card.comments].sort((a, b) => b.createdAt - a.createdAt)[0];
    parts.push(`${plural(card.comments.length, 'comment')}; the latest from ${last.authorName.split(' ')[0]}: “${clip(clean(last.text), 90)}”`);
  }
  if (card.attachments.length) parts.push(`${plural(card.attachments.length, 'file')} attached.`);

  let next: string;
  if (card.completed) next = 'Nothing left to do — archive it when you’re ready.';
  else if (dueStatus(card) === 'overdue') next = open.length ? `It’s late: finish “${clip(open[0].text, 60)}”, or move the due date.` : 'It’s late: wrap it up, or move the due date.';
  else if (open.length) next = `${cap(clip(open[0].text, 80))}.`.replace(/\.\.$/, '.');
  else if (card.checklist.length && !open.length) next = 'Every step is ticked — mark the card complete.';
  else if (!card.description.trim()) next = 'Add a description so everyone knows what “done” looks like.';
  else if (!who.length) next = 'Assign someone to it.';
  else if (!card.due) next = 'Set a due date.';
  else next = 'Break it into checklist steps so progress is easy to see.';

  return { summary: parts.join(' '), next_step: next };
}

/** Steps for the checklist: from the description's lines or sentences, or sensible steps for the kind of card. */
export function checklistSteps(card: Card): string[] {
  const have = new Set(card.checklist.map((i) => i.text.toLowerCase().trim()));
  const fromText = (text: string) => {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const listed = lines.filter((l) => /^([-*•]|\d+[.)]|\[\s?[x ]?\])\s+/i.test(l));
    const raw = listed.length >= 2 ? listed : lines.length >= 3 ? lines : text.split(/(?<=[.!?])\s+|;\s+|\n+/);
    return raw
      .map((l) => cap(clean(l.replace(/^([-*•]|\d+[.)]|\[\s?[x ]?\])\s+/i, '').replace(/[.;:]+$/, ''))))
      .filter((l) => l.length >= 4 && l.length <= 140 && !/^(goal|details|done when|acceptance criteria)$/i.test(l));
  };
  let items = card.description.trim() ? fromText(card.description) : [];
  if (items.length < 2) {
    items = looksLikeBug(card)
      ? ['Reproduce the problem and note the steps', 'Find the cause', 'Fix it', 'Test the fix (phone and computer)', 'Release and let the reporter know']
      : ['Agree exactly what it should do', 'Design the screen or flow', 'Build it', 'Test it on phone and computer', 'Release it and tell the team'];
  }
  const out: string[] = [];
  for (const i of items) if (!have.has(i.toLowerCase()) && !out.some((o) => o.toLowerCase() === i.toLowerCase())) out.push(i);
  return out.slice(0, 12);
}

/** A clearer description: goal, details and what "done" means. */
export function betterDescription(card: Card): string {
  const bug = looksLikeBug(card);
  const desc = card.description.trim();
  if (/^Goal\n/.test(desc)) return desc; // already in this shape
  const goal = bug ? `Fix: ${card.title.replace(/[.\s]+$/, '')}.` : `${cap(card.title.replace(/[.\s]+$/, ''))}.`;
  const details = desc
    ? desc
    : bug
      ? '- Where it happens:\n- Steps to reproduce:\n- What should happen:\n- What happens instead:'
      : '- Who it’s for:\n- How it should work:\n- Anything to avoid:';
  const done = card.checklist.length
    ? card.checklist.map((i) => `- ${i.text}`)
    : bug
      ? ['- The problem no longer happens', '- Nothing else broke', '- Checked on phone and computer']
      : ['- It works as described above', '- It’s been tested on phone and computer', '- The team knows it’s live'];
  return `Goal\n${goal}\n\nDetails\n${details}\n\nDone when\n${done.join('\n')}`;
}
