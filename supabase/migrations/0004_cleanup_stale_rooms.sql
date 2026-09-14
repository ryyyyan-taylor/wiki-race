-- Purges rooms older than 24 hours, win or lose, finished or abandoned
-- mid-lobby. Everything else (players, races, race_players, visits)
-- cascades from `rooms` via existing foreign keys, so deleting the room
-- row is enough to clean up the whole thing.
--
-- Runs hourly via pg_cron, which Supabase supports on every plan. If the
-- `create extension` line errors on permissions, enable pg_cron via the
-- dashboard (Database -> Extensions) instead, then re-run just the
-- `cron.schedule` call below.

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'cleanup-stale-rooms',
  '0 * * * *',
  $$ delete from public.rooms where created_at < now() - interval '24 hours'; $$
);
