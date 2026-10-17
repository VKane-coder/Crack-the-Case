-- Awards XP through the ledger. Idempotent on p_key: a repeated call awards nothing and reports the current totals.
-- Service role only; M5's fn_grant_rewards builds on this.

create function public.grant_xp(
  p_user uuid,
  p_source public.xp_source,
  p_amount int,
  p_key text,
  p_consultation uuid default null,
  p_meta jsonb default '{}'
)
returns table (awarded boolean, total_xp int, level int, leveled_up boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_inserted boolean;
  v_old_level int;
  v_total int;
  v_level int;
begin
  insert into public.xp_events (user_id, consultation_id, source, amount, idempotency_key, meta)
  values (p_user, p_consultation, p_source, p_amount, p_key, coalesce(p_meta, '{}'))
  on conflict (idempotency_key) do nothing;
  v_inserted := found;

  select up.level into v_old_level from public.user_progress up where up.user_id = p_user for update;
  if not found then
    raise exception 'no user_progress row for %', p_user using errcode = 'P0002';
  end if;

  if v_inserted then
    update public.user_progress up
       set total_xp = greatest(up.total_xp + p_amount, 0)
     where up.user_id = p_user
    returning up.total_xp into v_total;

    select coalesce(max(l.level), 1) into v_level from public.levels l where l.xp_required <= v_total;
    update public.user_progress up set level = v_level where up.user_id = p_user;
  else
    select up.total_xp, up.level into v_total, v_level from public.user_progress up where up.user_id = p_user;
  end if;

  return query select v_inserted, v_total, v_level, v_level > v_old_level;
end;
$$;

revoke execute on function public.grant_xp(uuid, public.xp_source, int, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.grant_xp(uuid, public.xp_source, int, text, uuid, jsonb) to service_role;
