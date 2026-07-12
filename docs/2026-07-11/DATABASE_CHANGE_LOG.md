# DATABASE CHANGE LOG
_Most recent at top. Tracks structural and security-relevant changes to the live database — separate from application code changes, since these affect production data directly and are not always captured by a code deploy._

---

## 2026-07-11 — Attachments table + field-officer test account (cloud DB)

- **`attachments` table** (lazy-created by the API on boot if missing): id, tenant_id, entity_type, entity_id, filename, mime_type, size_bytes, storage_key, uploaded_by, created_at + index on (tenant_id, entity_type, entity_id). Stores photos/files attached to deals/contacts/tickets from the mobile app. Files themselves live in the file-storage backend (local dir in dev; S3-compatible in production).
- **Test user `field.officer@demo.com`** (role agent, dept Sales, reports to sales line manager) inserted directly into the Supabase cloud DB for mobile field testing — not one of the locked demo accounts. Password documented in session notes only.
- **Seeded test data:** contact "Kamran Siddiqui" + 3 field activities assigned to the field officer (demo tenant). Activity `metadata` now carries `checkins[]` (GPS arrivals) and `completedLocation` (GPS at completion) written by the new check-in/complete endpoints.

---

## 2026-07-10 — Critical: Restricted the app's database login (tenant isolation fix)

### What changed
The application's database connection was switched from the `postgres` superuser role to a
restricted, non-superuser role (`crm_app`).

### Why
Row-Level Security (RLS) policies enforcing tenant data isolation were present and correctly
written in the database, but were being silently ignored. In Postgres, any role with `SUPERUSER`
or `BYPASSRLS` ignores RLS policies entirely, even ones created with `FORCE ROW LEVEL SECURITY`.
The app's connection (`postgres`) had `rolbypassrls = true`. This meant tenant isolation was not
actually enforced at the database layer in production — verified directly: querying
`ticket_queues` with the tenant context correctly set still returned a different tenant's row.

This was discovered while testing ticket creation for a new tenant: its tickets were being
auto-assigned to another tenant's default queue, because the "pick the default queue" query
wasn't (and didn't need to be, under normal RLS) filtered by tenant — RLS was supposed to do
that filtering automatically and wasn't.

### What was done
1. Confirmed `crm_app` already existed as a properly-configured role (`NOSUPERUSER`,
   `NOBYPASSRLS`, `LOGIN`) with grants on all 59 tables at the time — likely provisioned in an
   earlier session but never actually connected to the running app.
2. Reset its password and granted:
   - `USAGE`, `CREATE` on schema `public`
   - `SELECT, INSERT, UPDATE, DELETE` on all tables (existing + future, via `ALTER DEFAULT PRIVILEGES`)
   - `USAGE, SELECT` on all sequences (existing + future)
3. Transferred ownership of the 4 analytics materialized views (`mv_daily_deal_stats`,
   `mv_daily_ticket_stats`, `mv_contact_source_stats`, `mv_daily_activity_stats`) and the
   `team_messages` table to `crm_app` — Postgres requires actual ownership (not just a grant) to
   run `REFRESH MATERIALIZED VIEW` or `CREATE INDEX` on an existing object.
   - `team_messages` has RLS disabled entirely (`relrowsecurity = false`), so this ownership
     transfer does not affect its isolation posture either way.
4. Updated `DATABASE_URL` in both the local dev environment and the live Railway production
   environment to connect as `crm_app` (via the Supabase connection pooler, matching the exact
   host/port pattern already in use, with the pooler's required `crm_app.<project-ref>` username
   format).
5. Recorded the change as a proper, idempotent migration: `048_restricted_app_role.sql`
   (in `packages/core/src/database/migrations/`), and inserted a matching row into `_migrations`
   with today's date, since the underlying change had already been applied manually before the
   migration file existed.

### Verification
- **Before fix:** direct query (tenant context correctly set to Tenant A) for
  `SELECT id FROM ticket_queues WHERE is_default = true LIMIT 1` returned Tenant B's queue.
- **After fix:** the identical query, run as `crm_app`, correctly returned zero rows for a
  tenant with no queues of its own.
- **Live app confirmation:** re-tested the actual ticket-claim workflow end-to-end against the
  live production Railway deployment (not a local copy) after switching its `DATABASE_URL` —
  confirmed working correctly (an agent could claim a ticket that was previously blocked by the
  cross-tenant leak).
- Normal reads/writes re-verified unaffected: a tenant's own tickets and contacts are still
  fully visible and editable under the new role.

### Rollback note
If this ever needs to be reverted (it should not be), the old `DATABASE_URL` pointed at the
`postgres` role. Reverting would immediately reopen the tenant-isolation gap described above —
do not revert without a replacement fix in place first.

---

## 2026-07-10 — Housekeeping: migration file duplicates removed

### What changed
Removed 3 duplicate migration files, confirmed byte-for-byte identical to their originals via `diff`:
- `023_tenant_entitlements 2.sql` (duplicate of `023_tenant_entitlements.sql`)
- `024_ticket_deal_link 2.sql` (duplicate of `024_ticket_deal_link.sql`)
- `025_default_departments 2.sql` (duplicate of `025_default_departments.sql`)

### Why
Cosmetic clutter only — both the tracked `_migrations` table and the actual live schema already
agreed with each other (47/47 match, contrary to an outdated note from an earlier session
suggesting drift existed — that drift had already been separately resolved before this check).

### Impact
None. No schema change. The non-duplicate originals were already applied and remain applied.

---

## Earlier migrations (001–047)

See `packages/core/src/database/migrations/` for the full ordered list. Notable structural
migrations: `012_line_manager` (manager_id / reporting hierarchy), `018_departments_and_opportunities`,
`023_tenant_entitlements`, `024_ticket_deal_link`, `025_default_departments`, `030_sla_enhancements`,
`033_sla_pause` (business hour profiles), `044_voice_bot_self_service`, `045_quotations`,
`046_dept_type_nullable`, `047_sla_time_unit`. Each is idempotent and safe to re-run.
