-- Stations: consultations, messages, transcripts, examiner questions and assessments.

create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  case_version_id uuid not null references public.case_versions (id) on delete restrict,
  status public.consultation_status not null default 'created',
  station_config jsonb not null default '{"history_seconds": 300, "presentation_seconds": 180}',
  started_at timestamptz,
  history_started_at timestamptz,
  history_ended_at timestamptz,
  presentation_started_at timestamptz,
  presentation_ended_at timestamptz,
  completed_at timestamptz,
  phase_deadline_at timestamptz,
  total_active_seconds int not null default 0 check (total_active_seconds >= 0),
  disclosed_fact_ids text[] not null default '{}',
  client_meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index consultations_user_created_idx on public.consultations (user_id, created_at desc);
create index consultations_case_version_idx on public.consultations (case_version_id);
create index consultations_active_idx on public.consultations (status)
  where status in ('created', 'briefing', 'history', 'history_ended', 'presentation', 'examiner_questions', 'assessing');
-- One live station per student. The server abandons stale stations before creating a new one.
create unique index consultations_one_live_per_user on public.consultations (user_id)
  where status in ('created', 'briefing', 'history', 'history_ended', 'presentation', 'examiner_questions');

create trigger consultations_updated_at before update on public.consultations
  for each row execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  seq int not null check (seq >= 0),
  phase public.station_phase not null,
  role public.message_role not null,
  content text not null check (char_length(content) <= 4000),
  emotion text,
  stt_confidence real check (stt_confidence between 0 and 1),
  client_seq int,                    -- idempotency key for student turns
  started_ms int check (started_ms >= 0),
  duration_ms int check (duration_ms >= 0),
  audio_path text,
  created_at timestamptz not null default now(),
  unique (consultation_id, seq)
);

create index messages_consultation_phase_idx on public.messages (consultation_id, phase, seq);
create unique index messages_student_idempotency on public.messages (consultation_id, phase, client_seq)
  where role = 'student' and client_seq is not null;

create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  kind public.station_phase not null,
  text text not null,
  word_count int not null default 0,
  compiled_at timestamptz not null default now(),
  unique (consultation_id, kind)
);

create view public.history_transcripts with (security_invoker = true) as
  select id, consultation_id, text, word_count, compiled_at from public.transcripts where kind = 'history';
create view public.presentation_transcripts with (security_invoker = true) as
  select id, consultation_id, text, word_count, compiled_at from public.transcripts where kind = 'presentation';

create table public.examiner_questions (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  ord smallint not null check (ord between 1 and 3),
  question text not null,
  rationale text,                    -- examiner-only; not granted to students
  targeted_rubric_item_ids uuid[] not null default '{}',
  answer_transcript text,
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (consultation_id, ord)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null unique references public.consultations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rubric_version_id uuid not null references public.rubric_versions (id),
  status public.assessment_status not null default 'pending',
  attempts smallint not null default 0,
  overall_score numeric(5, 2) check (overall_score between 0 and 100),
  global_rating public.global_rating,
  passed boolean,
  strengths jsonb not null default '[]',
  improvements jsonb not null default '[]',
  missed_questions jsonb not null default '[]',
  missed_red_flags jsonb not null default '[]',
  revision_topics jsonb not null default '[]',
  examiner_comment text,
  model text,
  prompt_version text,
  raw_output jsonb,                  -- not granted to students
  error text,                        -- not granted to students
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint assessments_complete_has_score check (status <> 'complete' or overall_score is not null)
);

create index assessments_user_created_idx on public.assessments (user_id, created_at desc);
create index assessments_pending_idx on public.assessments (status) where status <> 'complete';

create table public.assessment_domain_scores (
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  domain public.rubric_domain not null,
  score numeric(6, 2) not null check (score >= 0),
  max numeric(6, 2) not null check (max > 0),
  pct numeric(5, 2) generated always as (round(score / max * 100, 2)) stored,
  primary key (assessment_id, domain),
  constraint domain_score_le_max check (score <= max)
);

create index assessment_domain_scores_domain_idx on public.assessment_domain_scores (domain);

create table public.assessment_item_scores (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  rubric_item_id uuid not null references public.rubric_items (id),
  outcome public.item_outcome not null,
  points numeric(5, 2) not null check (points >= 0),
  evidence_quote text,
  unique (assessment_id, rubric_item_id)
);

-- Station state machine -----------------------------------------------------------

create function public.consultation_transition_allowed(p_from public.consultation_status, p_to public.consultation_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('created'::public.consultation_status, 'briefing'::public.consultation_status),
    ('briefing', 'history'),
    ('history', 'history_ended'),
    ('history_ended', 'presentation'),
    ('presentation', 'examiner_questions'),
    ('examiner_questions', 'assessing'),
    ('assessing', 'completed'),
    ('assessing', 'assessment_failed'),
    ('assessment_failed', 'assessing')
  )
  or (p_to = 'abandoned' and p_from in ('created', 'briefing', 'history', 'history_ended', 'presentation', 'examiner_questions'))
$$;

-- Guarded transition: succeeds only if the row is still in p_from, so concurrent requests can't double-advance.
create function public.transition_consultation(
  p_id uuid,
  p_from public.consultation_status,
  p_to public.consultation_status
)
returns public.consultations
language plpgsql
set search_path = ''
as $$
declare
  v public.consultations;
begin
  if not public.consultation_transition_allowed(p_from, p_to) then
    raise exception 'transition % -> % is not allowed', p_from, p_to using errcode = '22023';
  end if;

  update public.consultations c
     set status = p_to,
         started_at = case when p_to = 'briefing' then now() else c.started_at end,
         history_started_at = case when p_to = 'history' then now() else c.history_started_at end,
         history_ended_at = case when p_to = 'history_ended' then now() else c.history_ended_at end,
         presentation_started_at = case when p_to = 'presentation' then now() else c.presentation_started_at end,
         presentation_ended_at = case when p_to = 'examiner_questions' then now() else c.presentation_ended_at end,
         completed_at = case when p_to = 'completed' then now() else c.completed_at end,
         phase_deadline_at = case p_to
           when 'history' then now() + make_interval(secs => coalesce((c.station_config ->> 'history_seconds')::int, 300))
           when 'presentation' then now() + make_interval(secs => coalesce((c.station_config ->> 'presentation_seconds')::int, 180))
           else null
         end
   where c.id = p_id and c.status = p_from
  returning * into v;

  if not found then
    raise exception 'consultation % is not in state %', p_id, p_from using errcode = '55000';
  end if;
  return v;
end;
$$;
