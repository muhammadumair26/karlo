-- Karlo v6: Web Push (browser / home-screen app notifications). Run once in Supabase → SQL Editor. Safe to re-run.
-- Flow: a row is inserted into notifications → trigger calls the `push` Edge Function → it sends
-- a Web Push to every device the recipient has turned push on for.

-- Devices that turned on push (one row per browser/device).
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "push subs own" on public.push_subscriptions;
create policy "push subs own" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;
revoke all on public.push_subscriptions from anon;

-- Server-only settings (the push keys are generated and kept here by the Edge Function).
-- RLS on with no policies = only the service role (the Edge Function) can read it.
create table if not exists public.push_config (
  id          int primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- Each notification is pushed at most once.
alter table public.notifications add column if not exists pushed_at timestamptz;

-- Call the Edge Function when a notification is created (async, via pg_net).
create extension if not exists pg_net with schema extensions;

create or replace function public.push_notification() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://jaizqafmiiagdgbnavqu.supabase.co/functions/v1/push',
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  return new;
exception when others then
  return new; -- never block creating a notification because push failed
end $$;

drop trigger if exists on_notification_push on public.notifications;
create trigger on_notification_push
  after insert on public.notifications
  for each row execute function public.push_notification();

-- The push Edge Function runs as service_role; this project doesn't grant new tables to it automatically.
grant select, insert, update, delete on public.push_config, public.push_subscriptions, public.notifications to service_role;
grant select on public.profiles, public.boards to service_role;
