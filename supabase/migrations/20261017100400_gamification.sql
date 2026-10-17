-- Gamification: levels, progress, XP ledger, streaks, badges, goals, milestones.
-- Reward writes happen in one server-side transaction (fn_grant_rewards, M5); students only read.

create table public.levels (
  level int primary key check (level >= 1),
  title text not null,
  xp_required int not null unique check (xp_required >= 0),   -- cumulative; mirrors src/server/gamification/levels.ts
  reward_avatar_id uuid references public.avatars (id) on delete set null
);

create table public.user_progress (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  total_xp int not null default 0 check (total_xp >= 0),
  level int not null default 1 check (level >= 1),
  current_streak int not null default 0 check (current_streak >= 0),
  longest_streak int not null default 0 check (longest_streak >= current_streak),
  last_active_date date,
  streak_freezes smallint not null default 0 check (streak_freezes between 0 and 2),
  total_consultations int not null default 0 check (total_consultations >= 0),
  total_seconds int not null default 0 check (total_seconds >= 0),
  updated_at timestamptz not null default now()
);

create trigger user_progress_updated_at before update on public.user_progress
  for each row execute function public.set_updated_at();

-- Append-only ledger: user_progress.total_xp = sum(amount). idempotency_key e.g. '<consultation_id>:performance'.
create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  consultation_id uuid references public.consultations (id) on delete set null,
  source public.xp_source not null,
  amount int not null check (amount between -10000 and 10000 and amount <> 0),
  idempotency_key text not null unique,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index xp_events_user_created_idx on public.xp_events (user_id, created_at desc);

-- One row per user per local calendar day (profile timezone). Drives streaks and the activity heatmap.
create table public.daily_activity (
  user_id uuid not null references public.profiles (id) on delete cascade,
  activity_date date not null,
  consultations int not null default 0 check (consultations >= 0),
  xp int not null default 0,
  seconds int not null default 0 check (seconds >= 0),
  goal_met boolean not null default false,
  froze boolean not null default false,  -- day covered by a streak freeze
  primary key (user_id, activity_date)
);

create table public.streaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_on date not null,
  ended_on date,
  length int not null default 1 check (length >= 1),
  check (ended_on is null or ended_on >= started_on)
);

create unique index streaks_one_open_per_user on public.streaks (user_id) where ended_on is null;
create index streaks_user_idx on public.streaks (user_id, started_on desc);

create table public.badges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9_]+$'),
  name text not null,
  description text not null,
  category public.badge_category not null,
  tier public.badge_tier not null,
  icon text not null,                -- lucide icon name
  criteria jsonb not null,           -- evaluated by src/server/gamification/badges.ts
  xp_reward int not null default 0 check (xp_reward >= 0),
  is_secret boolean not null default false,
  sort_order int not null default 0
);

create table public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_id uuid not null references public.badges (id) on delete cascade,
  consultation_id uuid references public.consultations (id) on delete set null,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create index user_badges_recent_idx on public.user_badges (user_id, awarded_at desc);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  scope public.goal_scope not null,
  kind public.goal_kind not null,
  target int not null check (target > 0),   -- default; per-user targets are snapshotted in user_goals
  specialty_id uuid references public.specialties (id) on delete cascade,
  xp_reward int not null default 0 check (xp_reward >= 0),
  is_active boolean not null default true
);

create table public.user_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  period_start date not null,
  target int not null check (target > 0),
  progress int not null default 0 check (progress >= 0),
  completed_at timestamptz,
  unique (user_id, goal_id, period_start)
);

create index user_goals_user_period_idx on public.user_goals (user_id, period_start desc);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  threshold_type public.milestone_type not null,
  threshold int not null check (threshold > 0),
  unique (threshold_type, threshold)
);

create table public.user_milestones (
  user_id uuid not null references public.profiles (id) on delete cascade,
  milestone_id uuid not null references public.milestones (id) on delete cascade,
  achieved_at timestamptz not null default now(),
  primary key (user_id, milestone_id)
);

-- Unified trophy feed for the hub and trophy room.
create view public.achievements with (security_invoker = true) as
  select ub.user_id, 'badge'::text as kind, b.slug, b.name, b.tier::text as tier, b.icon, ub.awarded_at as achieved_at
    from public.user_badges ub join public.badges b on b.id = ub.badge_id
  union all
  select um.user_id, 'milestone', m.slug, m.name, null, 'flag', um.achieved_at
    from public.user_milestones um join public.milestones m on m.id = um.milestone_id;
