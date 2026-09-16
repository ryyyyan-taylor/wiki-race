-- The provably-shortest path between a race's start and target pages, found
-- by a bounded bidirectional link search (src/lib/optimal-path.ts) once the
-- race ends. NULL until that background search finishes; an empty array
-- means it gave up within its budget without finding a connecting path.
alter table races add column optimal_path text[];
