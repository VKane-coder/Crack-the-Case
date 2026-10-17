-- grant_xp: ledger idempotency, totals and level-ups.

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000d1', 'xp@example.edu.au');

\echo '  · grant_xp awards once per idempotency key'
do $$
declare r record;
begin
  select * into r from public.grant_xp('00000000-0000-4000-8000-0000000000d1', 'onboarding', 50, 'u1:onboarding');
  if not r.awarded or r.total_xp <> 50 or r.level <> 1 or r.leveled_up then
    raise exception 'FAIL: first grant %', r;
  end if;

  select * into r from public.grant_xp('00000000-0000-4000-8000-0000000000d1', 'onboarding', 50, 'u1:onboarding');
  if r.awarded or r.total_xp <> 50 then raise exception 'FAIL: repeat grant awarded %', r; end if;

  if (select count(*) from public.xp_events where user_id = '00000000-0000-4000-8000-0000000000d1') <> 1 then
    raise exception 'FAIL: ledger rows';
  end if;
end $$;

\echo '  · grant_xp levels up from the levels table'
do $$
declare r record;
begin
  -- level 2 needs 100 XP cumulative
  select * into r from public.grant_xp('00000000-0000-4000-8000-0000000000d1', 'completion', 60, 'c1:completion');
  if r.total_xp <> 110 or r.level <> 2 or not r.leveled_up then raise exception 'FAIL: level-up %', r; end if;
  if (select level from public.user_progress where user_id = '00000000-0000-4000-8000-0000000000d1') <> 2 then
    raise exception 'FAIL: user_progress.level not stored';
  end if;
end $$;

\echo '  · grant_xp rejects unknown users'
do $$
begin
  perform public.grant_xp('00000000-0000-4000-8000-0000000000ff', 'completion', 10, 'ghost');
  raise exception 'FAIL: unknown user accepted';
exception when foreign_key_violation then null;
end $$;

\echo '  · students cannot call grant_xp'
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';
do $$
begin
  perform public.grant_xp(auth.uid(), 'performance', 10000, 'cheat');
  raise exception 'FAIL: student granted XP';
exception when insufficient_privilege then null;
end $$;

rollback;
