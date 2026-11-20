-- Karlo v3: profile photos and job titles. Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists title text not null default '';

-- People lists now include photo + title (return type changed, so drop first).
drop function if exists public.board_people(uuid);
create function public.board_people(p_board uuid)
returns table (user_id uuid, name text, email text, role text, via text, avatar_url text, title text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email, x.role, x.via, p.avatar_url, p.title from (
    select wm.user_id, wm.role, 'workspace' as via
      from boards bo join workspace_members wm on wm.workspace_id = bo.workspace_id where bo.id = p_board
    union all
    select bm.user_id, bm.role, 'board' from board_members bm where bm.board_id = p_board
  ) x join profiles p on p.id = x.user_id
  where public.board_role(p_board) is not null
$$;

drop function if exists public.workspace_people(uuid);
create function public.workspace_people(p_workspace uuid)
returns table (user_id uuid, name text, email text, role text, avatar_url text, title text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email, wm.role, p.avatar_url, p.title
    from workspace_members wm join profiles p on p.id = wm.user_id
   where wm.workspace_id = p_workspace and public.workspace_role(p_workspace) is not null
$$;

grant execute on function public.board_people(uuid), public.workspace_people(uuid) to authenticated;

-- Public bucket for profile photos; each user may only write inside their own folder (<user id>/...).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars insert own" on storage.objects;
create policy "avatars insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars read own" on storage.objects;
create policy "avatars read own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
