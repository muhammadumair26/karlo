-- Karlo v15: "Ask Claude to work on it".
-- A platform admin (only them — nobody else sees the button) sends a card to one of their projects.
-- The task waits here; a small helper on their Mac (tools/claude-runner.mjs) picks it up with a private
-- key, runs Claude Code in the project folder, and reports back (working → done / failed).

create table if not exists public.claude_projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  path       text not null, -- folder on the Mac, e.g. /Users/me/Projects/orion-souq
  created_at timestamptz not null default now()
);

create table if not exists public.claude_tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id   uuid references public.claude_projects (id) on delete set null,
  project_name text not null,
  project_path text not null,
  board_id     uuid references public.boards (id) on delete set null,
  card_id      text not null,
  card_title   text not null default '',
  prompt       text not null,
  images       jsonb not null default '[]'::jsonb, -- [{ name, url }] short-lived download links
  status       text not null default 'queued' check (status in ('queued', 'working', 'done', 'failed', 'cancelled')),
  session_id   uuid,
  result       text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists claude_tasks_card_idx on public.claude_tasks (user_id, card_id, created_at desc);
create index if not exists claude_tasks_queue_idx on public.claude_tasks (user_id, status);

create table if not exists public.claude_runner_keys (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  key_hash     text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table public.claude_projects enable row level security;
alter table public.claude_tasks enable row level security;
alter table public.claude_runner_keys enable row level security;

drop policy if exists "own claude projects" on public.claude_projects;
create policy "own claude projects" on public.claude_projects for all
  using (user_id = auth.uid() and public.is_platform_admin())
  with check (user_id = auth.uid() and public.is_platform_admin());

drop policy if exists "own claude tasks" on public.claude_tasks;
create policy "own claude tasks" on public.claude_tasks for all
  using (user_id = auth.uid() and public.is_platform_admin())
  with check (user_id = auth.uid() and public.is_platform_admin());

-- The key itself is never readable; only when the Mac helper was last seen.
drop policy if exists "own runner key" on public.claude_runner_keys;
create policy "own runner key" on public.claude_runner_keys for select using (user_id = auth.uid());

grant select, insert, update, delete on public.claude_projects, public.claude_tasks to authenticated;
grant select on public.claude_runner_keys to authenticated;

-- Make a new key for the Mac helper (replaces the old one). Shown once.
create or replace function public.claude_new_runner_key() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  k := 'karlo_' || encode(gen_random_bytes(24), 'hex');
  insert into claude_runner_keys (user_id, key_hash) values (auth.uid(), encode(digest(k, 'sha256'), 'hex'))
  on conflict (user_id) do update set key_hash = excluded.key_hash, created_at = now(), last_seen_at = null;
  return k;
end $$;

create or replace function public.claude_runner_user(p_key text) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select user_id from claude_runner_keys where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex')
$$;
revoke execute on function public.claude_runner_user(text) from public, anon, authenticated;

-- Mac helper: tasks waiting for me (oldest first). Also says "I'm here".
create or replace function public.claude_runner_poll(p_key text) returns setof public.claude_tasks
language plpgsql security definer set search_path = public as $$
declare u uuid := claude_runner_user(p_key);
begin
  if u is null then raise exception 'Unknown key'; end if;
  update claude_runner_keys set last_seen_at = now() where user_id = u;
  return query select * from claude_tasks where user_id = u and status = 'queued' order by created_at limit 5;
end $$;

-- Mac helper: report progress on one of my tasks.
create or replace function public.claude_runner_update(p_key text, p_id uuid, p_status text, p_session uuid default null, p_result text default null)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := claude_runner_user(p_key);
begin
  if u is null then raise exception 'Unknown key'; end if;
  if p_status not in ('working', 'done', 'failed') then raise exception 'Bad status'; end if;
  update claude_tasks set
    status      = p_status,
    session_id  = coalesce(p_session, session_id),
    result      = coalesce(p_result, result),
    started_at  = case when p_status = 'working' then now() else started_at end,
    finished_at = case when p_status in ('done', 'failed') then now() else finished_at end
  where id = p_id and user_id = u and status <> 'cancelled';
end $$;

grant execute on function public.claude_new_runner_key() to authenticated;
grant execute on function public.claude_runner_poll(text), public.claude_runner_update(text, uuid, text, uuid, text) to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'claude_tasks') then
    alter publication supabase_realtime add table public.claude_tasks;
  end if;
end $$;
