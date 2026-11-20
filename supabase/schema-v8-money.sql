-- Karlo v8: money management — income, recurring costs/income, monthly category budgets.
-- Builds on v7 (expenses). Same access rule: only listed partners. Safe to re-run.

-- Income entries live next to expenses (kind = 'income').
alter table public.expenses drop constraint if exists expenses_kind_check;
alter table public.expenses add constraint expenses_kind_check check (kind in ('expense', 'income', 'settlement'));
alter table public.expenses add column if not exists recurring_id uuid;

-- Monthly budget per category: { "Marketing": 5000, ... }
alter table public.expense_settings add column if not exists category_budgets jsonb not null default '{}'::jsonb;

-- Repeating costs (or income) that add themselves.
create table if not exists public.expense_recurring (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards (id) on delete cascade,
  kind       text not null default 'expense' check (kind in ('expense', 'income')),
  title      text not null,
  amount     numeric(14, 2) not null check (amount > 0),
  category   text not null default 'Other',
  paid_by    uuid references public.profiles (id) on delete set null,
  shared     boolean not null default false,
  card_id    text,
  note       text not null default '',
  frequency  text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  start_on   date not null,                -- first occurrence; later ones are counted from it (no month-end drift)
  done_count int not null default 0,       -- occurrences already added
  next_on    date not null,
  end_on     date,
  active     boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists expense_recurring_board_idx on public.expense_recurring (board_id);
-- One entry per rule per date, so catching up twice never duplicates.
create unique index if not exists expenses_recurring_once on public.expenses (recurring_id, spent_on) where recurring_id is not null;

alter table public.expense_recurring enable row level security;
drop policy if exists "recurring partners" on public.expense_recurring;
create policy "recurring partners" on public.expense_recurring for all to authenticated
  using (public.is_expense_partner(board_id))
  with check (public.is_expense_partner(board_id));
grant select, insert, update, delete on public.expense_recurring to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'expense_recurring') then
    alter publication supabase_realtime add table public.expense_recurring;
  end if;
end $$;

-- Adds every due occurrence (up to today) and moves each rule's next date forward.
-- Runs for one board (called by the app when a partner opens it) or for all boards (b = null, daily job).
create or replace function public.recurring_date(start_on date, frequency text, k int) returns date
language sql immutable as $$
  select case frequency
           when 'weekly' then start_on + 7 * k
           when 'monthly' then (start_on + k * interval '1 month')::date
           else (start_on + k * interval '1 year')::date
         end
$$;

create or replace function public.run_recurring_expenses(b uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  k int;
  d date;
  added int := 0;
  n int;
begin
  -- Signed-in users may only run their own board; the all-boards run is for the daily job.
  if b is null and auth.uid() is not null then
    return 0;
  end if;
  if b is not null and not public.is_expense_partner(b) then
    return 0;
  end if;
  for r in
    select * from expense_recurring
     where active and next_on <= current_date and (b is null or board_id = b)
     for update
  loop
    k := r.done_count;
    d := public.recurring_date(r.start_on, r.frequency, k);
    while d <= current_date and (r.end_on is null or d <= r.end_on) loop
      insert into expenses (board_id, kind, title, amount, category, spent_on, paid_by, shared, card_id, note, recurring_id, created_by)
      values (r.board_id, r.kind, r.title, r.amount, r.category, d, r.paid_by, r.shared, r.card_id, r.note, r.id, r.created_by)
      on conflict do nothing;
      get diagnostics n = row_count;
      added := added + n;
      k := k + 1;
      d := public.recurring_date(r.start_on, r.frequency, k);
    end loop;
    update expense_recurring
       set done_count = k, next_on = d, active = (r.end_on is null or d <= r.end_on)
     where id = r.id;
  end loop;
  return added;
end $$;
grant execute on function public.run_recurring_expenses(uuid) to authenticated;

-- Daily run at 03:00 UTC when pg_cron is available (skipped quietly otherwise).
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'karlo-recurring-expenses';
  perform cron.schedule('karlo-recurring-expenses', '0 3 * * *', 'select public.run_recurring_expenses(null)');
exception when others then
  raise notice 'pg_cron not available: recurring entries are added when a partner opens the board';
end $$;

select 'ok' as result;
