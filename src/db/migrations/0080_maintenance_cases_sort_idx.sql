-- Make the Maintenance tab's DEFAULT sort use an index instead of scanning the table.
--
-- `maintenance_cases_case_date_idx` is (case_date, id) ASC, but the list orders by
-- `case_date DESC NULLS LAST, id DESC`. A backward index scan can serve plain DESC — but DESC defaults
-- to NULLS FIRST, so the NULLS LAST clause does not match and Postgres fell back to:
--
--   Limit -> Sort (top-N heapsort) -> Seq Scan on maintenance_cases (rows=2715)
--
-- Only ~3 ms today at 2,715 rows, which is why it was invisible; the cost grows with every row and
-- the sort happens on EVERY page and EVERY search. This index matches the ORDER BY exactly.
--
-- NUMBERED 0080 and stamped ABOVE the target DB's newest applied migration — see the header of
-- 0079_maintenance_cases.sql for why both of those are load-bearing and how to pick them.
--
-- This file is the cautionary tale in that header. As 0077 it collided with main's
-- 0077_support_bot_chat_tenant_scope on BOTH the number and the `when` (1785398400000). Main's copy
-- reached prod first, so prod's ceiling came to EQUAL this entry's stamp — and `<` is strict, so
-- `pnpm db:migrate` reported success and created nothing, for days. The index below was absent from
-- prod the entire time while the journal implied it was there.
--
-- `NULLS LAST` is kept rather than dropped from the query on purpose: exactly one case carries no
-- date today, and a dateless case belongs at the BOTTOM of a newest-first list, not the top.

CREATE INDEX IF NOT EXISTS "maintenance_cases_case_date_desc_idx"
  ON "maintenance_cases" ("case_date" DESC NULLS LAST, "id" DESC);
--> statement-breakpoint

-- The old ascending index is left in place: it still serves the ascending sort and the `case_date`
-- range predicates that the analytics window and the prepay day-bucketing both use.
