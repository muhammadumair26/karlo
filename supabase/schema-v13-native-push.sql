-- Karlo v13: phone-app notifications (Android, Firebase Cloud Messaging) that arrive when the app is closed.
create table if not exists public.native_push_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  platform   text not null default 'android',
  updated_at timestamptz not null default now()
);
create index if not exists native_push_tokens_user_idx on public.native_push_tokens (user_id);
alter table public.native_push_tokens enable row level security;
drop policy if exists "native tokens own read" on public.native_push_tokens;
create policy "native tokens own read" on public.native_push_tokens for select using (user_id = auth.uid());
drop policy if exists "native tokens own delete" on public.native_push_tokens;
create policy "native tokens own delete" on public.native_push_tokens for delete using (user_id = auth.uid());
revoke all on public.native_push_tokens from anon;
grant select, delete on public.native_push_tokens to authenticated;
grant select, insert, update, delete on public.native_push_tokens to service_role;

-- Saves this phone for the signed-in person (a phone that changes hands moves to the new person).
create or replace function public.register_push_token(p_token text, p_platform text default 'android') returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(length(p_token), 0) < 20 then return; end if;
  insert into native_push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), left(coalesce(p_platform, 'android'), 20), now())
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;
revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
