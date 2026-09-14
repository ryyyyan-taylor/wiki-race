-- Supports the hint feature: revealed once per race, delivered to every
-- player through the same `races` row subscription they already have.
alter table races add column hint_text text;
alter table races add column hint_revealed_at timestamptz;
