-- Powers the open-room list on the home page: a room only counts as open
-- once at least one player has heartbeated recently, so a room whose last
-- tab closed uncleanly (no clean disconnect event) drops off the list
-- instead of lingering as joinable forever.
alter table players add column last_seen_at timestamptz not null default now();
