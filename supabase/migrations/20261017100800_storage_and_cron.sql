-- Storage buckets and scheduled jobs. Both are guarded so the schema also applies to plain Postgres
-- (local tests) where the storage schema and pg_cron are absent.

-- Storage ------------------------------------------------------------------------------------------
-- avatars:              public read (cosmetic art)
-- case-media:           private; served to students via signed URLs from the server after checks
-- consultation-audio:   private; only written when a student opts in to audio retention.
--                       Path convention: <user_id>/<consultation_id>/<seq>.webm
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping buckets';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true),
         ('case-media', 'case-media', false),
         ('consultation-audio', 'consultation-audio', false)
  on conflict (id) do nothing;

  execute $p$
    create policy "students read own consultation audio" on storage.objects for select to authenticated
      using (bucket_id = 'consultation-audio' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $p$;
end;
$$;

-- Scheduled jobs -----------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available; skipping schedules';
    return;
  end if;

  create extension if not exists pg_cron;

  perform cron.schedule(
    'refresh-weekly-stats',
    '7 * * * *',
    'refresh materialized view concurrently public.mv_user_weekly_stats'
  );
  -- Streak expiry (per-timezone buckets) and weekly goal rollover are added with fn_grant_rewards in M5.
end;
$$;
