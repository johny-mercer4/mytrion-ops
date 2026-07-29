\set ON_ERROR_STOP on

/*
 * Restricted NocoDB writer for the Mytrion Admin Data Loader.
 *
 * SAFETY INVARIANT: never add a table grant here without attaching public.log_bulk_change() to the
 * same table in the matching migration. tests/unit/data-loader-allowlist.test.ts asserts that the
 * TypeScript allowlist, these grants, and the trigger set remain identical.
 *
 * Run once per environment after migrations:
 *   psql "$MYTRION_OPS_DATABASE_URL" \
 *     -v loader_password="$NOCODB_LOADER_PASSWORD" \
 *     -v loader_tenant_id="$NOCODB_LOADER_TENANT_ID" \
 *     -f scripts/nocodb-role.sql
 *
 * Re-verify after EVERY grant change by connecting as mytrion_loader:
 *   [ ] SELECT/INSERT/UPDATE/DELETE work only on the four tier-1 tables.
 *   [ ] Cross-tenant SELECT, INSERT, UPDATE, and DELETE return no rows / fail RLS checks.
 *   [ ] CREATE TABLE and ALTER TABLE fail.
 *   [ ] SELECT on public.audit_log fails.
 *   [ ] SELECT on pgboss.job fails.
 *   [ ] UPDATE and DELETE on public.bulk_change_log fail.
 *
 * This script deliberately grants no DDL and no default privileges. NocoDB schema editing must
 * remain disabled; all schema changes continue through committed Drizzle migrations.
 */

\if :{?loader_password}
\else
  \echo 'Missing required psql variable: loader_password'
  \quit 3
\endif

\if :{?loader_tenant_id}
\else
  \echo 'Missing required psql variable: loader_tenant_id'
  \quit 3
\endif

SELECT 'CREATE ROLE mytrion_loader LOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mytrion_loader')
\gexec

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'mytrion_loader'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'mytrion_loader has forbidden privileged attributes; remove them as a database superuser';
  END IF;
END
$block$;

-- NOSUPERUSER/NOREPLICATION/NOBYPASSRLS are verified above. Repeating those attributes in ALTER
-- ROLE would itself require a superuser even when setting them to false.
ALTER ROLE mytrion_loader LOGIN NOCREATEDB NOCREATEROLE NOINHERIT;
SELECT format('ALTER ROLE mytrion_loader PASSWORD %L', :'loader_password')
\gexec

-- Start from no access on every rerun, then restore only the reviewed tier-1 surface.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM mytrion_loader;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM mytrion_loader;
REVOKE CREATE ON SCHEMA public FROM mytrion_loader;
GRANT USAGE ON SCHEMA public TO mytrion_loader;
SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM mytrion_loader', current_database())
\gexec
SELECT format('REVOKE ALL ON SCHEMA %I FROM mytrion_loader', nspname)
FROM pg_namespace
WHERE nspname IN ('pgboss', 'drizzle', 'langgraph')
\gexec

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.client_news TO mytrion_loader;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.client_news_reads TO mytrion_loader;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scope_risk_items TO mytrion_loader;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mytrion_calls TO mytrion_loader;

-- Metadata-only discovery for NocoDB's ERD. REFERENCES makes public tables visible through
-- information_schema without granting SELECT or any row access. With CREATE revoked everywhere,
-- the loader cannot use this privilege to add foreign keys or mutate schema.
GRANT REFERENCES ON ALL TABLES IN SCHEMA public TO mytrion_loader;

-- The trigger function is SECURITY DEFINER, but append-only INSERT is retained as an explicit
-- capability from the approved handoff. The loader can neither read nor rewrite journal history.
GRANT INSERT ON TABLE public.bulk_change_log TO mytrion_loader;

-- Native Postgres RLS restores the tenant boundary that a direct external writer would otherwise
-- bypass. The tenant literal is baked into each policy; the loader cannot widen it with SET.
ALTER TABLE public.bulk_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mytrion_loader_append ON public.bulk_change_log;
SELECT format(
  'CREATE POLICY mytrion_loader_append ON public.bulk_change_log FOR INSERT TO mytrion_loader WITH CHECK (tenant_id = %L)',
  :'loader_tenant_id'
)
\gexec

ALTER TABLE public.client_news ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mytrion_loader_tenant ON public.client_news;
SELECT format(
  'CREATE POLICY mytrion_loader_tenant ON public.client_news TO mytrion_loader USING (tenant_id = %L) WITH CHECK (tenant_id = %L)',
  :'loader_tenant_id',
  :'loader_tenant_id'
)
\gexec

ALTER TABLE public.scope_risk_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mytrion_loader_tenant ON public.scope_risk_items;
SELECT format(
  'CREATE POLICY mytrion_loader_tenant ON public.scope_risk_items TO mytrion_loader USING (tenant_id = %L) WITH CHECK (tenant_id = %L)',
  :'loader_tenant_id',
  :'loader_tenant_id'
)
\gexec

ALTER TABLE public.mytrion_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mytrion_loader_tenant ON public.mytrion_calls;
SELECT format(
  'CREATE POLICY mytrion_loader_tenant ON public.mytrion_calls TO mytrion_loader USING (tenant_id = %L) WITH CHECK (tenant_id = %L)',
  :'loader_tenant_id',
  :'loader_tenant_id'
)
\gexec

ALTER TABLE public.client_news_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mytrion_loader_tenant ON public.client_news_reads;
SELECT format(
  'CREATE POLICY mytrion_loader_tenant ON public.client_news_reads TO mytrion_loader USING (EXISTS (SELECT 1 FROM public.client_news AS news WHERE news.id = client_news_reads.news_id AND news.tenant_id = %L)) WITH CHECK (EXISTS (SELECT 1 FROM public.client_news AS news WHERE news.id = client_news_reads.news_id AND news.tenant_id = %L))',
  :'loader_tenant_id',
  :'loader_tenant_id'
)
\gexec

-- Fail closed if an inherited PUBLIC grant would silently widen the role beyond this script.
DO $block$
DECLARE
  leaked_tables text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
    INTO leaked_tables
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename NOT IN (
       'bulk_change_log',
       'client_news',
       'client_news_reads',
       'scope_risk_items',
       'mytrion_calls'
     )
     AND (
       has_table_privilege('mytrion_loader', format('%I.%I', schemaname, tablename), 'SELECT')
       OR has_table_privilege('mytrion_loader', format('%I.%I', schemaname, tablename), 'INSERT')
       OR has_table_privilege('mytrion_loader', format('%I.%I', schemaname, tablename), 'UPDATE')
       OR has_table_privilege('mytrion_loader', format('%I.%I', schemaname, tablename), 'DELETE')
     );

  IF leaked_tables IS NOT NULL THEN
    RAISE EXCEPTION 'mytrion_loader inherited privileges on forbidden tables: %', leaked_tables;
  END IF;

  IF has_table_privilege('mytrion_loader', 'public.bulk_change_log', 'SELECT')
     OR has_table_privilege('mytrion_loader', 'public.bulk_change_log', 'UPDATE')
     OR has_table_privilege('mytrion_loader', 'public.bulk_change_log', 'DELETE') THEN
    RAISE EXCEPTION 'mytrion_loader journal access is broader than append-only INSERT';
  END IF;
END
$block$;
