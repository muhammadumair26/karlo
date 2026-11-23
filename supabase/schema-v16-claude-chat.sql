-- Karlo v16: talk to Claude inside Karlo (no Terminal needed).
-- • Reply to a Claude task: the reply is a new task in the same thread that continues the same Claude
--   Code session on the Mac (thread_id = the first task, resume_session = the session to continue).
-- • Live progress: while Claude works, the Mac helper writes what it is doing (reading, editing, running…).
-- • Stop: a working task can be cancelled; the helper sees that on its next progress report and stops.

alter table public.claude_tasks add column if not exists thread_id uuid;
alter table public.claude_tasks add column if not exists resume_session uuid;
alter table public.claude_tasks add column if not exists progress text;
create index if not exists claude_tasks_thread_idx on public.claude_tasks (thread_id);

-- Mac helper: "here's what Claude is doing". Returns the task's status, so the helper stops when it's cancelled.
create or replace function public.claude_runner_progress(p_key text, p_id uuid, p_progress text)
returns text language plpgsql security definer set search_path = public as $$
declare u uuid := claude_runner_user(p_key); st text;
begin
  if u is null then raise exception 'Unknown key'; end if;
  update claude_tasks set progress = left(coalesce(p_progress, ''), 8000)
  where id = p_id and user_id = u and status = 'working'
  returning status into st;
  if st is null then select status into st from claude_tasks where id = p_id and user_id = u; end if;
  return coalesce(st, 'gone');
end $$;
grant execute on function public.claude_runner_progress(text, uuid, text) to anon, authenticated;
