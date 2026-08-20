-- 0131: ticket tags — free-form triage labels on mytrion_tickets.
--
-- Additive and idempotent so a hand-edited baseline is safe on both a fresh and an existing DB:
--   * ADD COLUMN IF NOT EXISTS with a NOT NULL DEFAULT '{}', so every existing row reads as untagged
--     with no backfill step.
--   * a GIN index for the `tags @> ARRAY[...]` containment filter the queue's tag filter uses.

ALTER TABLE mytrion_tickets ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_tickets_tags_idx ON mytrion_tickets USING gin (tags);
