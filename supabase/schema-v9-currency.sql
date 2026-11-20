-- Karlo v9: multi-currency money. Each entry keeps its own currency and the exchange rate to the
-- board's main currency at the time it was entered (so old totals never move). Safe to re-run.

alter table public.expenses add column if not exists currency text;          -- null = board currency
alter table public.expenses add column if not exists fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0);

alter table public.expense_recurring add column if not exists currency text;
alter table public.expense_recurring add column if not exists fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0);

-- Repeating entries copy the rule's currency and rate.
create or replace function public.run_recurring_expenses(b uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  k int;
  d date;
  added int := 0;
  n int;
begin
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
      insert into expenses (board_id, kind, title, amount, currency, fx_rate, category, spent_on, paid_by, shared, card_id, note, recurring_id, created_by)
      values (r.board_id, r.kind, r.title, r.amount, r.currency, r.fx_rate, r.category, d, r.paid_by, r.shared, r.card_id, r.note, r.id, r.created_by)
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

select 'ok' as result;
