-- Row Level Security and grants.
--
-- Model: students READ their own data through RLS. All writes except a handful of profile fields go
-- through trusted server code using the service role, so students can never write scores, XP or
-- station state. Admins read everything; educators read profiles in their organisation.

-- 1. Lock everything down, then grant back precisely ---------------------------------------------

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- New objects are private by default; each must be granted explicitly (and get RLS).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Policy helpers and student-callable RPCs
grant execute on function public.auth_role(), public.auth_org(), public.is_admin() to authenticated;
grant execute on function public.my_weekly_stats(int) to authenticated;

-- Readable tables (rows filtered by policies below)
grant select on
  public.organizations, public.avatars, public.user_avatars, public.profiles, public.specialties,
  public.cases, public.case_versions, public.rubrics, public.rubric_versions, public.rubric_items,
  public.consultations, public.messages, public.transcripts,
  public.assessment_domain_scores, public.assessment_item_scores,
  public.levels, public.user_progress, public.xp_events, public.daily_activity, public.streaks,
  public.badges, public.user_badges, public.goals, public.user_goals, public.milestones, public.user_milestones,
  public.learning_analytics, public.ai_calls, public.voice_usage, public.audit_logs, public.feature_flags
to authenticated;

-- Column-restricted reads: examiner rationale and raw model output stay server-side.
grant select (id, consultation_id, ord, question, answer_transcript, asked_at, answered_at)
  on public.examiner_questions to authenticated;
grant select (id, consultation_id, user_id, rubric_version_id, status, overall_score, global_rating, passed,
              strengths, improvements, missed_questions, missed_red_flags, revision_topics, examiner_comment,
              created_at, completed_at)
  on public.assessments to authenticated;

grant select on public.v_case_catalog, public.history_transcripts, public.presentation_transcripts,
  public.achievements to authenticated;

-- Students may edit only their own onboarding/profile fields. role, organization_id, deleted_at: service role only.
grant update (display_name, avatar_id, exam_type, exam_date, target_specialties,
              daily_goal_cases, weekly_goal_cases, timezone, onboarding_completed_at)
  on public.profiles to authenticated;

revoke all on public.mv_user_weekly_stats from anon, authenticated;

-- 2. Policies ------------------------------------------------------------------------------------

-- Reference data
create policy "read reference data" on public.avatars for select to authenticated using (true);
create policy "read reference data" on public.specialties for select to authenticated using (true);
create policy "read reference data" on public.levels for select to authenticated using (true);
create policy "read reference data" on public.goals for select to authenticated using (true);
create policy "read reference data" on public.milestones for select to authenticated using (true);

create policy "read visible badges" on public.badges for select to authenticated
  using (
    not is_secret
    or public.is_admin()
    or exists (select 1 from public.user_badges ub where ub.badge_id = badges.id and ub.user_id = (select auth.uid()))
  );

-- Identity
create policy "read own organisation" on public.organizations for select to authenticated
  using (id = (select public.auth_org()) or (select public.is_admin()));

create policy "read own, org (educator) or any (admin) profile" on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_admin())
    or (organization_id is not null
        and organization_id = (select public.auth_org())
        and (select public.auth_role()) = 'educator')
  );

create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid()) and deleted_at is null)
  with check (id = (select auth.uid()));

-- Content: students see published case metadata only; case bodies and rubrics are admin/server-only.
create policy "read published cases" on public.cases for select to authenticated
  using (
    (status = 'published' and (organization_id is null or organization_id = (select public.auth_org())))
    or (select public.is_admin())
  );

create policy "admin read" on public.case_versions for select to authenticated using ((select public.is_admin()));
create policy "admin read" on public.rubrics for select to authenticated using ((select public.is_admin()));
create policy "admin read" on public.rubric_versions for select to authenticated using ((select public.is_admin()));
create policy "admin read" on public.rubric_items for select to authenticated using ((select public.is_admin()));
create policy "admin read" on public.ai_calls for select to authenticated using ((select public.is_admin()));
create policy "admin read" on public.voice_usage for select to authenticated using ((select public.is_admin()));
create policy "admin read" on public.audit_logs for select to authenticated using ((select public.is_admin()));
create policy "admin read" on public.feature_flags for select to authenticated using ((select public.is_admin()));

-- Own rows (user_id)
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_avatars', 'consultations', 'assessments', 'user_progress', 'xp_events', 'daily_activity',
    'streaks', 'user_badges', 'user_goals', 'user_milestones', 'learning_analytics'
  ] loop
    execute format(
      'create policy "read own rows" on public.%I for select to authenticated
         using (user_id = (select auth.uid()) or (select public.is_admin()))', t);
  end loop;
end;
$$;

-- Children of a consultation
do $$
declare
  t text;
begin
  foreach t in array array['messages', 'transcripts', 'examiner_questions'] loop
    execute format(
      'create policy "read own consultation rows" on public.%I for select to authenticated
         using (
           exists (select 1 from public.consultations c
                    where c.id = %I.consultation_id and c.user_id = (select auth.uid()))
           or (select public.is_admin())
         )', t, t);
  end loop;
end;
$$;

-- Children of an assessment
do $$
declare
  t text;
begin
  foreach t in array array['assessment_domain_scores', 'assessment_item_scores'] loop
    execute format(
      'create policy "read own assessment rows" on public.%I for select to authenticated
         using (
           exists (select 1 from public.assessments a
                    where a.id = %I.assessment_id and a.user_id = (select auth.uid()))
           or (select public.is_admin())
         )', t, t);
  end loop;
end;
$$;
