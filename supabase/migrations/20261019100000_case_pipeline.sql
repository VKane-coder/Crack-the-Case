-- One station clock and author-supplied case extras (docs/architecture.md §2.3).
--
-- Reading time (2 minutes by default) is followed by a single station clock (8 minutes by default)
-- that runs across the patient and examiner stages. When it runs out the station goes straight to
-- marking, from whichever stage the student was in.

-- Per-case patient voice (ElevenLabs voice id) and avatar image. On cases, not case_versions, so a
-- voice or picture can change without publishing a new version.
alter table public.cases
  add column voice_id text check (voice_id ~ '^[A-Za-z0-9]{10,40}$'),
  add column avatar_path text;

alter table public.consultations
  add column station_deadline_at timestamptz,
  alter column station_config set default '{"reading_seconds": 120, "station_seconds": 480}';

-- Examiner items written by the case author (some show an image from the case-media bucket).
-- Server-only columns: not added to the student column grant.
alter table public.examiner_questions
  add column item_key text,
  add column media_path text,
  drop constraint examiner_questions_ord_check,
  add constraint examiner_questions_ord_check check (ord between 1 and 10);

-- Station length in seconds. Stations created before this change carried separate history and
-- presentation budgets; their sum stands in for the station clock.
create function public.station_seconds(p_config jsonb)
returns int
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (p_config ->> 'station_seconds')::int,
    coalesce((p_config ->> 'history_seconds')::int, 300) + coalesce((p_config ->> 'presentation_seconds')::int, 180)
  )
$$;

create or replace function public.consultation_transition_allowed(p_from public.consultation_status, p_to public.consultation_status)
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
    -- The station clock ran out before the examiner stage finished.
    ('history', 'assessing'),
    ('history_ended', 'assessing'),
    ('presentation', 'assessing'),
    ('assessing', 'completed'),
    ('assessing', 'assessment_failed'),
    ('assessment_failed', 'assessing')
  )
  or (p_to = 'abandoned' and p_from in ('created', 'briefing', 'history', 'history_ended', 'presentation', 'examiner_questions'))
$$;

create or replace function public.transition_consultation(
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
         history_ended_at = case when p_to in ('history_ended', 'assessing') and c.history_ended_at is null and c.history_started_at is not null
                                 then now() else c.history_ended_at end,
         presentation_started_at = case when p_to = 'presentation' then now() else c.presentation_started_at end,
         presentation_ended_at = case when p_to = 'examiner_questions' then now() else c.presentation_ended_at end,
         completed_at = case when p_to = 'completed' then now() else c.completed_at end,
         -- The station clock starts with the patient and is never reset by later stages.
         station_deadline_at = case when p_to = 'history'
                                    then now() + make_interval(secs => public.station_seconds(c.station_config))
                                    else c.station_deadline_at end,
         phase_deadline_at = case
           when p_to = 'history' then now() + make_interval(secs => public.station_seconds(c.station_config))
           when p_to in ('history_ended', 'presentation', 'examiner_questions') then c.station_deadline_at
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

-- Catalogue: add the reading and station lengths (new columns go last so the view can be replaced).
create or replace view public.v_case_catalog as
select
  c.id,
  c.slug,
  c.title,
  c.difficulty,
  c.tags,
  s.slug as specialty_slug,
  s.name as specialty_name,
  s.colour_token as specialty_colour,
  cv.id as case_version_id,
  cv.content ->> 'candidate_brief' as candidate_brief,
  cv.content #>> '{patient,persona}' as persona,
  coalesce((cv.content #>> '{meta,station,history_seconds}')::int, 300) as history_seconds,
  coalesce((cv.content #>> '{meta,station,presentation_seconds}')::int, 180) as presentation_seconds,
  -- learning objectives are not exposed here: they usually name the diagnosis
  c.search,
  coalesce((cv.content #>> '{meta,station,reading_seconds}')::int, 120) as reading_seconds,
  public.station_seconds(cv.content #> '{meta,station}') as station_seconds
from public.cases c
join public.specialties s on s.id = c.specialty_id
join public.case_versions cv on cv.id = c.current_version_id
where c.status = 'published'
  and cv.published_at is not null
  and (c.organization_id is null or c.organization_id = public.auth_org())
  and auth.uid() is not null;

-- New functions are private by default (20261017100700_rls.sql); the server's transitions need this one.
grant execute on function public.station_seconds(jsonb) to service_role;
