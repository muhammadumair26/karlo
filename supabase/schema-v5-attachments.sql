-- Karlo v5: file attachments. Run once in Supabase → SQL Editor. Safe to re-run.
-- Files live at attachments/<board id>/<card id>/<random>-<file name>.
-- Private bucket: only people who can see the board can read; members+ can upload/delete.

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400) -- 25 MB per file
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Board id from the first folder of the path, or null if it isn't a valid uuid.
create or replace function public.attachment_board(path text) returns uuid
language plpgsql immutable as $$
begin
  return ((storage.foldername(path))[1])::uuid;
exception when others then
  return null;
end $$;

drop policy if exists "attachments read" on storage.objects;
create policy "attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.board_role(public.attachment_board(name)) is not null);

drop policy if exists "attachments upload" on storage.objects;
create policy "attachments upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.role_rank(public.board_role(public.attachment_board(name))) >= 2);

drop policy if exists "attachments delete" on storage.objects;
create policy "attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.role_rank(public.board_role(public.attachment_board(name))) >= 2);

grant execute on function public.attachment_board(text) to authenticated;
