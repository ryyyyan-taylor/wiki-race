-- Switches from manual Broadcast (a websocket handshake per write, blocking
-- the response) to Postgres Changes: clients subscribe directly to row
-- updates, so writes no longer pay a realtime round-trip.
--
-- This requires anon to be able to SELECT these rows (Realtime enforces
-- RLS using the connecting role). There's no per-player auth to scope that
-- by, so it's public read on non-sensitive game state; writes stay
-- service-role-only.

alter table races add column winner_path text[];

create policy "public read" on rooms for select using (true);
create policy "public read" on players for select using (true);
create policy "public read" on races for select using (true);
create policy "public read" on race_players for select using (true);

alter publication supabase_realtime add table rooms, players, races, race_players;
