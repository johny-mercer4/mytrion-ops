-- Collection desk — the write side: timeline, promises to pay, payment plans and their schedules.
--
-- HAND-WRITTEN AND IDEMPOTENT, like 0127 (and for the same reason: `src/db/schema/collection*.ts`
-- is deliberately absent from drizzle.config.ts's schema list, because the meta/ snapshot is stale
-- against several teams' files and `db:generate` would emit their pending drift alongside this).
-- Every statement is IF NOT EXISTS so a re-run on an environment that already has these tables is
-- a no-op and a fresh `pnpm db:migrate` creates them.
--
-- All four cascade off collection_cases: the finder deletes a case once remaining debt falls below
-- $100, and desk history for a debt that no longer exists is not worth orphaning.
--
-- ⚠ THE JOURNAL TIMESTAMP ON THIS ONE IS DELIBERATE (1787090000001), and the reason is a live trap.
-- drizzle's migrator applies an entry only when `lastAppliedCreatedAt < folderMillis` (see
-- pg-core/dialect.js). PROD's __drizzle_migrations high-water mark is 1787081000001 — two
-- migrations were applied there out of band, from no branch in this repo — so ANY migration
-- numbered below that is silently skipped on prod for ever, with `db:migrate` still reporting
-- success. This file was originally 0129 at 1786997506836 and would have been swallowed exactly
-- that way. `0129_recruit_resume` on build is below the mark and IS currently being swallowed:
-- none of its five `recruit_candidates.resume_*` columns exist on prod. Check the mark before
-- numbering the next one.
--
-- RENUMBERED 0130 -> 0131 when build's `0130_desk_catalog_seed` landed on the same number. Only the
-- file name and the journal tag moved; the timestamp did NOT. drizzle stores the SQL hash and
-- created_at, never the tag, so prod and local (both already at 1787090000001) see no change and
-- this does not re-run. `0130_desk_catalog_seed` is at 1786997506837 — below the mark — so it is
-- being swallowed on prod the same way recruit's is.

CREATE TABLE IF NOT EXISTS collection_activity (
  id                text PRIMARY KEY,
  case_id           text NOT NULL REFERENCES collection_cases(id) ON DELETE CASCADE,
  kind              text NOT NULL,
  channel           text,
  outcome           text,
  summary           text NOT NULL,
  note              text,
  contact_name      text,
  amount            numeric,
  actor_user_id     text,
  actor_name        text,
  meta              jsonb,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collection_activity_case_idx
  ON collection_activity (case_id, occurred_at);
-- Serves `Last touch`: the newest contact per case, without walking the rest of the feed.
CREATE INDEX IF NOT EXISTS collection_activity_contact_idx
  ON collection_activity (kind, case_id, occurred_at);

CREATE TABLE IF NOT EXISTS collection_promises (
  id                  text PRIMARY KEY,
  case_id             text NOT NULL REFERENCES collection_cases(id) ON DELETE CASCADE,
  amount              numeric NOT NULL,
  due_date            date NOT NULL,
  status              text NOT NULL DEFAULT 'open',
  note                text,
  created_by_user_id  text,
  created_by_name     text,
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collection_promises_case_idx
  ON collection_promises (case_id, due_date);
-- The worklist asks "which promises are due or lapsed" across the whole open book.
CREATE INDEX IF NOT EXISTS collection_promises_due_idx
  ON collection_promises (status, due_date);

CREATE TABLE IF NOT EXISTS collection_payment_plans (
  id                  text PRIMARY KEY,
  case_id             text NOT NULL REFERENCES collection_cases(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'active',
  instalment_amount   numeric NOT NULL,
  instalment_count    integer NOT NULL,
  frequency           text NOT NULL,
  first_payment_date  date NOT NULL,
  note                text,
  supersedes_plan_id  text,
  created_by_user_id  text,
  created_by_name     text,
  closed_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collection_payment_plans_case_idx
  ON collection_payment_plans (case_id, created_at);
-- AT MOST ONE ACTIVE PLAN PER CASE, enforced here rather than in application code: two live
-- schedules against one debt is an accounting question nobody can answer after the fact.
CREATE UNIQUE INDEX IF NOT EXISTS collection_payment_plans_active_uk
  ON collection_payment_plans (case_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS collection_plan_instalments (
  id          text PRIMARY KEY,
  plan_id     text NOT NULL REFERENCES collection_payment_plans(id) ON DELETE CASCADE,
  case_id     text NOT NULL REFERENCES collection_cases(id) ON DELETE CASCADE,
  seq         integer NOT NULL,
  due_date    date NOT NULL,
  amount      numeric NOT NULL,
  status      text NOT NULL DEFAULT 'scheduled',
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS collection_plan_instalments_plan_seq_uk
  ON collection_plan_instalments (plan_id, seq);
CREATE INDEX IF NOT EXISTS collection_plan_instalments_case_idx
  ON collection_plan_instalments (case_id, due_date);
-- The overdue sweep: scheduled instalments whose due date has passed.
CREATE INDEX IF NOT EXISTS collection_plan_instalments_due_idx
  ON collection_plan_instalments (status, due_date);
