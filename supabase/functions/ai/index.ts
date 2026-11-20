// Karlo "ai" Edge Function (Deno): AI help on a card, powered by Claude.
//   POST { action: 'summary' | 'checklist' | 'describe', boardId, cardId }
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

    const { action, boardId, cardId } = await req.json().catch(() => ({}));
    if (!['summary', 'checklist', 'describe'].includes(action) || typeof boardId !== 'string' || typeof cardId !== 'string') {
      return json({ error: 'bad_request', message: 'Expected { action, boardId, cardId }.' }, 400);
    }

    // Read the board as the signed-in caller (row-level security applies).
    const auth = req.headers.get('Authorization') ?? '';
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: board } = await db.from('boards').select('title, data').eq('id', boardId).maybeSingle();
    if (!board) return json({ error: 'forbidden', message: "You can't open this board." }, 403);
    const context = cardContext(board, cardId);
    if (!context) return json({ error: 'not_found', message: 'Card not found.' }, 404);

    const client = new Anthropic({ apiKey });
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
