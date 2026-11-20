-- Karlo v4: in-app notifications (mentions, assignments). Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,             -- who receives it
  actor_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade, -- who caused it
  board_id   uuid not null references public.boards (id) on delete cascade,
  card_id    text,
  kind       text not null,
  card_title text not null default '',
  list_title text not null default '',
  body       text not null default '',
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
-- (re-runnable) make sure newer columns / kinds exist
alter table public.notifications add column if not exists list_title text not null default '';
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'assigned', 'comment', 'attachment', 'moved', 'due', 'completed'));

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- Effective role of any user on a board (used to check the recipient can see the board).
create or replace function public.user_board_role(u uuid, b uuid) returns text
language sql stable security definer set search_path = public as $$
  select r from (
    select wm.role as r
      from boards bo join workspace_members wm on wm.workspace_id = bo.workspace_id and wm.user_id = u
     where bo.id = b
    union all
    select bm.role from board_members bm where bm.board_id = b and bm.user_id = u
  ) x order by role_rank(r) desc limit 1
$$;

alter table public.notifications enable row level security;

drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications for select using (user_id = auth.uid());

drop policy if exists "notifications mark read" on public.notifications;
create policy "notifications mark read" on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications for delete using (user_id = auth.uid());

-- You can only notify someone else, as yourself, about a board you can edit and they can see.
drop policy if exists "notifications send" on public.notifications;
create policy "notifications send" on public.notifications for insert with check (
  actor_id = auth.uid()
  and user_id <> auth.uid()
  and public.role_rank(public.board_role(board_id)) >= 2
  and public.user_board_role(user_id, board_id) is not null
);

grant select, insert, update, delete on public.notifications to authenticated;
revoke all on public.notifications from anon;
grant execute on function public.user_board_role(uuid, uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
