-- Permission self-test. Creates throwaway users, checks every role, then ROLLS BACK
-- (the final RAISE aborts the transaction), so nothing is left in the database.
do $$
declare
  a uuid := gen_random_uuid();  -- workspace owner
  b uuid := gen_random_uuid();  -- workspace member
  c uuid := gen_random_uuid();  -- board-only viewer
  d uuid := gen_random_uuid();  -- outsider
  e uuid := gen_random_uuid();  -- signs up after being invited
  ws uuid; bd uuid; r text; n int; out text := '';
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data) values
    (a, 'karlo-test-a@example.com', 'authenticated', 'authenticated', '{}'),
    (b, 'karlo-test-b@example.com', 'authenticated', 'authenticated', '{}'),
    (c, 'karlo-test-c@example.com', 'authenticated', 'authenticated', '{}'),
    (d, 'karlo-test-d@example.com', 'authenticated', 'authenticated', '{}');

  -- ---------- as A (owner)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'email', 'karlo-test-a@example.com', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  ws := public.create_workspace('Test WS');
  insert into public.boards (workspace_id, title, color, data) values (ws, 'B1', '#000', '{}') returning id into bd;
  out := out || 'A_created_board=ok';
  r := public.invite_member('karlo-test-b@example.com', 'member', ws, null);  out := out || ' | invite B(ws member)=' || r;
  r := public.invite_member('karlo-test-c@example.com', 'viewer', null, bd);  out := out || ' | invite C(board viewer)=' || r;
  r := public.invite_member('karlo-test-e@example.com', 'admin', ws, null);   out := out || ' | invite E(no account)=' || r;

  -- ---------- as B (workspace member)
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'email', 'karlo-test-b@example.com', 'role', 'authenticated')::text, true);
  select count(*) into n from public.boards;                 out := out || ' | B sees boards=' || n;
  update public.boards set data = '{"x":1}', version = 2 where id = bd and version = 1;
  get diagnostics n = row_count;                             out := out || ' | B edit=' || n;
  update public.boards set version = 3 where id = bd and version = 1;
  get diagnostics n = row_count;                             out := out || ' | B stale edit (should be 0)=' || n;
  begin
    r := public.invite_member('x@example.com', 'member', ws, null); out := out || ' | B invite=ALLOWED(bad)';
  exception when others then out := out || ' | B invite=denied';
  end;
  delete from public.boards where id = bd;
  get diagnostics n = row_count;                             out := out || ' | B delete board (should be 0)=' || n;

  -- ---------- as C (board-only viewer)
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'email', 'karlo-test-c@example.com', 'role', 'authenticated')::text, true);
  select count(*) into n from public.boards;                 out := out || ' | C sees boards=' || n;
  update public.boards set title = 'hacked' where id = bd;
  get diagnostics n = row_count;                             out := out || ' | C edit (should be 0)=' || n;
  select count(*) into n from public.workspaces;             out := out || ' | C sees workspaces (should be 0)=' || n;
  select count(*) into n from public.board_people(bd);       out := out || ' | C sees board people=' || n;

  -- ---------- as D (outsider)
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'email', 'karlo-test-d@example.com', 'role', 'authenticated')::text, true);
  select count(*) into n from public.boards;                 out := out || ' | D sees boards (should be 0)=' || n;
  select count(*) into n from public.profiles;               out := out || ' | D sees profiles (should be 1)=' || n;
  select count(*) into n from public.board_people(bd);       out := out || ' | D board people (should be 0)=' || n;

  -- ---------- E signs up later and gets access automatically
  perform set_config('role', 'none', true);
  insert into auth.users (id, email, aud, role, raw_user_meta_data) values (e, 'karlo-test-e@example.com', 'authenticated', 'authenticated', '{}');
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'email', 'karlo-test-e@example.com', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  n := public.accept_invites();                               out := out || ' | E accepted invites=' || n;
  select count(*) into n from public.boards;                 out := out || ' | E sees boards=' || n;
  select public.workspace_role(ws) into r;                   out := out || ' | E role=' || coalesce(r, 'none');

  -- ---------- A changes roles
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'email', 'karlo-test-a@example.com', 'role', 'authenticated')::text, true);
  perform public.update_member(b, 'viewer', ws, null);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'email', 'karlo-test-b@example.com', 'role', 'authenticated')::text, true);
  update public.boards set title = 'x' where id = bd;
  get diagnostics n = row_count;                             out := out || ' | B after demote edit (should be 0)=' || n;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', e, 'email', 'karlo-test-e@example.com', 'role', 'authenticated')::text, true);
    perform public.update_member(a, 'viewer', ws, null);     out := out || ' | admin demotes owner=ALLOWED(bad)';
  exception when others then out := out || ' | admin demotes owner=denied';
  end;

  raise exception 'KARLO TEST RESULTS (rolled back): %', out;
end $$;
