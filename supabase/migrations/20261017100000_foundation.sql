-- Foundation: extensions, enums and shared trigger functions.

create extension if not exists pgcrypto with schema extensions;

-- Identity
create type public.user_role as enum ('student', 'educator', 'admin', 'super_admin');
create type public.avatar_rarity as enum ('common', 'rare', 'epic', 'legendary');

-- Content
create type public.case_status as enum ('draft', 'review', 'published', 'archived');
create type public.station_type as enum ('history', 'explanation', 'counselling', 'data_interpretation');
create type public.rubric_domain as enum (
  'history', 'communication', 'differentials', 'investigations',
  'management', 'clinical_reasoning', 'patient_safety'
);

-- Stations
create type public.consultation_status as enum (
  'created', 'briefing', 'history', 'history_ended', 'presentation',
  'examiner_questions', 'assessing', 'completed', 'assessment_failed', 'abandoned'
);
create type public.station_phase as enum ('history', 'presentation', 'examiner_qa');
create type public.message_role as enum ('student', 'patient', 'examiner', 'system');
create type public.item_outcome as enum ('met', 'partial', 'not_met');
create type public.global_rating as enum ('fail', 'borderline', 'pass', 'good', 'excellent');
create type public.assessment_status as enum ('pending', 'complete', 'failed');

-- Gamification
create type public.xp_source as enum (
  'completion', 'performance', 'improvement', 'first_of_day',
  'goal', 'badge', 'streak_bonus', 'onboarding'
);
create type public.badge_category as enum ('history', 'communication', 'safety', 'consistency', 'milestone', 'specialty');
create type public.badge_tier as enum ('bronze', 'silver', 'gold', 'emerald');
create type public.goal_scope as enum ('daily', 'weekly');
create type public.goal_kind as enum ('cases', 'minutes', 'specialty_cases', 'score_threshold');
create type public.milestone_type as enum ('consultations', 'xp', 'badges');

-- Ops
create type public.ai_agent as enum ('patient', 'examiner_q', 'examiner_assess', 'case_tool');
create type public.voice_provider as enum ('deepgram', 'elevenlabs');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
