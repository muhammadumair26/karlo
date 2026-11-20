import { supabase } from '../supabase';

/** Google / Apple / Outlook calendar subscription for the signed-in person (see functions/calendar). */
export interface CalendarFeed {
  token: string;
  scope: 'mine' | 'all';
}

let base = '';
try {
  base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
} catch {
  /* not under Vite */
}

export const feedUrl = (token: string) => `${base}/functions/v1/calendar?token=${token}`;
/** webcal:// makes Apple Calendar / Outlook offer to subscribe. */
export const webcalUrl = (token: string) => feedUrl(token).replace(/^https?:/, 'webcal:');
/** Opens Google Calendar's "add this calendar" screen (desktop browsers). */
export const googleAddUrl = (token: string) => `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(token))}`;

/** Your feed, created the first time you ask for it. */
export async function getFeed(): Promise<CalendarFeed> {
  if (!supabase) throw new Error('Not connected');
  const { data: user } = await supabase.auth.getUser();
  const uid = user.user?.id;
  if (!uid) throw new Error('Not signed in');
  const { data } = await supabase.from('calendar_feeds').select('token, scope').eq('user_id', uid).maybeSingle();
  if (data) return data as CalendarFeed;
  const { data: made, error } = await supabase.from('calendar_feeds').insert({ user_id: uid }).select('token, scope').single();
  if (error) throw new Error(error.message);
  return made as CalendarFeed;
}

export async function setFeedScope(scope: CalendarFeed['scope']) {
  if (!supabase) return;
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from('calendar_feeds').update({ scope }).eq('user_id', user.user?.id ?? '');
  if (error) throw new Error(error.message);
}

/** New secret link; the old one stops working right away. */
export async function resetFeed(): Promise<string> {
  if (!supabase) throw new Error('Not connected');
  const { data, error } = await supabase.rpc('reset_calendar_feed');
  if (error) throw new Error(error.message);
  return data as string;
}
