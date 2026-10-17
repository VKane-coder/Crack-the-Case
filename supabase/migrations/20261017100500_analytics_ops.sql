-- Analytics, AI/voice cost tracking, audit trail and feature flags.

create table public.learning_analytics (
  user_id uuid not null references public.profiles (id) on delete cascade,
  specialty_id uuid not null references public.specialties (id) on delete cascade,
  domain public.rubric_domain not null,
  attempts int not null default 0 check (attempts >= 0),
  avg_pct numeric(5, 2),
  best_pct numeric(5, 2),
  last_pct numeric(5, 2),
  trend_slope numeric(8, 4),
  updated_at timestamptz not null default now(),
  primary key (user_id, specialty_id, domain)
);

create index learning_analytics_user_domain_idx on public.learning_analytics (user_id, domain);

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid references public.consultations (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  agent public.ai_agent not null,
  model text not null,
  prompt_version text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  latency_ms int,
  cost_usd numeric(10, 6) not null default 0,
  status text not null check (status in ('ok', 'error', 'fallback')),
  error text,
  created_at timestamptz not null default now()
);

create index ai_calls_created_idx on public.ai_calls (created_at desc);
create index ai_calls_user_created_idx on public.ai_calls (user_id, created_at desc);
create index ai_calls_consultation_idx on public.ai_calls (consultation_id);

create table public.voice_usage (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid references public.consultations (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  provider public.voice_provider not null,
  units numeric(12, 2) not null check (units >= 0),
  unit text not null check (unit in ('seconds', 'characters')),
  cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index voice_usage_user_created_idx on public.voice_usage (user_id, created_at desc);

-- Append-only. actor_id has no FK so the trail survives account deletion.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  organization_id uuid,
  action text not null,              -- e.g. 'case.publish', 'user.role_change'
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create function public.audit_logs_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.audit_logs_append_only();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function public.audit_logs_append_only();

-- Defence in depth: privileged changes are audited by the database even if app code forgets.
-- Server code may set app.actor_id (set_config) inside an RPC to attribute service-role writes.
create function public.audit_privileged_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid);
begin
  -- Nested IFs: PL/pgSQL resolves every record field in an expression, so table-specific
  -- columns must not share a condition with the table check.
  if tg_table_name = 'profiles' then
    if new.role is distinct from old.role or new.organization_id is distinct from old.organization_id then
      insert into public.audit_logs (actor_id, organization_id, action, entity_type, entity_id, before, after)
      values (v_actor, new.organization_id, 'user.privilege_change', 'profile', new.id::text,
              jsonb_build_object('role', old.role, 'organization_id', old.organization_id),
              jsonb_build_object('role', new.role, 'organization_id', new.organization_id));
    end if;
  elsif tg_table_name = 'cases' then
    if new.status is distinct from old.status then
      insert into public.audit_logs (actor_id, organization_id, action, entity_type, entity_id, before, after)
      values (v_actor, new.organization_id, 'case.status_change', 'case', new.id::text,
              jsonb_build_object('status', old.status, 'current_version_id', old.current_version_id),
              jsonb_build_object('status', new.status, 'current_version_id', new.current_version_id));
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_audit after update on public.profiles
  for each row execute function public.audit_privileged_change();
create trigger cases_audit after update on public.cases
  for each row execute function public.audit_privileged_change();

create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  rules jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create trigger feature_flags_updated_at before update on public.feature_flags
  for each row execute function public.set_updated_at();

-- Weekly stats per student, bucketed in their own timezone. Refreshed hourly (see cron migration).
-- Materialized views have no RLS, so access goes through my_weekly_stats() only.
create materialized view public.mv_user_weekly_stats as
select
  c.user_id,
  date_trunc('week', c.completed_at at time zone p.timezone)::date as week_start,
  count(*)::int as consultations,
  round(sum(c.total_active_seconds) / 60.0, 1) as minutes,
  round(avg(a.overall_score), 2) as avg_score
from public.consultations c
join public.profiles p on p.id = c.user_id
left join public.assessments a on a.consultation_id = c.id and a.status = 'complete'
where c.status = 'completed'
group by c.user_id, 2;

create unique index mv_user_weekly_stats_pk on public.mv_user_weekly_stats (user_id, week_start);

create function public.my_weekly_stats(p_weeks int default 12)
returns table (week_start date, consultations int, minutes numeric, avg_score numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select week_start, consultations, minutes, avg_score
    from public.mv_user_weekly_stats
   where user_id = auth.uid()
   order by week_start desc
   limit least(greatest(p_weeks, 1), 104)
$$;
