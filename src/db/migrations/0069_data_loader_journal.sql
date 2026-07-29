-- Data Loader journal and tier-1 trigger set.
--
-- Hand-written because drizzle-kit generation is currently blocked by the repository's known
-- 0022/0023 snapshot-parent collision. This remains a committed migration (never drizzle push).

CREATE TABLE IF NOT EXISTS "bulk_change_log" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "audience" text,
  "batch_id" text NOT NULL,
  "table_name" text NOT NULL,
  "row_pk" text NOT NULL,
  "op" text NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "db_user" text NOT NULL,
  "reverted_at" timestamp with time zone,
  "reverted_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bulk_change_log_op_check" CHECK ("op" IN ('insert', 'update', 'delete'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_change_log_batch_idx"
  ON "bulk_change_log" ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_change_log_table_row_idx"
  ON "bulk_change_log" ("table_name", "row_pk");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_change_log_created_idx"
  ON "bulk_change_log" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_change_log_tenant_batch_idx"
  ON "bulk_change_log" ("tenant_id", "batch_id");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.log_bulk_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_op text;
  v_tenant_id text;
  v_audience text;
  v_batch_id text;
  v_row_pk text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_op := 'insert';
    v_before := NULL;
    v_after := to_jsonb(NEW);
    v_row := v_after;
  ELSIF TG_OP = 'UPDATE' THEN
    v_op := 'update';
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_row := v_after;
  ELSE
    v_op := 'delete';
    v_before := to_jsonb(OLD);
    v_after := NULL;
    v_row := v_before;
  END IF;

  v_tenant_id := NULLIF(v_row ->> 'tenant_id', '');
  v_audience := NULLIF(v_row ->> 'audience', '');
  v_row_pk := NULLIF(v_row ->> 'id', '');

  -- client_news_reads inherits tenancy through its parent post; the row itself predates tenant_id.
  IF v_tenant_id IS NULL AND TG_TABLE_NAME = 'client_news_reads' THEN
    SELECT news."tenant_id"
      INTO v_tenant_id
      FROM public.client_news AS news
     WHERE news."id" = v_row ->> 'news_id';
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Data Loader journal could not resolve tenant for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  IF v_row_pk IS NULL THEN
    RAISE EXCEPTION 'Data Loader journal could not resolve primary key for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  v_batch_id := NULLIF(current_setting('mytrion.batch_id', true), '');
  IF v_batch_id IS NULL THEN
    -- NocoDB cannot set a transaction GUC. Group its statements honestly by DB user, table, and
    -- UTC minute; application reverts set an explicit `revert:*` batch through the repo.
    v_batch_id := format(
      'auto:%s:%s:%s',
      session_user,
      TG_TABLE_NAME,
      to_char(date_trunc('minute', statement_timestamp()) AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI')
    );
  END IF;

  INSERT INTO public.bulk_change_log (
    id,
    tenant_id,
    audience,
    batch_id,
    table_name,
    row_pk,
    op,
    before,
    after,
    db_user
  )
  VALUES (
    'bcl_' || replace(gen_random_uuid()::text, '-', ''),
    v_tenant_id,
    v_audience,
    v_batch_id,
    TG_TABLE_NAME,
    v_row_pk,
    v_op,
    v_before,
    v_after,
    session_user
  );

  -- AFTER-trigger return values are ignored.
  RETURN NULL;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.log_bulk_change() FROM PUBLIC;
--> statement-breakpoint

DROP TRIGGER IF EXISTS data_loader_journal_client_news ON public.client_news;
--> statement-breakpoint
CREATE TRIGGER data_loader_journal_client_news
AFTER INSERT OR UPDATE OR DELETE ON public.client_news
FOR EACH ROW EXECUTE FUNCTION public.log_bulk_change();
--> statement-breakpoint

DROP TRIGGER IF EXISTS data_loader_journal_client_news_reads ON public.client_news_reads;
--> statement-breakpoint
CREATE TRIGGER data_loader_journal_client_news_reads
AFTER INSERT OR UPDATE OR DELETE ON public.client_news_reads
FOR EACH ROW EXECUTE FUNCTION public.log_bulk_change();
--> statement-breakpoint

DROP TRIGGER IF EXISTS data_loader_journal_scope_risk_items ON public.scope_risk_items;
--> statement-breakpoint
CREATE TRIGGER data_loader_journal_scope_risk_items
AFTER INSERT OR UPDATE OR DELETE ON public.scope_risk_items
FOR EACH ROW EXECUTE FUNCTION public.log_bulk_change();
--> statement-breakpoint

DROP TRIGGER IF EXISTS data_loader_journal_mytrion_calls ON public.mytrion_calls;
--> statement-breakpoint
CREATE TRIGGER data_loader_journal_mytrion_calls
AFTER INSERT OR UPDATE OR DELETE ON public.mytrion_calls
FOR EACH ROW EXECUTE FUNCTION public.log_bulk_change();
