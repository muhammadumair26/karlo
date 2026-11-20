-- Karlo v7: project expenses (per board), partner split and settle-up, receipts.
-- Only the partners listed in expense_settings can see or change money (not other admins);
-- only the board owner can set expenses up for a board. Run once in Supabase SQL Editor. Safe to re-run.

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.boards (id) on delete cascade,
  kind         text not null default 'expense' check (kind in ('expense', 'settlement')),
  title        text not null default '',
  amount       numeric(14, 2) not null check (amount > 0),
  category     text not null default 'Other',
  spent_on     date not null default current_date,
  paid_by      uuid references public.profiles (id) on delete set null, -- null = company account
  paid_to      uuid references public.profiles (id) on delete set null, -- settlements: who received it
  shared       boolean not null default true,                            -- split between partners
  card_id      text,
  note         text not null default '',
  receipt_path text,
  receipt_name text,
  created_by   uuid not null default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists expenses_board_idx on public.expenses (board_id, spent_on desc);

create table if not exists public.expense_settings (
  board_id   uuid primary key references public.boards (id) on delete cascade,
  currency   text not null default 'AED',
  budget     numeric(14, 2),
  partners   jsonb not null default '[]'::jsonb, -- [{ "id": uuid, "share": percent }]
  updated_at timestamptz not null default now()
);

alter table public.expenses enable row level security;
alter table public.expense_settings enable row level security;

-- True when the current user is a listed partner of this board's expenses.
create or replace function public.is_expense_partner(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from expense_settings s
     where s.board_id = b
       and s.partners @> jsonb_build_array(jsonb_build_object('id', auth.uid()::text))
  ) and public.board_role(b) is not null
$$;
grant execute on function public.is_expense_partner(uuid) to authenticated;

drop policy if exists "expenses admins" on public.expenses;
drop policy if exists "expenses partners" on public.expenses;
create policy "expenses partners" on public.expenses for all to authenticated
  using (public.is_expense_partner(board_id))
  with check (public.is_expense_partner(board_id));

drop policy if exists "expense settings admins" on public.expense_settings;
drop policy if exists "expense settings read" on public.expense_settings;
create policy "expense settings read" on public.expense_settings for select to authenticated
  using (public.is_expense_partner(board_id));
drop policy if exists "expense settings create" on public.expense_settings;
create policy "expense settings create" on public.expense_settings for insert to authenticated
  with check (public.board_role(board_id) = 'owner'
              and partners @> jsonb_build_array(jsonb_build_object('id', auth.uid()::text)));
drop policy if exists "expense settings update" on public.expense_settings;
create policy "expense settings update" on public.expense_settings for update to authenticated
  using (public.is_expense_partner(board_id))
  with check (public.is_expense_partner(board_id));

grant select, insert, update, delete on public.expenses, public.expense_settings to authenticated;

do $$
declare t text;
begin
  foreach t in array array['expenses', 'expense_settings'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Receipts: private bucket, receipts/<board id>/<random>-<file name>, partners only.
insert into storage.buckets (id, name, public, file_size_limit)
values ('receipts', 'receipts', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "receipts read" on storage.objects;
create policy "receipts read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_expense_partner(public.attachment_board(name)));
drop policy if exists "receipts upload" on storage.objects;
create policy "receipts upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_expense_partner(public.attachment_board(name)));
drop policy if exists "receipts delete" on storage.objects;
create policy "receipts delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_expense_partner(public.attachment_board(name)));

select 'ok' as result;
