-- Karlo cloud sync: run this once in Supabase → SQL Editor → New query → Run.

-- One row per user holding all their boards, lists and cards as JSON.
create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  client_id  text,
  updated_at timestamptz not null default now()
);

-- Only signed-in users may touch the table (RLS below limits them to their own row).
grant select, insert, update on public.user_state to authenticated;

-- Row Level Security: each user can only see and change their own row.
alter table public.user_state enable row level security;

drop policy if exists "Users read own state" on public.user_state;
create policy "Users read own state" on public.user_state
  for select using (auth.uid() = user_id);

drop policy if exists "Users insert own state" on public.user_state;
create policy "Users insert own state" on public.user_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own state" on public.user_state;
create policy "Users update own state" on public.user_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Live updates across devices.
alter publication supabase_realtime add table public.user_state;
