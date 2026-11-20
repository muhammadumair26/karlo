// Karlo calendar feed: GET /functions/v1/calendar?token=<secret>
// Returns an iCalendar (.ics) file of card dates for the person who owns the token, so Google Calendar,
// Apple Calendar and Outlook can subscribe ("From URL") and refresh it on their own.
// Deploy with "Verify JWT" OFF — calendar apps can't send a Supabase login.

const SITE = 'https://karlo.orionsoftsol.com';
const HOST = 'karlo.orionsoftsol.com';

type Card = {
  id: string;
  title: string;
  description?: string;
  start?: string | null;
  due?: string | null;
  completed?: boolean;
  dueDone?: boolean;
  archived?: boolean;
  assignees?: string[];
  owners?: string[];
};
type BoardData = {
  cards?: Record<string, Card>;
  lists?: Record<string, { id: string; title: string; cardIds: string[]; archived?: boolean }>;
  listOrder?: string[];
};
export type FeedBoard = { id: string; title: string; data: BoardData };

// ---------------------------------------------------------------- iCalendar text (pure, tested)

/** RFC 5545 text escaping. */
export const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold lines longer than 75 octets (continuation lines start with a space). */
export function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const ymd = (d: string) => d.replace(/-/g, '');
const nextDay = (d: string) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** One all-day event per card with a due date (spanning from the start date when there is one). */
export function buildIcs(boards: FeedBoard[], opts: { userId: string; scope: 'mine' | 'all'; now?: Date }): string {
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Orion Soft Sol//Karlo//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(opts.scope === 'mine' ? 'Karlo – my cards' : 'Karlo – all my boards')}`,
    'X-WR-CALDESC:Card due dates from Karlo',
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  for (const b of boards) {
    const data = b.data ?? {};
    const lists = data.lists ?? {};
    for (const lid of data.listOrder ?? Object.keys(lists)) {
      const list = lists[lid];
      if (!list || list.archived) continue;
      for (const cid of list.cardIds ?? []) {
        const c = data.cards?.[cid];
        if (!c || c.archived || !isDate(c.due)) continue;
        const mine = (c.assignees ?? []).includes(opts.userId) || (c.owners ?? []).includes(opts.userId);
        if (opts.scope === 'mine' && !mine) continue;
        const start = isDate(c.start) && c.start <= c.due ? c.start : c.due;
        const done = c.completed || c.dueDone;
        const link = `${SITE}/?board=${b.id}&card=${c.id}`;
        const desc = [`${b.title} · ${list.title}`, done ? 'Completed' : '', (c.description ?? '').slice(0, 500), link].filter(Boolean).join('\n\n');
        lines.push(
          'BEGIN:VEVENT',
          `UID:${c.id}@${HOST}`,
          `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${ymd(start)}`,
          `DTEND;VALUE=DATE:${ymd(nextDay(c.due))}`,
          `SUMMARY:${icsText((done ? '✓ ' : '') + (c.title || 'Untitled card'))}`,
          `DESCRIPTION:${icsText(desc)}`,
          `URL:${link}`,
          `CATEGORIES:${icsText(b.title)}`,
          'TRANSP:TRANSPARENT',
          'END:VEVENT',
        );
      }
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- HTTP handler

type DenoLike = { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
// Read from globalThis so this file also loads in Node (for tests) without clashing with Deno's own types.
const D = (globalThis as unknown as { Deno?: DenoLike }).Deno;

async function handle(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const notFound = () => new Response('Calendar not found. Get a new link from Karlo.', { status: 404 });
  if (!/^[a-f0-9]{40,80}$/.test(token)) return notFound();

  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const sb = createClient(D!.env.get('SUPABASE_URL')!, D!.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: feed } = await sb.from('calendar_feeds').select('user_id, scope').eq('token', token).maybeSingle();
  if (!feed) return notFound();

  // Boards this person can open: through a workspace or a direct board invite.
  const [{ data: wm }, { data: bm }] = await Promise.all([
    sb.from('workspace_members').select('workspace_id').eq('user_id', feed.user_id),
    sb.from('board_members').select('board_id').eq('user_id', feed.user_id),
  ]);
  const ws = (wm ?? []).map((r: { workspace_id: string }) => r.workspace_id);
  const ids = (bm ?? []).map((r: { board_id: string }) => r.board_id);
  const or = [ws.length ? `workspace_id.in.(${ws.join(',')})` : '', ids.length ? `id.in.(${ids.join(',')})` : ''].filter(Boolean).join(',');
  const boards: FeedBoard[] = [];
  if (or) {
    const { data } = await sb.from('boards').select('id, title, data').or(or);
    boards.push(...((data ?? []) as FeedBoard[]));
  }

  return new Response(buildIcs(boards, { userId: feed.user_id, scope: feed.scope === 'all' ? 'all' : 'mine' }), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="karlo.ics"',
      'cache-control': 'private, max-age=300',
    },
  });
}

if (D) D.serve(handle);
