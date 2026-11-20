// Karlo "ai" Edge Function (Deno): AI help on a card, powered by Claude.
//   POST { action: 'summary' | 'checklist' | 'describe', boardId, cardId }
//   POST { action: 'voice', boardId, text, today, currency } → what to add (card / expense / income) for the app to confirm
// The caller must be signed in (Verify JWT ON). The board is read with the caller's own login, so
// row-level security decides access — nobody can ask about a card they can't open.
// Needs the secret ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Action = 'summary' | 'checklist' | 'describe';

// Voice / typed command → one thing to add. Every field is always present ('' or 0 when not said).
const VOICE_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['add_card', 'add_expense', 'add_income', 'unknown'] },
    title: { type: 'string', description: 'Card title, or what the money was for / where it came from' },
    list: { type: 'string', description: 'Exactly one of the board list names if the person named or clearly implied a list, else empty' },
    due: { type: 'string', description: 'Due date YYYY-MM-DD resolved against today, else empty' },
    member: { type: 'string', description: 'Exactly one of the people names if someone should be responsible, else empty' },
    description: { type: 'string', description: 'Extra details for a card, else empty' },
    amount: { type: 'number', description: 'Money amount, 0 when not money' },
    currency: { type: 'string', description: 'ISO code (AED, USD, PKR, SAR, EUR, GBP) if said or clearly implied (dollars=USD, dirhams=AED, rupees=PKR), else empty' },
    category: { type: 'string', description: 'Best matching category from the list given, else a short new one' },
    date: { type: 'string', description: 'Date of the money entry YYYY-MM-DD, default today' },
    paid_by: { type: 'string', enum: ['me', 'company', ''], description: 'Who paid / received: me (the speaker) or the company account' },
    reply: { type: 'string', description: 'One short sentence confirming what will be added, or asking to rephrase when unknown' },
  },
  required: ['intent', 'title', 'list', 'due', 'member', 'description', 'amount', 'currency', 'category', 'date', 'paid_by', 'reply'],
  additionalProperties: false,
};

const SCHEMAS: Record<Action, Record<string, unknown>> = {
  summary: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '2-4 sentences: what the card is about and where it stands' },
      next_step: { type: 'string', description: 'The single most useful next action, one sentence' },
    },
    required: ['summary', 'next_step'],
    additionalProperties: false,
  },
  checklist: {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'string' }, description: '3 to 10 concrete, checkable steps, each under 90 characters' },
    },
    required: ['items'],
    additionalProperties: false,
  },
  describe: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'The improved card description in plain Markdown' },
    },
    required: ['description'],
    additionalProperties: false,
  },
};

const TASKS: Record<Action, string> = {
  summary: 'Summarise this card for a busy teammate: what it is about, what has happened (comments, checklist progress) and where it stands. Then give the single most useful next step.',
  checklist:
    'Turn this card into a practical checklist of 3 to 10 concrete steps someone can tick off, in a sensible order. Skip steps that are already on the existing checklist. Keep each step short and actionable.',
  describe:
    'Rewrite the card description so it is clear and complete: a one-line goal, then short sections for details, acceptance criteria (as a bullet list) and any open questions. Keep every fact from the original; do not invent requirements. Keep @mentions exactly as written.',
};

const SYSTEM =
  'You help a small team manage work in Karlo, a Trello-like project tool. Be concise, specific and practical. ' +
  'Write in the same language as the card. Use only facts from the card; if something is unknown, say so briefly rather than guessing.';

// deno-lint-ignore no-explicit-any
function cardContext(board: { title: string; data: any }, cardId: string): string | null {
  const d = board.data ?? {};
  const c = d.cards?.[cardId];
  if (!c) return null;
  const list = Object.values(d.lists ?? {}).find((l: any) => (l.cardIds ?? []).includes(cardId)) as any;
  const labels = (c.labelIds ?? []).map((id: string) => (d.labels ?? []).find((l: any) => l.id === id)?.name).filter(Boolean);
  const checklist = (c.checklist ?? []).map((i: any) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n');
  const comments = (c.comments ?? [])
    .slice(-15)
    .map((m: any) => `- ${m.byName ?? m.authorName ?? 'Someone'}: ${String(m.text ?? '').slice(0, 600)}`)
    .join('\n');
  return [
    `Board: ${board.title}`,
    `List: ${list?.title ?? 'unknown'}`,
    `Card title: ${c.title}`,
    c.due ? `Due: ${c.due}${c.dueDone || c.completed ? ' (done)' : ''}` : 'Due: not set',
    c.priority && c.priority !== 'none' ? `Priority: ${c.priority}` : '',
    labels.length ? `Labels: ${labels.join(', ')}` : '',
    `Description:\n${String(c.description || '(empty)').slice(0, 6000)}`,
    checklist ? `Checklist:\n${checklist}` : 'Checklist: (none)',
    comments ? `Recent comments:\n${comments}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'not_configured', message: 'AI help is not set up yet: add ANTHROPIC_API_KEY in Supabase → Edge Functions → Secrets.' }, 503);

    const body = await req.json().catch(() => ({}));
    const { action, boardId, cardId } = body;
    const isVoice = action === 'voice';
    if (typeof boardId !== 'string' || (!isVoice && (!['summary', 'checklist', 'describe'].includes(action) || typeof cardId !== 'string'))) {
      return json({ error: 'bad_request', message: 'Expected { action, boardId, cardId } or { action: "voice", boardId, text }.' }, 400);
    }

    // Read the board as the signed-in caller (row-level security applies).
    const auth = req.headers.get('Authorization') ?? '';
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: board } = await db.from('boards').select('title, data').eq('id', boardId).maybeSingle();
    if (!board) return json({ error: 'forbidden', message: "You can't open this board." }, 403);
    const client = new Anthropic({ apiKey });

    if (isVoice) {
      const text = String(body.text ?? '').trim().slice(0, 1000);
      if (!text) return json({ error: 'bad_request', message: 'Say or type what to add.' }, 400);
      // deno-lint-ignore no-explicit-any
      const d: any = board.data ?? {};
      const lists = (d.listOrder ?? Object.keys(d.lists ?? {})).map((id: string) => d.lists?.[id]).filter((l: any) => l && !l.archived).map((l: any) => l.title);
      const { data: people } = await db.rpc('board_people', { p_board: boardId });
      const names = [...new Set(((people ?? []) as { name: string }[]).map((p) => p.name))];
      const { data: money } = await db.from('expense_settings').select('currency').eq('board_id', boardId).maybeSingle();
      const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today ?? '') ? body.today : new Date().toISOString().slice(0, 10);
      const context = [
        `Today: ${today} (${new Date(today + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })})`,
        `Board: ${board.title}`,
        `Lists: ${lists.join(' | ') || '(none)'}`,
        `People: ${names.join(' | ') || '(none)'}`,
        money
          ? `Money tracking is ON. Main currency: ${money.currency}. Cost categories: Development | Hosting & software | Marketing | Salaries | Legal & licenses | Office & rent | Travel | Inventory | Bank & fees | Other. Income categories: Sales | Services | Investment | Refund | Other income.`
          : 'Money tracking is OFF for this person on this board: never return add_expense or add_income.',
      ].join('\n');
      const response = await client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 3000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: VOICE_SCHEMA } },
        system:
          'You turn a short spoken or typed command into one item to add in Karlo, a project and money tool. ' +
          'Speech-to-text may mishear words; pick the closest list or person name from the ones given, never invent a list or person. ' +
          'Resolve relative dates ("tomorrow", "Friday", "next week") against today. Keep titles short and clean (no filler words). ' +
          'If the command is not about adding a card, cost or income, use intent "unknown" and say briefly what you can do.',
        messages: [{ role: 'user', content: `<context>\n${context}\n</context>\n\n<command>\n${text}\n</command>` }],
      });
      if (response.stop_reason === 'refusal') return json({ error: 'refused', message: "The AI couldn't help with that." }, 422);
      const out = response.content.find((b) => b.type === 'text');
      if (!out || out.type !== 'text') return json({ error: 'empty', message: 'No answer came back. Try again.' }, 502);
      return json({ action, result: JSON.parse(out.text) });
    }

    const context = cardContext(board, cardId);
    if (!context) return json({ error: 'not_found', message: 'Card not found.' }, 404);

    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMAS[action as Action] } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `${TASKS[action as Action]}\n\n<card>\n${context}\n</card>` }],
    });

    if (response.stop_reason === 'refusal') return json({ error: 'refused', message: "The AI couldn't help with this card." }, 422);
    if (response.stop_reason === 'max_tokens') return json({ error: 'too_long', message: 'The answer was too long. Try again.' }, 502);
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return json({ error: 'empty', message: 'No answer came back. Try again.' }, 502);
    return json({ action, result: JSON.parse(text.text) });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'bad_key', message: 'The AI key is not valid. Check ANTHROPIC_API_KEY in Supabase secrets.' }, 503);
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'busy', message: 'The AI is busy right now. Try again in a minute.' }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: 'api', message: `AI error (${e.status}). Try again.` }, 502);
    console.error(e);
    return json({ error: 'server', message: String(e) }, 500);
  }
});
