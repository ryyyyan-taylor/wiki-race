-- Forfeiting is a toggleable vote: players keep racing while voted, and the
-- race only ends (everyone marked 'forfeited') once every racer has voted.
alter table race_players add column forfeit_vote boolean not null default false;
