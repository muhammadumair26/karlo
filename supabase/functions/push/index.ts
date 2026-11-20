// Karlo "push" Edge Function (Deno).
//   GET  → { publicKey }  (VAPID public key the browser needs to subscribe)
//   POST { notification_id } → sends that notification as a Web Push to all the recipient's devices.
// Called by a database trigger on notifications INSERT. Each notification is pushed at most once and
// only within 10 minutes of being created, so calling it again can't be used to spam anyone.
// The VAPID key pair is generated here on first use and stored in push_config (service-role only).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const SITE = 'https://karlo.orionsoftsol.com';
// Server key: older projects expose SUPABASE_SERVICE_ROLE_KEY; newer ones SUPABASE_SECRET_KEYS (JSON) / SUPABASE_SECRET_KEY.
function serverKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const single = Deno.env.get('SUPABASE_SECRET_KEY');
  if (single) return single;
  const many = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (many) {
    try {
      const v = JSON.parse(many);
      const first = Array.isArray(v) ? v[0] : Object.values(v)[0];
      if (typeof first === 'string') return first;
    } catch {
      return many;
    }
  }
  throw new Error('No server key available to the function');
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, serverKey(), { auth: { persistSession: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function vapidKeys(): Promise<{ public_key: string; private_key: string }> {
  const { data } = await db.from('push_config').select('public_key, private_key').eq('id', 1).maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  const { error } = await db.from('push_config').insert({ id: 1, public_key: k.publicKey, private_key: k.privateKey });
  if (error) {
    // Another request created them first — use those.
    const { data: again } = await db.from('push_config').select('public_key, private_key').eq('id', 1).single();
    return again!;
  }
  return { public_key: k.publicKey, private_key: k.privateKey };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method === 'GET') return json({ publicKey: (await vapidKeys()).public_key });

    const { notification_id } = await req.json().catch(() => ({}));
    if (!notification_id) return json({ error: 'notification_id required' }, 400);

    // Claim the notification (only fresh, not-yet-pushed ones).
    const { data: n } = await db
      .from('notifications')
      .update({ pushed_at: new Date().toISOString() })
      .eq('id', notification_id)
      .is('pushed_at', null)
      .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
      .select('id, user_id, board_id, card_id, card_title, list_title, body, actor:profiles!notifications_actor_id_fkey(name), board:boards(title)')
      .maybeSingle();
    if (!n) return json({ skipped: true });

    const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id);
    if (!subs?.length) return json({ sent: 0 });

    const k = await vapidKeys();
    webpush.setVapidDetails(SITE, k.public_key, k.private_key);
    // deno-lint-ignore no-explicit-any
    const actor = (n as any).actor?.name ?? 'Karlo'; // no actor = Karlo's own reminders / digest
    // deno-lint-ignore no-explicit-any
    const boardTitle = (n as any).board?.title ?? 'Karlo';
    const payload = JSON.stringify({
      title: n.card_title ? `${actor} · ${n.card_title}` : actor,
      body: n.body,
      board: `${boardTitle}${n.list_title ? ': ' + n.list_title : ''}`,
      url: n.board_id ? `${SITE}/?board=${n.board_id}${n.card_id ? `&card=${n.card_id}` : ''}` : `${SITE}/`,
      tag: n.card_id ?? n.id,
    });

    let sent = 0;
    const gone: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            TTL: 24 * 3600,
            urgency: 'high',
          });
          sent++;
        } catch (e) {
          // deno-lint-ignore no-explicit-any
          const code = (e as any)?.statusCode;
          if (code === 404 || code === 410) gone.push(s.id); // device unsubscribed
          // deno-lint-ignore no-explicit-any
          else console.error('push failed', code, (e as any)?.body ?? String(e));
        }
      }),
    );
    if (gone.length) await db.from('push_subscriptions').delete().in('id', gone);
    return json({ sent, removed: gone.length });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
