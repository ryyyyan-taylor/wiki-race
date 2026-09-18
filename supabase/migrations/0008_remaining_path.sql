-- Replaces the single global "best path" (start -> target) with a per-player
-- distance to the finish: the shortest path found by the same bounded
-- bidirectional search (src/lib/optimal-path.ts), run from each
-- non-winning player's last visited page to the race's target once they're
-- out of the race (forfeited, or left racing when someone else won). NULL
-- until that background search runs (or forever, for the winner); an empty
-- array means it gave up within its budget without finding a connecting
-- path.
alter table race_players add column remaining_path text[];

alter table races drop column optimal_path;
