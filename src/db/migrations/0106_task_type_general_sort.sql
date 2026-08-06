-- Manager Tasks: put `general` back at the top of every desk's type picker.
--
-- 0104 seeded the catalog with `ON CONFLICT (tenant_id, code) DO NOTHING`, which is right — it must
-- not clobber a label an admin has edited. But `general` already existed from 0061, so the conflict
-- clause skipped it entirely and it kept the column default `sort_order = 100`. Result: the single
-- most-reached-for type sorted BELOW every type 0104 introduced, at the bottom of all seven pickers.
--
-- Targeted rather than a blanket re-seed: this touches exactly the rows 0104 could not, and only the
-- two columns 0104 owns. A label or `active` flag someone has since changed stays changed.

UPDATE "mytrion_task_types"
   SET "sort_order" = 10,
       "department" = NULL,
       "updated_at" = now()
 WHERE "tenant_id" = 'octane'
   AND "code" = 'general'
   AND "sort_order" = 100;
