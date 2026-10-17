-- Identity & tenancy: organisations, profiles, avatars, auth helper functions.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  plan text not null default 'free',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.avatars (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  emoji text,                       -- placeholder rendering until illustrated assets land
  asset_url text,
  rarity public.avatar_rarity not null default 'common',
  unlock_rule jsonb,                -- null = available to everyone
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  role public.user_role not null default 'student',
  display_name text check (char_length(display_name) between 1 and 40),
  avatar_id uuid references public.avatars (id) on delete set null,
  exam_type text check (exam_type in ('school_osce', 'amc_clinical', 'other')),
  exam_date date,
  target_specialties text[] not null default '{}',
  daily_goal_cases smallint not null default 1 check (daily_goal_cases between 1 and 10),
  weekly_goal_cases smallint not null default 5 check (weekly_goal_cases between 1 and 50),
  timezone text not null default 'Australia/Sydney',
  onboarding_completed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_org_role_idx on public.profiles (organization_id, role);

create table public.user_avatars (
  user_id uuid not null references public.profiles (id) on delete cascade,
  avatar_id uuid not null references public.avatars (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, avatar_id)
);

create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Validates timezone (streak day boundaries depend on it) and that the chosen avatar is unlocked.
create function public.profiles_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is distinct from old.timezone or tg_op = 'INSERT' then
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
      raise exception 'invalid timezone: %', new.timezone using errcode = '22023';
    end if;
  end if;

  if new.avatar_id is not null and (tg_op = 'INSERT' or new.avatar_id is distinct from old.avatar_id) then
    if not exists (
      select 1 from public.avatars a
      where a.id = new.avatar_id
        and (a.is_default or a.unlock_rule is null
             or exists (select 1 from public.user_avatars ua where ua.user_id = new.id and ua.avatar_id = a.id))
    ) then
      raise exception 'avatar not unlocked' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_validate before insert or update on public.profiles
  for each row execute function public.profiles_validate();

-- RLS helpers. security definer so policies can read the caller's profile without recursing into profiles RLS.
create function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and deleted_at is null
$$;

create function public.auth_org()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('admin', 'super_admin'), false)
$$;
