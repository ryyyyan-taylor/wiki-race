-- Per-square hints for bingo-family races, keyed by board square index:
-- { "<index>": { "text": string | null, "linkedPages": string[] } }.
-- Lives on the races row so it rides the same subscription as hint_text.
alter table races add column bingo_hints jsonb not null default '{}';
