-- Karlo v12: notifications sent by board automations.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'assigned', 'comment', 'attachment', 'moved', 'due', 'completed', 'reminder', 'digest', 'automation'));
