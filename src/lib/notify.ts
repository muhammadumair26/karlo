import { supabase } from '../supabase';

export * from './notifyRules';
import type { Draft, NotificationRow } from './notifyRules';

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
