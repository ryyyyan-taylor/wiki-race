-- Wiki Race schema.
-- No Supabase Auth is used; every write goes through Next.js API routes
-- using the service-role key. RLS is enabled with no policies on every
-- table, so the anon key (used client-side only for Realtime broadcast/
-- presence) has no direct table access.

create table rooms (
  code text primary key,
  host_player_id uuid,
  status text not null default 'lobby' check (status in ('lobby', 'racing')),
  start_page text,
  target_page text,
  banned_pages text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references rooms(code) on delete cascade,
  name text not null,
  is_host boolean not null default false,
  connected boolean not null default true,
  token text not null unique,
  created_at timestamptz not null default now()
);

alter table rooms
  add constraint rooms_host_player_id_fkey
  foreign key (host_player_id) references players(id) on delete set null;

create table races (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references rooms(code) on delete cascade,
  start_page text not null,
  target_page text not null,
  status text not null default 'active' check (status in ('active', 'finished', 'all_forfeited')),
  winner_player_id uuid references players(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table race_players (
  race_id uuid not null references races(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  status text not null default 'racing' check (status in ('racing', 'forfeited', 'finished')),
  current_page text not null,
  pages_visited_count int not null default 0,
  finished_at timestamptz,
  primary key (race_id, player_id)
);

create table visits (
  id bigint generated always as identity primary key,
  race_id uuid not null references races(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  page_title text not null,
  sequence_index int not null,
  visited_at timestamptz not null default now()
);

create index visits_race_player_idx on visits (race_id, player_id, sequence_index);

alter table rooms enable row level security;
alter table players enable row level security;
alter table races enable row level security;
alter table race_players enable row level security;
alter table visits enable row level security;
