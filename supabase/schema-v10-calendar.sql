-- Karlo v10: calendar feeds (Google Calendar / Apple / Outlook "subscribe from URL").
-- Each person gets one secret link. Anyone holding the link can read that person's card dates, so
-- it can be reset (new token) at any time. Safe to re-run.

create table if not exists public.calendar_feeds (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  token      text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  scope      text not null default 'mine' check (scope in ('mine', 'all')),
  created_at timestamptz not null default now()
);

alter table public.calendar_feeds enable row level security;
drop policy if exists "calendar feed own" on public.calendar_feeds;
create policy "calendar feed own" on public.calendar_feeds for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
grant select, insert, update, delete on public.calendar_feeds to authenticated;

-- New secret link (old one stops working immediately).
create or replace function public.reset_calendar_feed() returns text
language sql security definer set search_path = public as $$
  insert into calendar_feeds (user_id) values (auth.uid())
  on conflict (user_id) do update
    set token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), created_at = now()
  returning token
$$;
grant execute on function public.reset_calendar_feed() to authenticated;

select 'ok' as result;
