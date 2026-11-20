-- Karlo v2: workspaces (teams), shared boards, roles and invites.
-- Run once in Supabase → SQL Editor. Safe to re-run.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  name       text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_email_idx on public.profiles (lower(email));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email, name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------- tables
create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  added_at     timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.boards (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title        text not null,
  color        text not null default '#2563eb',
  data         jsonb not null default '{}'::jsonb,
  version      integer not null default 1,
  created_by   uuid not null default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id)
);
create index if not exists boards_workspace_idx on public.boards (workspace_id);

create table if not exists public.board_members (
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  role     text not null check (role in ('admin', 'member', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table if not exists public.invites (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  board_id     uuid references public.boards (id) on delete cascade,
  role         text not null check (role in ('admin', 'member', 'viewer')),
  invited_by   uuid not null default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now(),
  check ((workspace_id is null) <> (board_id is null))
);
create unique index if not exists invites_target_idx
  on public.invites (lower(email), coalesce(workspace_id, board_id));

-- ---------------------------------------------------------------- helpers
create or replace function public.role_rank(r text) returns int
language sql immutable as $$
  select case r when 'owner' then 4 when 'admin' then 3 when 'member' then 2 when 'viewer' then 1 else 0 end
$$;

create or replace function public.workspace_role(ws uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from workspace_members where workspace_id = ws and user_id = auth.uid()
$$;

-- Effective role on a board: the higher of workspace role and direct board role.
create or replace function public.board_role(b uuid) returns text
language sql stable security definer set search_path = public as $$
  select r from (
    select wm.role as r
      from boards bo join workspace_members wm
        on wm.workspace_id = bo.workspace_id and wm.user_id = auth.uid()
     where bo.id = b
    union all
    select bm.role from board_members bm where bm.board_id = b and bm.user_id = auth.uid()
  ) x order by role_rank(r) desc limit 1
$$;

-- True when the current user and "other" share a workspace or board.
create or replace function public.shares_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select other = auth.uid()
    or exists (select 1 from workspace_members a join workspace_members b using (workspace_id)
                where a.user_id = auth.uid() and b.user_id = other)
    or exists (select 1 from board_members a join board_members b using (board_id)
                where a.user_id = auth.uid() and b.user_id = other)
    or exists (select 1 from board_members bm join boards bo on bo.id = bm.board_id
                 join workspace_members wm on wm.workspace_id = bo.workspace_id
                where (bm.user_id = auth.uid() and wm.user_id = other)
                   or (bm.user_id = other and wm.user_id = auth.uid()))
$$;

-- ---------------------------------------------------------------- RLS
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.boards            enable row level security;
alter table public.board_members     enable row level security;
alter table public.invites           enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (public.shares_with(id));
drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "workspaces read" on public.workspaces;
create policy "workspaces read" on public.workspaces for select using (public.workspace_role(id) is not null);
drop policy if exists "workspaces update" on public.workspaces;
create policy "workspaces update" on public.workspaces for update using (public.role_rank(public.workspace_role(id)) >= 3);
drop policy if exists "workspaces delete" on public.workspaces;
create policy "workspaces delete" on public.workspaces for delete using (public.workspace_role(id) = 'owner');

drop policy if exists "ws members read" on public.workspace_members;
create policy "ws members read" on public.workspace_members for select using (public.workspace_role(workspace_id) is not null);
drop policy if exists "ws members leave" on public.workspace_members;
create policy "ws members leave" on public.workspace_members for delete using (user_id = auth.uid() and role <> 'owner');

-- Uses the row's own workspace_id (not a lookup by id) so a just-inserted board is readable in RETURNING.
create or replace function public.board_guest_role(b uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from board_members where board_id = b and user_id = auth.uid()
$$;
grant execute on function public.board_guest_role(uuid) to authenticated;

drop policy if exists "boards read" on public.boards;
create policy "boards read" on public.boards for select
  using (public.workspace_role(workspace_id) is not null or public.board_guest_role(id) is not null);
drop policy if exists "boards insert" on public.boards;
create policy "boards insert" on public.boards for insert
  with check (created_by = auth.uid() and public.role_rank(public.workspace_role(workspace_id)) >= 2);
drop policy if exists "boards update" on public.boards;
create policy "boards update" on public.boards for update
  using (public.role_rank(public.board_role(id)) >= 2)
  with check (public.role_rank(public.board_role(id)) >= 2);
drop policy if exists "boards delete" on public.boards;
create policy "boards delete" on public.boards for delete using (public.role_rank(public.board_role(id)) >= 3);

drop policy if exists "board members read" on public.board_members;
create policy "board members read" on public.board_members for select using (public.board_role(board_id) is not null);
drop policy if exists "board members leave" on public.board_members;
create policy "board members leave" on public.board_members for delete using (user_id = auth.uid());

drop policy if exists "invites read" on public.invites;
create policy "invites read" on public.invites for select using (
  lower(email) = lower(auth.email())
  or (workspace_id is not null and public.role_rank(public.workspace_role(workspace_id)) >= 3)
  or (board_id is not null and public.role_rank(public.board_role(board_id)) >= 3));
drop policy if exists "invites delete" on public.invites;
create policy "invites delete" on public.invites for delete using (
  (workspace_id is not null and public.role_rank(public.workspace_role(workspace_id)) >= 3)
  or (board_id is not null and public.role_rank(public.board_role(board_id)) >= 3));

-- ---------------------------------------------------------------- RPCs
create or replace function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into workspaces (name, created_by) values (p_name, auth.uid()) returning id into ws;
  insert into workspace_members (workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  return ws;
end $$;

-- Adds the person right away if they already have an account, otherwise stores an invite
-- that is accepted automatically the first time they sign in with that email.
create or replace function public.invite_member(p_email text, p_role text, p_workspace uuid default null, p_board uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare target uuid; cur text;
begin
  if p_role not in ('admin', 'member', 'viewer') then raise exception 'Invalid role'; end if;
  if (p_workspace is null) = (p_board is null) then raise exception 'Pick a workspace or a board'; end if;
  if p_workspace is not null and role_rank(workspace_role(p_workspace)) < 3 then raise exception 'Only admins can invite'; end if;
  if p_board is not null and role_rank(board_role(p_board)) < 3 then raise exception 'Only admins can invite'; end if;

  select id into target from profiles where lower(email) = lower(trim(p_email));
  if target is null then
    insert into invites (email, workspace_id, board_id, role)
    values (lower(trim(p_email)), p_workspace, p_board, p_role)
    on conflict (lower(email), coalesce(workspace_id, board_id)) do update set role = excluded.role;
    return 'invited';
  end if;

  if p_workspace is not null then
    select role into cur from workspace_members where workspace_id = p_workspace and user_id = target;
    if cur = 'owner' then return 'added'; end if;
    insert into workspace_members (workspace_id, user_id, role) values (p_workspace, target, p_role)
    on conflict (workspace_id, user_id) do update set role = excluded.role;
  else
    insert into board_members (board_id, user_id, role) values (p_board, target, p_role)
    on conflict (board_id, user_id) do update set role = excluded.role;
  end if;
  return 'added';
end $$;

-- Change a member's role, or remove them with p_role = 'remove'. The owner cannot be changed.
create or replace function public.update_member(p_user uuid, p_role text, p_workspace uuid default null, p_board uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if p_role not in ('admin', 'member', 'viewer', 'remove') then raise exception 'Invalid role'; end if;
  if p_workspace is not null then
    if role_rank(workspace_role(p_workspace)) < 3 then raise exception 'Only admins can manage members'; end if;
    select role into cur from workspace_members where workspace_id = p_workspace and user_id = p_user;
    if cur = 'owner' then raise exception 'The owner cannot be changed'; end if;
    if p_role = 'remove' then
      delete from workspace_members where workspace_id = p_workspace and user_id = p_user;
    else
      update workspace_members set role = p_role where workspace_id = p_workspace and user_id = p_user;
    end if;
  elsif p_board is not null then
    if role_rank(board_role(p_board)) < 3 then raise exception 'Only admins can manage members'; end if;
    if p_role = 'remove' then
      delete from board_members where board_id = p_board and user_id = p_user;
    else
      update board_members set role = p_role where board_id = p_board and user_id = p_user;
    end if;
  end if;
end $$;

create or replace function public.accept_invites() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; inv record;
begin
  for inv in select * from invites where lower(email) = lower(auth.email()) loop
    if inv.workspace_id is not null then
      insert into workspace_members (workspace_id, user_id, role) values (inv.workspace_id, auth.uid(), inv.role)
      on conflict do nothing;
    else
      insert into board_members (board_id, user_id, role) values (inv.board_id, auth.uid(), inv.role)
      on conflict do nothing;
    end if;
    delete from invites where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Everyone who can see a board (workspace members + board guests), with names.
create or replace function public.board_people(p_board uuid)
returns table (user_id uuid, name text, email text, role text, via text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email, x.role, x.via from (
    select wm.user_id, wm.role, 'workspace' as via
      from boards bo join workspace_members wm on wm.workspace_id = bo.workspace_id where bo.id = p_board
    union all
    select bm.user_id, bm.role, 'board' from board_members bm where bm.board_id = p_board
  ) x join profiles p on p.id = x.user_id
  where public.board_role(p_board) is not null
$$;

create or replace function public.workspace_people(p_workspace uuid)
returns table (user_id uuid, name text, email text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email, wm.role
    from workspace_members wm join profiles p on p.id = wm.user_id
   where wm.workspace_id = p_workspace and public.workspace_role(p_workspace) is not null
$$;

-- ---------------------------------------------------------------- grants
grant select, update on public.profiles to authenticated;
grant select, update, delete on public.workspaces to authenticated;
grant select, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.boards to authenticated;
grant select, delete on public.board_members to authenticated;
grant select, delete on public.invites to authenticated;
revoke all on public.profiles, public.workspaces, public.workspace_members,
              public.boards, public.board_members, public.invites from anon;
grant execute on function public.create_workspace(text), public.invite_member(text, text, uuid, uuid),
  public.update_member(uuid, text, uuid, uuid), public.accept_invites(), public.board_people(uuid),
  public.workspace_people(uuid) to authenticated;

-- ---------------------------------------------------------------- realtime
do $$
declare t text;
begin
  foreach t in array array['boards', 'workspace_members', 'board_members', 'workspaces'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
