-- Permission sets gain an OVERRIDE mode.
--
-- Additive stays the default (false), so every existing set keeps its current behaviour exactly.
-- With override on, that set's layer replaces the profile default, the role default and the per-user
-- override for whoever holds it — which is the only way a tab scope can actually narrow, since a
-- union never can.
--
-- Idempotent per CLAUDE.md: `drizzle-kit generate` is not usable in this repo (its meta snapshots
-- have drifted and it re-emits already-applied tables), so migrations here are hand-written.
ALTER TABLE mytrion_permission_sets
  ADD COLUMN IF NOT EXISTS override boolean NOT NULL DEFAULT false;
