-- Karlo v14: renting Karlo to clients. Every client is a workspace with a plan.
--   plan:   trial | starter | pro | business
--   status: active | suspended   (suspended = nobody in it can open anything)
--   A trial ends at trial_ends_at; a paid plan runs until paid_until (null = no end date).
--   After that (+3 days' grace for paid plans) the workspace is read-only: nothing is deleted.
-- Platform admins (the people renting Karlo out) manage clients from the admin panel. They see
-- each client's numbers (people, boards, storage, last activity) but never the boards themselves.

-- ---------------------------------------------------------------- columns
alter table public.workspaces add column if not exists plan text not null default 'trial';
alter table public.workspaces add column if not exists status text not null default 'active';
alter table public.workspaces add column if not exists trial_ends_at timestamptz default (now() + interval '14 days');
alter table public.workspaces add column if not exists paid_until timestamptz;
alter table public.workspaces add column if not exists seats integer;
alter table public.workspaces add column if not exists admin_notes text not null default '';
alter table public.workspaces add column if not exists brand_name text;
alter table public.workspaces add column if not exists brand_logo text;
alter table public.workspaces add column if not exists brand_color text;

alter table public.workspaces drop constraint if exists workspaces_plan_check;
alter table public.workspaces add constraint workspaces_plan_check check (plan in ('trial', 'starter', 'pro', 'business'));
alter table public.workspaces drop constraint if exists workspaces_status_check;
alter table public.workspaces add constraint workspaces_status_check check (status in ('active', 'suspended'));

-- Workspaces that existed before plans: keep them fully working, with no end date.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'workspaces' and column_name = 'plan_set') then
    update public.workspaces set plan = 'business', trial_ends_at = null, paid_until = null;
    alter table public.workspaces add column plan_set boolean not null default true;
  end if;
end $$;

-- An invite can make someone the owner (used when a new client is created for an email with no account yet).
alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites add constraint invites_role_check check (role in ('owner', 'admin', 'member', 'viewer'));

-- Members can't change plan, dates, status or notes themselves; only the platform admin functions below can.
create or replace function public.protect_workspace_billing() returns trigger
language plpgsql as $$
begin
  if current_setting('karlo.admin', true) = 'on' then return new; end if;
  new.plan := old.plan; new.status := old.status; new.trial_ends_at := old.trial_ends_at;
  new.paid_until := old.paid_until; new.seats := old.seats; new.admin_notes := old.admin_notes;
  return new;
end $$;
drop trigger if exists workspaces_protect_billing on public.workspaces;
create trigger workspaces_protect_billing before update on public.workspaces
  for each row execute function public.protect_workspace_billing();

-- ---------------------------------------------------------------- platform admins
create table if not exists public.platform_admins (
  user_id  uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
drop policy if exists "platform admins read self" on public.platform_admins;
create policy "platform admins read self" on public.platform_admins for select using (user_id = auth.uid());

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------- access rules
-- Can people work in this workspace right now (not suspended, trial or payment current)?
create or replace function public.workspace_writable(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select w.status = 'active' and case
      when w.plan = 'trial' then w.trial_ends_at is null or w.trial_ends_at > now()
      else w.paid_until is null or w.paid_until + interval '3 days' > now()
    end
    from workspaces w where w.id = ws), false)
$$;
create or replace function public.workspace_open(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status <> 'suspended' from workspaces where id = ws), false)
$$;
create or replace function public.board_writable(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.workspace_writable(workspace_id) from boards where id = b), false)
$$;
grant execute on function public.is_platform_admin(), public.workspace_writable(uuid), public.workspace_open(uuid), public.board_writable(uuid) to authenticated;

drop policy if exists "boards read" on public.boards;
create policy "boards read" on public.boards for select
  using ((public.workspace_role(workspace_id) is not null or public.board_guest_role(id) is not null) and public.workspace_open(workspace_id));
drop policy if exists "boards insert" on public.boards;
create policy "boards insert" on public.boards for insert
  with check (created_by = auth.uid() and public.role_rank(public.workspace_role(workspace_id)) >= 2 and public.workspace_writable(workspace_id));
drop policy if exists "boards update" on public.boards;
create policy "boards update" on public.boards for update
  using (public.role_rank(public.board_role(id)) >= 2 and public.workspace_writable(workspace_id))
  with check (public.role_rank(public.board_role(id)) >= 2 and public.workspace_writable(workspace_id));
drop policy if exists "boards delete" on public.boards;
create policy "boards delete" on public.boards for delete
  using (public.role_rank(public.board_role(id)) >= 3 and public.workspace_writable(workspace_id));

drop policy if exists "attachments upload" on storage.objects;
create policy "attachments upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.role_rank(public.board_role(public.attachment_board(name))) >= 2
              and public.board_writable(public.attachment_board(name)));

-- New workspaces start on a 14-day trial.
create or replace function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into workspaces (name, created_by, plan, trial_ends_at) values (p_name, auth.uid(), 'trial', now() + interval '14 days') returning id into ws;
  insert into workspace_members (workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  return ws;
end $$;

-- ---------------------------------------------------------------- admin panel
create or replace function public.admin_clients()
returns table (
  id uuid, name text, plan text, status text, trial_ends_at timestamptz, paid_until timestamptz, seats integer,
  admin_notes text, created_at timestamptz, owner_name text, owner_email text, pending_owner text,
  people integer, boards integer, storage_bytes bigint, last_active timestamptz
)
language plpgsql stable security definer set search_path = public, storage as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  return query
  select w.id, w.name, w.plan, w.status, w.trial_ends_at, w.paid_until, w.seats, w.admin_notes, w.created_at,
         op.name, op.email,
         (select i.email from invites i where i.workspace_id = w.id and i.role = 'owner' limit 1),
         (select count(*)::int from workspace_members m where m.workspace_id = w.id),
         (select count(*)::int from boards b where b.workspace_id = w.id),
         (select coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint from storage.objects o
            where o.bucket_id = 'attachments' and public.attachment_board(o.name) in (select b.id from boards b where b.workspace_id = w.id)),
         (select max(b.updated_at) from boards b where b.workspace_id = w.id)
  from workspaces w
  left join lateral (select p.name, p.email from workspace_members m join profiles p on p.id = m.user_id
                     where m.workspace_id = w.id and m.role = 'owner' limit 1) op on true
  order by w.created_at desc;
end $$;

-- Create a client workspace for an owner email. If they have no account yet, they become the owner
-- the first time they sign up with that email.
create or replace function public.admin_create_client(p_name text, p_owner_email text, p_plan text, p_trial_days integer default 14, p_paid_until timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid; target uuid; em text := lower(trim(p_owner_email));
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the client a name'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn''t look right'; end if;
  perform set_config('karlo.admin', 'on', true);
  insert into workspaces (name, created_by, plan, trial_ends_at, paid_until)
  values (trim(p_name), auth.uid(), p_plan,
          case when p_plan = 'trial' then now() + make_interval(days => greatest(1, p_trial_days)) end,
          case when p_plan <> 'trial' then p_paid_until end)
  returning id into ws;
  select id into target from profiles where lower(email) = em;
  if target is null then
    insert into invites (email, workspace_id, role) values (em, ws, 'owner');
  else
    insert into workspace_members (workspace_id, user_id, role) values (ws, target, 'owner');
  end if;
  return ws;
end $$;

create or replace function public.admin_update_client(p_id uuid, p_name text, p_plan text, p_status text,
  p_trial_ends_at timestamptz, p_paid_until timestamptz, p_seats integer, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  perform set_config('karlo.admin', 'on', true);
  update workspaces set name = coalesce(nullif(trim(p_name), ''), name), plan = p_plan, status = p_status,
    trial_ends_at = p_trial_ends_at, paid_until = p_paid_until, seats = p_seats, admin_notes = coalesce(p_notes, '')
  where id = p_id;
end $$;

grant execute on function public.admin_clients(), public.admin_create_client(text, text, text, integer, timestamptz),
  public.admin_update_client(uuid, text, text, text, timestamptz, timestamptz, integer, text) to authenticated;
