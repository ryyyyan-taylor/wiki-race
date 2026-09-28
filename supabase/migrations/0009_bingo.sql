-- Bingo mode: a room-configurable second game type alongside the existing
-- single-target `race` mode. game_mode/board_size are room-level config
-- (like banned_pages), copied onto the races row at start so an in-progress
-- race is unaffected by a later rules change.
alter table rooms add column game_mode text not null default 'race'
  check (game_mode in ('race', 'bingo', 'double_bingo', 'lockout'));
alter table rooms add column board_size int check (board_size in (3, 4, 5));

alter table races add column game_mode text not null default 'race'
  check (game_mode in ('race', 'bingo', 'double_bingo', 'lockout'));
alter table races add column board_size int;
alter table races add column board_pages text[];

-- Bingo races have no single target. Nullable rather than a placeholder
-- title — a placeholder would be a real, resolvable page that could
-- silently satisfy the single-target isWin check, computeOptimalPath, and
-- /api/wiki/[code]/target for a bingo race. Every read site needs updating
-- to handle null; that's intentional (tsc surfaces every one).
alter table races alter column target_page drop not null;

alter table race_players add column color text;

create table bingo_claims (
  id bigint generated always as identity primary key,
  race_id uuid not null references races(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  square_index int not null,
  page_title text not null,
  -- Denormalized from races.game_mode = 'lockout' at insert time: a partial
  -- unique index can only reference columns on its own table, so exclusivity
  -- has to live on the claim row rather than be looked up via a join.
  exclusive boolean not null,
  claimed_at timestamptz not null default now(),
  -- One claim per player per square in any mode — makes a revisit of an
  -- already-claimed-by-me square idempotent instead of erroring.
  unique (race_id, square_index, player_id)
);

-- Atomic "first claim wins" for lockout, with no check-then-insert race: two
-- near-simultaneous claims on the same square both attempt the insert, one
-- succeeds, the other hits 23505 and is treated as "not claimed" by the caller.
create unique index bingo_claims_exclusive_square_idx
  on bingo_claims (race_id, square_index) where exclusive;

create index bingo_claims_race_idx on bingo_claims (race_id);

alter table bingo_claims enable row level security;
create policy "public read" on bingo_claims for select using (true);
alter publication supabase_realtime add table bingo_claims;
