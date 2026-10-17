-- Security & integrity tests for M1. Runs against the migrated + seeded database; rolls back at the end.
-- Each DO block raises 'FAIL: ...' on a broken expectation (psql runs with ON_ERROR_STOP).

begin;

-- Fixtures (as superuser) ----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.edu.au', '{"full_name": "Alice Student"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.edu.au', '{}'),
  ('00000000-0000-4000-8000-00000000000c', 'admin@example.edu.au', '{}');

update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-00000000000c';

insert into public.consultations (id, user_id, case_version_id)
select '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', current_version_id
  from public.cases where slug = 'ed-chest-pain-arvo';
insert into public.consultations (id, user_id, case_version_id)
select '10000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b', current_version_id
  from public.cases where slug = 'ed-chest-pain-arvo';

insert into public.messages (consultation_id, seq, phase, role, content) values
  ('10000000-0000-4000-8000-00000000000a', 0, 'history', 'patient', 'Alice''s patient line'),
  ('10000000-0000-4000-8000-00000000000b', 0, 'history', 'patient', 'Bob''s patient line');

insert into public.examiner_questions (consultation_id, ord, question, rationale) values
  ('10000000-0000-4000-8000-00000000000a', 1, 'What would you look for on the ECG?', 'Student missed ST changes');

insert into public.assessments (consultation_id, user_id, rubric_version_id, status, overall_score, raw_output)
select '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', rubric_version_id,
       'complete', 72.5, '{"secret": true}'
  from public.case_versions cv join public.cases c on c.current_version_id = cv.id where c.slug = 'ed-chest-pain-arvo';

\echo '  · sign-up trigger creates profile + progress'
do $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = '00000000-0000-4000-8000-00000000000a';
  if p.display_name is distinct from 'Alice Student' then raise exception 'FAIL: display_name %', p.display_name; end if;
  if p.role <> 'student' then raise exception 'FAIL: default role %', p.role; end if;
  if p.avatar_id is null then raise exception 'FAIL: default avatar not assigned'; end if;
  if (select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000000b') <> 'bob' then
    raise exception 'FAIL: email-derived display name';
  end if;
  if not exists (select 1 from public.user_progress where user_id = p.id and level = 1 and total_xp = 0) then
    raise exception 'FAIL: user_progress row missing';
  end if;
end $$;

\echo '  · every public table has RLS enabled'
do $$
declare missing text;
begin
  select string_agg(tablename, ', ') into missing from pg_tables where schemaname = 'public' and not rowsecurity;
  if missing is not null then raise exception 'FAIL: RLS disabled on %', missing; end if;
end $$;

\echo '  · seed loaded: 3 published cases, 18 badges, 60 levels'
do $$
begin
  if (select count(*) from public.cases where status = 'published') <> 3 then raise exception 'FAIL: published cases'; end if;
  if (select count(*) from public.badges) <> 18 then raise exception 'FAIL: badges'; end if;
  if (select count(*) from public.levels) <> 60 then raise exception 'FAIL: levels'; end if;
  if (select xp_required from public.levels where level = 2) <> 100 then raise exception 'FAIL: level 2 xp'; end if;
  if exists (select 1 from public.case_versions where patient_view ? 'clinical' or patient_view::text ilike '%is_red_flag%') then
    raise exception 'FAIL: patient_view contains examiner-only data';
  end if;
  if exists (select 1 from public.rubric_versions where locked_at is null) then raise exception 'FAIL: rubric not locked on publish'; end if;
end $$;

-- As Alice (student) ---------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}';

\echo '  · student: catalog shows published cases without diagnosis'
do $$
begin
  if (select count(*) from public.v_case_catalog) <> 3 then raise exception 'FAIL: catalog count'; end if;
  if exists (select 1 from public.v_case_catalog c where to_jsonb(c)::text ilike '%coronary%' or to_jsonb(c)::text ilike '%subarachnoid%') then
    raise exception 'FAIL: catalog leaks diagnosis';
  end if;
end $$;

\echo '  · student: cannot read case bodies or rubrics'
do $$
begin
  if exists (select 1 from public.case_versions) then raise exception 'FAIL: student read case_versions'; end if;
  if exists (select 1 from public.rubric_items) then raise exception 'FAIL: student read rubric_items'; end if;
  if exists (select 1 from public.audit_logs) then raise exception 'FAIL: student read audit_logs'; end if;
end $$;

\echo '  · student: sees only own consultations and messages'
do $$
begin
  if (select count(*) from public.consultations) <> 1 then raise exception 'FAIL: consultation isolation'; end if;
  if exists (select 1 from public.messages where content like 'Bob%') then raise exception 'FAIL: read Bob''s messages'; end if;
  if (select count(*) from public.messages) <> 1 then raise exception 'FAIL: own messages not visible'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'FAIL: profile isolation'; end if;
end $$;

\echo '  · student: examiner rationale and raw model output are hidden'
do $$
begin
  if (select question from public.examiner_questions) is null then raise exception 'FAIL: question not readable'; end if;
  begin
    perform rationale from public.examiner_questions;
    raise exception 'FAIL: rationale readable';
  exception when insufficient_privilege then null;
  end;
  if (select overall_score from public.assessments) <> 72.5 then raise exception 'FAIL: own score not readable'; end if;
  begin
    perform raw_output from public.assessments;
    raise exception 'FAIL: raw_output readable';
  exception when insufficient_privilege then null;
  end;
end $$;

\echo '  · student: can edit onboarding fields but not role, org or scores'
do $$
begin
  update public.profiles set display_name = 'Ali', exam_type = 'amc_clinical', timezone = 'Australia/Perth'
   where id = auth.uid();
  if (select display_name from public.profiles where id = auth.uid()) <> 'Ali' then raise exception 'FAIL: profile update'; end if;

  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'FAIL: student changed own role';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set timezone = 'Mars/Olympus' where id = auth.uid();
    raise exception 'FAIL: invalid timezone accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.profiles set avatar_id = (select id from public.avatars where slug = 'golden-stethoscope') where id = auth.uid();
    raise exception 'FAIL: locked avatar accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.xp_events (user_id, source, amount, idempotency_key) values (auth.uid(), 'performance', 9999, 'cheat');
    raise exception 'FAIL: student inserted XP';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.consultations set status = 'completed';
    raise exception 'FAIL: student changed station state';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.transition_consultation('10000000-0000-4000-8000-00000000000a', 'created', 'briefing');
    raise exception 'FAIL: student called transition_consultation';
  exception when insufficient_privilege then null;
  end;
end $$;

\echo '  · student: other users'' profile rows are not updatable'
do $$
declare n int;
begin
  update public.profiles set display_name = 'hacked' where id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: updated another profile'; end if;
end $$;

\echo '  · student: secret badges hidden until earned'
do $$
begin
  if exists (select 1 from public.badges where is_secret) then raise exception 'FAIL: secret badge visible'; end if;
  if (select count(*) from public.badges) <> 16 then raise exception 'FAIL: public badge count'; end if;
end $$;

-- As anon ----------------------------------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

\echo '  · anon: no access'
do $$
begin
  begin
    perform 1 from public.v_case_catalog;
    raise exception 'FAIL: anon read catalog';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.profiles;
    raise exception 'FAIL: anon read profiles';
  exception when insufficient_privilege then null;
  end;
end $$;

-- As admin ---------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}';

\echo '  · admin: reads all consultations and case bodies'
do $$
begin
  if (select count(*) from public.consultations) <> 2 then raise exception 'FAIL: admin consultation count'; end if;
  if (select count(*) from public.case_versions) <> 3 then raise exception 'FAIL: admin case_versions'; end if;
end $$;

-- As service role / superuser: integrity rules ---------------------------------------------------------
reset role;

\echo '  · state machine: guarded transitions and deadlines'
do $$
declare c public.consultations;
begin
  c := public.transition_consultation('10000000-0000-4000-8000-00000000000a', 'created', 'briefing');
  c := public.transition_consultation(c.id, 'briefing', 'history');
  if c.phase_deadline_at is null or c.phase_deadline_at - c.history_started_at <> interval '300 seconds' then
    raise exception 'FAIL: history deadline %', c.phase_deadline_at - c.history_started_at;
  end if;
  begin
    perform public.transition_consultation(c.id, 'briefing', 'history');
    raise exception 'FAIL: stale transition succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.transition_consultation(c.id, 'history', 'completed');
    raise exception 'FAIL: illegal transition succeeded';
  exception when invalid_parameter_value then null;
  end;
end $$;

\echo '  · one live station per student'
do $$
begin
  insert into public.consultations (user_id, case_version_id)
  select '00000000-0000-4000-8000-00000000000a', current_version_id from public.cases where slug = 'ed-thunderclap-headache';
  raise exception 'FAIL: second live station allowed';
exception when unique_violation then null;
end $$;

\echo '  · published content is immutable'
do $$
begin
  begin
    update public.case_versions set content = '{}' where published_at is not null;
    raise exception 'FAIL: published case version edited';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.rubric_items set max_points = 99;
    raise exception 'FAIL: locked rubric item edited';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.case_versions;
    raise exception 'FAIL: published case version deleted';
  exception when insufficient_privilege then null;
  end;
end $$;

\echo '  · audit log: privileged changes recorded, log is append-only'
do $$
begin
  if not exists (select 1 from public.audit_logs where action = 'user.privilege_change'
                  and entity_id = '00000000-0000-4000-8000-00000000000c') then
    raise exception 'FAIL: role change not audited';
  end if;
  begin
    delete from public.audit_logs;
    raise exception 'FAIL: audit log deleted';
  exception when insufficient_privilege then null;
  end;
end $$;

\echo '  · xp ledger idempotency'
do $$
begin
  insert into public.xp_events (user_id, source, amount, idempotency_key)
  values ('00000000-0000-4000-8000-00000000000a', 'completion', 50, 'c1:completion');
  insert into public.xp_events (user_id, source, amount, idempotency_key)
  values ('00000000-0000-4000-8000-00000000000a', 'completion', 50, 'c1:completion');
  raise exception 'FAIL: duplicate XP event accepted';
exception when unique_violation then null;
end $$;

rollback;
