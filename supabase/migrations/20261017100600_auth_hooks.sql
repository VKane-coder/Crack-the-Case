-- New sign-ups get a profile and a progress row. Onboarding (/onboarding) fills in the rest.

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := left(coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Student'
  ), 40);
begin
  insert into public.profiles (id, display_name, avatar_id)
  values (
    new.id,
    v_name,
    (select id from public.avatars where is_default order by sort_order limit 1)
  );
  insert into public.user_progress (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
