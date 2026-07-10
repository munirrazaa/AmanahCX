-- 048_restricted_app_role.sql
-- Records the database-login security fix applied 2026-07-10:
-- the app now connects as a non-superuser role (crm_app) instead of the
-- `postgres` superuser, so Row-Level Security tenant-isolation policies
-- are actually enforced (superuser/BYPASSRLS roles ignore RLS entirely).
--
-- This migration is idempotent — safe to run whether or not the role
-- and grants already exist (they were applied manually in production
-- before this migration file existed).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO crm_app;
GRANT CREATE ON SCHEMA public TO crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO crm_app;

-- Materialized views and the team_messages table need REFRESH/CREATE INDEX
-- privileges, which in Postgres require ownership rather than a GRANT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'mv_daily_deal_stats') THEN
    ALTER MATERIALIZED VIEW mv_daily_deal_stats OWNER TO crm_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'mv_contact_source_stats') THEN
    ALTER MATERIALIZED VIEW mv_contact_source_stats OWNER TO crm_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'mv_daily_activity_stats') THEN
    ALTER MATERIALIZED VIEW mv_daily_activity_stats OWNER TO crm_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'mv_daily_ticket_stats') THEN
    ALTER MATERIALIZED VIEW mv_daily_ticket_stats OWNER TO crm_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'team_messages') THEN
    ALTER TABLE team_messages OWNER TO crm_app;
  END IF;
END
$$;
