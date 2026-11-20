-- Karlo v11: due-date reminders and a daily digest, sent as notifications (bell + web push).
-- An hourly job checks every person in their own time zone. Safe to re-run.

-- System notifications come "from Karlo" (no actor), and the digest isn't about one board.
alter table public.notifications alter column actor_id drop not null;
alter table public.notifications alter column board_id drop not null;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'assigned', 'comment', 'attachment', 'moved', 'due', 'completed', 'reminder', 'digest'));

create table if not exists public.reminder_settings (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  due_reminders boolean not null default true,
  remind_before int not null default 1 check (remind_before between 0 and 7), -- days before the due date (0 = only on the day)
  overdue       boolean not null default true,
  digest        boolean not null default true,
  digest_hour   int not null default 8 check (digest_hour between 0 and 23),  -- local hour for the digest and reminders
  timezone      text not null default 'Asia/Dubai',
  updated_at    timestamptz not null default now()
);
alter table public.reminder_settings enable row level security;
drop policy if exists "reminder settings own" on public.reminder_settings;
create policy "reminder settings own" on public.reminder_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.reminder_settings to authenticated;

-- What was already sent, so nothing repeats (one row per person + card + reminder type + due date).
create table if not exists public.reminder_log (
  user_id uuid not null references public.profiles (id) on delete cascade,
  card_id text not null,        -- 'digest' for the daily digest
  kind    text not null,        -- before | today | overdue | digest
  due     date not null,        -- the card's due date (digest: the local day)
  sent_at timestamptz not null default now(),
  primary key (user_id, card_id, kind, due)
);
alter table public.reminder_log enable row level security; -- no policies: only the job writes it

-- The job. Cards count when the person owns or is a member of them, can still open the board,
-- and the card is open (not archived, not complete, list not archived).
create or replace function public.run_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  p record;
  c record;
  tz text;
  local_now timestamp;
  today date;
  days int;
  rkind text;
  body text;
  sent int := 0;
  n int;
  due_today int; overdue_n int; week_n int; unread_n int;
begin
  -- Signed-in users can't trigger everyone's reminders; only the scheduled job (no user) runs this.
  if auth.uid() is not null then
    return 0;
  end if;

  for p in
    select pr.id,
           coalesce(s.due_reminders, true) as due_reminders,
           coalesce(s.remind_before, 1) as remind_before,
           coalesce(s.overdue, true) as overdue,
           coalesce(s.digest, true) as digest,
           coalesce(s.digest_hour, 8) as digest_hour,
           coalesce(nullif(s.timezone, ''), 'Asia/Dubai') as timezone
      from profiles pr left join reminder_settings s on s.user_id = pr.id
  loop
    begin
      local_now := now() at time zone p.timezone;
    exception when others then
      local_now := now() at time zone 'Asia/Dubai';
    end;
    today := local_now::date;
    -- Nothing before the person's chosen morning hour.
    continue when extract(hour from local_now) < p.digest_hour;

    due_today := 0; overdue_n := 0; week_n := 0;
    for c in
      select b.id as board_id, card.key as card_id, card.value->>'title' as title, l.value->>'title' as list_title,
             (card.value->>'due')::date as due
        from boards b
        cross join lateral jsonb_each(coalesce(b.data->'lists', '{}'::jsonb)) l
        cross join lateral jsonb_array_elements_text(coalesce(l.value->'cardIds', '[]'::jsonb)) cid(id)
        cross join lateral (select cid.id as key, b.data->'cards'->cid.id as value) card
       where public.user_board_role(p.id, b.id) is not null
         and coalesce((l.value->>'archived')::boolean, false) = false
         and card.value is not null
         and coalesce((card.value->>'archived')::boolean, false) = false
         and coalesce((card.value->>'completed')::boolean, false) = false
         and coalesce((card.value->>'dueDone')::boolean, false) = false
         and (card.value->>'due') ~ '^\d{4}-\d{2}-\d{2}$'
         and (coalesce(card.value->'assignees', '[]'::jsonb) ? p.id::text or coalesce(card.value->'owners', '[]'::jsonb) ? p.id::text)
    loop
      days := c.due - today;
      if days = 0 then due_today := due_today + 1; end if;
      if days < 0 then overdue_n := overdue_n + 1; end if;
      if days between 1 and 7 then week_n := week_n + 1; end if;

      rkind := null;
      if p.due_reminders and days = 0 then
        rkind := 'today'; body := 'Due today';
      elsif p.due_reminders and p.remind_before > 0 and days = p.remind_before then
        rkind := 'before'; body := case when days = 1 then 'Due tomorrow' else 'Due in ' || days || ' days' end;
      elsif p.overdue and days < 0 then
        rkind := 'overdue'; body := 'Overdue — was due ' || to_char(c.due, 'Mon FMDD');
      end if;
      continue when rkind is null;

      insert into reminder_log (user_id, card_id, kind, due) values (p.id, c.card_id, rkind, c.due)
      on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        insert into notifications (user_id, actor_id, board_id, card_id, kind, card_title, list_title, body)
        values (p.id, null, c.board_id, c.card_id, 'reminder', coalesce(c.title, 'Card'), coalesce(c.list_title, ''), body);
        sent := sent + 1;
      end if;
    end loop;

    -- Daily digest (once per local day, only when there's something to say).
    if p.digest then
      select count(*) into unread_n from notifications where user_id = p.id and read_at is null and kind not in ('digest', 'reminder');
      if due_today + overdue_n + week_n + unread_n > 0 then
        insert into reminder_log (user_id, card_id, kind, due) values (p.id, 'digest', 'digest', today)
        on conflict do nothing;
        get diagnostics n = row_count;
        if n > 0 then
          body := concat_ws(' · ',
            case when due_today > 0 then due_today || ' due today' end,
            case when overdue_n > 0 then overdue_n || ' overdue' end,
            case when week_n > 0 then week_n || ' due this week' end,
            case when unread_n > 0 then unread_n || ' unread notification' || case when unread_n > 1 then 's' else '' end end);
          insert into notifications (user_id, actor_id, board_id, card_id, kind, card_title, list_title, body)
          values (p.id, null, null, null, 'digest', 'Your daily digest', to_char(today, 'Dy FMDD Mon'), body);
          sent := sent + 1;
        end if;
      end if;
    end if;
  end loop;
  return sent;
end $$;
revoke all on function public.run_reminders() from public, anon, authenticated;

-- Every hour at :05.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'karlo-reminders';
  perform cron.schedule('karlo-reminders', '5 * * * *', 'select public.run_reminders()');
exception when others then
  raise notice 'pg_cron not available';
end $$;

select 'ok' as result;
