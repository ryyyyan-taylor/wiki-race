-- Supports the "Linked Page" hint: pages that link to the target page
-- (Wikipedia's "what links here"), revealed one at a time like hint_text.
alter table races add column linked_page_hints text[] not null default '{}';
