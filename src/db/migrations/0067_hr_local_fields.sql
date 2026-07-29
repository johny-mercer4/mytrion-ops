-- HR's own fields, owned by us rather than mirrored from Zoho People — part of migrating off it.
--
-- Nothing is DROPPED here on purpose. `hr_departments.mail_alias` and both tables' `source` stay: the
-- request to "remove the Source column" and "remove the mail alias" is about the UI, and while the
-- migration off Zoho People is still in flight `source` is the only marker distinguishing a row that is
-- already ours from one the sync still owns. Dropping a column is irreversible; hiding it is not.

ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "telegram_username" text;
--> statement-breakpoint
-- Our own re-hosted avatar (file_assets.id). Zoho's photo_url is OAuth-gated, so a browser <img> on it
-- 401s — that is the broken-image bug, and no frontend change can fix it.
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "photo_file_id" text;
--> statement-breakpoint
-- Plain index, deliberately NOT unique: a duplicate handle is a data-quality question for HR, not a
-- reason to reject a save.
CREATE INDEX IF NOT EXISTS "hr_employees_tenant_telegram_idx"
  ON "hr_employees" ("tenant_id","telegram_username");
--> statement-breakpoint

ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
-- An allow-listed lucide-react component NAME (e.g. 'Building2'), never raw SVG markup.
ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "icon" text;
--> statement-breakpoint
-- A Horizon tone token name (e.g. 'tone-sky'), not a raw hex, so departments stay on-palette.
ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "icon_color" text;
--> statement-breakpoint
-- Org-canvas position once a user drags a node. Null = let the auto-layout place it.
ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "canvas_x" integer;
--> statement-breakpoint
ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "canvas_y" integer;
