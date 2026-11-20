// Karlo "push" Edge Function (Deno).
//   GET  → { publicKey }  (VAPID public key the browser needs to subscribe)
//   POST { notification_id } → sends that notification as a Web Push to all the recipient's devices.
// Called by a database trigger on notifications INSERT. Each notification is pushed at most once and
// only within 10 minutes of being created, so calling it again can't be used to spam anyone.
// The VAPID key pair is generated here on first use and stored in push_config (service-role only).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { importPKCS8, SignJWT } from 'npm:jose@5.9.6';

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

// ---------------------------------------------------------------- phone app (Firebase Cloud Messaging)
// Needs the FCM_SERVICE_ACCOUNT secret (the Firebase service-account JSON). Without it, phone pushes are skipped.
type ServiceAccount = { project_id: string; client_email: string; private_key: string };
let fcmToken: { value: string; exp: number } | null = null;
function serviceAccount(): ServiceAccount | null {
  let raw = Deno.env.get('FCM_SERVICE_ACCOUNT')?.trim();
  if (!raw) return null;
  // Only the private key pasted (with or without the BEGIN/END lines): pair it with Karlo's Firebase service account.
  const keyBody = raw.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/[\s"]/g, '');
  if (!raw.startsWith('{') && keyBody.startsWith('MII')) {
    return {
      project_id: Deno.env.get('FCM_PROJECT_ID') ?? 'karlo-b4dbd',
      client_email: Deno.env.get('FCM_CLIENT_EMAIL') ?? 'firebase-adminsdk-fbsvc@karlo-b4dbd.iam.gserviceaccount.com',
      private_key: `-----BEGIN PRIVATE KEY-----\n${keyBody.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`,
    };
  }
  if (!raw.startsWith('{')) {
    try {
      raw = atob(raw).trim(); // pasted as base64
    } catch {
      /* not base64 */
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Dashboards sometimes turn the key's "\n" escapes into real line breaks; read the three fields directly.
    const field = (k: string) => raw!.match(new RegExp(`"${k}"\\s*:\\s*"([\\s\\S]*?)"\\s*[,}]`))?.[1];
    const project_id = field('project_id');
    const client_email = field('client_email');
    const private_key = field('private_key')?.replace(/\\n/g, '\n');
    if (project_id && client_email && private_key?.includes('PRIVATE KEY')) return { project_id, client_email, private_key };
    console.error(`FCM_SERVICE_ACCOUNT could not be read (length ${raw.length}, starts with "${raw.slice(0, 1)}")`);
    return null;
  }
}
async function fcmAccessToken(sa: ServiceAccount): Promise<string> {
  if (fcmToken && fcmToken.exp > Date.now() + 60_000) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await importPKCS8(sa.private_key, 'RS256'));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('FCM auth failed: ' + JSON.stringify(j));
  fcmToken = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return fcmToken.value;
}
/** Sends to the person's phones; returns [sent, removed]. */
async function sendToPhones(userId: string, msg: { title: string; body: string; url: string; tag: string }): Promise<[number, number]> {
  const sa = serviceAccount();
  if (!sa) return [0, 0];
  const { data: tokens } = await db.from('native_push_tokens').select('token').eq('user_id', userId);
  if (!tokens?.length) return [0, 0];
  const access = await fcmAccessToken(sa);
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    tokens.map(async ({ token }) => {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: msg.title, body: msg.body },
            data: { url: msg.url },
            android: { priority: 'high', notification: { channel_id: 'karlo', tag: msg.tag, color: '#2563eb' } },
          },
        }),
      });
      if (r.ok) sent++;
      else {
        const t = await r.text();
        if (r.status === 404 || t.includes('UNREGISTERED') || t.includes('registration-token-not-registered')) gone.push(token);
        else console.error('fcm failed', r.status, t);
      }
    }),
  );
  if (gone.length) await db.from('native_push_tokens').delete().in('token', gone);
  return [sent, gone.length];
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

    const p = JSON.parse(payload);
    const phones = sendToPhones(n.user_id, { title: p.title, body: n.body, url: p.url, tag: p.tag }).catch((e) => {
      console.error('phone push failed', String(e));
      return [0, 0] as [number, number];
    });

    let sent = 0;
    const gone: string[] = [];
    await Promise.all(
      (subs ?? []).map(async (s) => {
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
    const [phoneSent, phoneRemoved] = await phones;
    return json({ sent, removed: gone.length, phones: phoneSent, phonesRemoved: phoneRemoved });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
