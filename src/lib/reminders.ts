import { supabase } from '../supabase';

/** Per-person reminder choices (database: reminder_settings; the hourly job reads them). */
export interface ReminderSettings {
  due_reminders: boolean;
  remind_before: number; // days before the due date; 0 = only on the day
  overdue: boolean;
  digest: boolean;
  digest_hour: number; // local hour, 0–23
  timezone: string;
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  due_reminders: true,
  remind_before: 1,
  overdue: true,
  digest: true,
  digest_hour: 8,
  timezone: 'Asia/Dubai',
};

export const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dubai';
  } catch {
    return 'Asia/Dubai';
  }
};

async function uid() {
  const { data } = await supabase!.auth.getUser();
  return data.user?.id ?? null;
}

export async function getReminderSettings(): Promise<ReminderSettings> {
  if (!supabase) return DEFAULT_REMINDERS;
  const id = await uid();
  if (!id) return DEFAULT_REMINDERS;
  const { data } = await supabase.from('reminder_settings').select('*').eq('user_id', id).maybeSingle();
  return data ? { ...DEFAULT_REMINDERS, ...(data as Partial<ReminderSettings>) } : { ...DEFAULT_REMINDERS, timezone: browserTimezone() };
}

export async function saveReminderSettings(s: ReminderSettings): Promise<void> {
  if (!supabase) return;
  const id = await uid();
  if (!id) throw new Error('Not signed in');
  const { error } = await supabase.from('reminder_settings').upsert({ user_id: id, ...s, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

/** Keeps the saved time zone in step with this device, so the morning digest arrives at the right hour. */
export async function syncTimezone(): Promise<void> {
  if (!supabase) return;
  const id = await uid();
  if (!id) return;
  const tz = browserTimezone();
  const { data } = await supabase.from('reminder_settings').select('timezone').eq('user_id', id).maybeSingle();
  if (!data) await supabase.from('reminder_settings').insert({ user_id: id, timezone: tz });
  else if (data.timezone !== tz && !localStorage.getItem('karlo-tz-pinned')) await supabase.from('reminder_settings').update({ timezone: tz }).eq('user_id', id);
}

export const hourLabel = (h: number) =>
  new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
