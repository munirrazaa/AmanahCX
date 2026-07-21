# DATABASE CHANGE LOG
_Most recent at top. Tracks structural and security-relevant changes to the live database — separate from application code changes, since these affect production data directly and are not always captured by a code deploy._

---

## 2026-07-21 — Monorepo TypeScript build fix (no schema change)

- **No database impact.** Pure application/build-config change — `tsconfig.json` additions/fixes and a handful
  of TypeScript-level bug fixes (wrong field references, event-argument order) across `packages/api`,
  `packages/core`, `packages/shared`, and all 11 `modules/*` packages. No migrations, no schema changes, no
  data touched. See `CHANGE_LOG.md` (2026-07-21) and `Desktop/AmanahCX/Bugs/AmanahCX-Bug-Report.html` for detail.

---

## 2026-07-20 (2) — Haier Electronics voice_bot_configs.system_prompt re-populated (no schema change)

- **Data only, no schema change.** `voice_bot_configs.system_prompt` for Haier Electronics was empty despite
  `source_template_id` already pointing at the "Electronics Retail Support & Sales" template — re-invoked the
  existing template-assignment logic (`POST /agent-templates/:id/assign`) to properly populate it. Confirmed
  correct via a direct query afterward.
- Companion code fix (not a DB change): removed a hardcoded fallback that had been serving a real client's
  (HBL Microfinance Bank) confidential script to any tenant with an empty `system_prompt` — this affected all
  8 tenants, not just Haier. See `docs/CHANGE_LOG.md` 2026-07-20 (Push 2) for full detail.

---

## 2026-07-20 — Sector custom fields backfilled + full dept/queue test data (no schema change)

- **No new migration** — `custom_field_definitions` already existed. 183 missing rows inserted across 7 tenants by re-running the existing sector-seeding logic against each tenant's current sector config (`ON CONFLICT DO NOTHING`, idempotent). Only Haier Electronics previously had its full sector field set; the sector config had been expanded since the other 7 tenants were created and nothing had ever backfilled them.
- **Data only, no schema change:** created Sales/Support/Complaints + Field Sales `users` rows (manager+agent each) across the 6 single-admin demo tenants and Haier's missing departments, wired into `queue_members` for their department's `ticket_queues` row. Reset `password_hash` for all 75 users tenant-wide.
- Live-verified via real ticket creation + accept flow across all 8 tenants — see `docs/CHANGE_LOG.md` 2026-07-20.

---

## 2026-07-17 (4) — users.tenant_id nullable + platform-email uniqueness (migration 071)

- **Column constraint change.** `ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL`. The one `super_admin` account was previously a row inside the `demo` tenant, requiring a workspace slug as a login workaround despite being a platform-level role by design (blocked from every tenant-scoped route already). Its `tenant_id` is now `NULL`, making it a real platform account.
- **New index.** `CREATE UNIQUE INDEX users_platform_email_uniq ON users(email) WHERE tenant_id IS NULL` — standard SQL treats each `NULL` as distinct, so the existing `UNIQUE(tenant_id, email)` no longer guards against duplicate platform-admin emails once `tenant_id` can be `NULL`; this partial index restores that guarantee for tenantless users.
- Confirmed safe before applying: exactly 1 `super_admin` row existed; the `demo` tenant's other 8 operational users were untouched.

## 2026-07-17 (3) — voice_bot_quotas.cost_per_minute (migration 070)

- **New column.** `ALTER TABLE voice_bot_quotas ADD COLUMN cost_per_minute NUMERIC(10,4) NOT NULL DEFAULT 0`. Backs the new Super Admin monthly voice-bot cost report — cost is computed live from `voice_bot_calls.duration_seconds × cost_per_minute`, never stored as a running total, matching the same pattern migration 059 established for minutes. Applied via the `postgres` connection; no ownership transfer needed since `voice_bot_quotas` was already owned by `postgres` with `crm_app` holding table-level grants from when it was originally created (confirmed the app's own runtime connection can read/write the new column without any GRANT changes).

## 2026-07-17 (2) — users.notification_preferences (migration 069)

- **New column.** `ALTER TABLE users ADD COLUMN notification_preferences JSONB NOT NULL DEFAULT '{}'`. Backs the two Notification-preference screens (Settings → Notifications, My Settings → Notifications), which previously had nowhere to save to — the Save button had no backend at all. Both screens write under their own top-level JSON key; the `PATCH` endpoint merges rather than replaces, so they don't clobber each other.

## 2026-07-17 (1) — platform_invoices + platform_payments (migration 068)

- **New tables, no ALTERs.** Backs Super Admin's own Billing tab (`/super-admin/platform-invoices` route), which has existed in code but had no table to write to — every request 500'd (`relation "platform_invoices" does not exist`). `platform_invoices` (one row per invoice AmanahCX sends a tenant), `platform_payments` (payments recorded against those invoices). RLS enabled, bypass-only policy (`current_setting('app.bypass_rls') = 'on'`) — this data has no tenant-scoped read path at all, only Super Admin's own routes ever touch it. Applied via the `postgres` superuser connection, ownership transferred to `crm_app` immediately after (per the established rule for tables created outside the app's own migration runner). Live-verified: created and deleted a real test invoice through the UI.

---

## 2026-07-13 (5) — voice_bot_configs: sip_trunk_username/password/nickname/outbound_transport (migration 060)

- `ALTER TABLE` adding 4 columns to match the standard SIP-connect dialog field set. Applied
  manually with the admin connection string (Railway's `crm_app` role can't `ALTER` a table
  it doesn't own) and recorded in `_migrations` before push, per the established rule.
- `sip_trunk_password` is stored the same way the existing `webhookSecret` connector field
  already is in this codebase (plain column, no separate encryption-at-rest) — consistent
  with current practice, not a new risk profile.

---

## 2026-07-13 (4) — voice_bot_quotas + voice_bot_minute_topups (migration 059)

- **New tables, no ALTERs.** `voice_bot_quotas` — one row per tenant, `minutes_allocated`
  (cumulative total ever granted). `voice_bot_minute_topups` — append-only audit history of
  every top-up (tenant, minutes added, note, who, when). Consumed minutes are deliberately
  NOT stored here — always computed live as `SUM(duration_seconds)/60` from `voice_bot_calls`,
  the existing single source of truth, avoiding any running-total drift.
- Applied manually with the admin connection (FK to `tenants` needs the owning role) and
  recorded in `_migrations`; `crm_app` granted SELECT/INSERT/UPDATE/DELETE on both tables.

---

## 2026-07-13 (3) — voice_bot_voices + voice_bot_custom_intents (migration 058)

- **New tables, no ALTERs** — `voice_bot_voices` (shared voice catalog, seeded with the 2
  existing Uplift voices) and `voice_bot_custom_intents` (per-tenant custom "answer, don't
  create a ticket" reasons, RLS-scoped by tenant). Applied via `npm run db:migrate` initially
  failed with `permission denied for table tenants` (FK reference needs the admin role), so
  applied manually with the admin connection string, recorded in `_migrations`, then granted
  `crm_app` SELECT/INSERT/UPDATE/DELETE on both new tables so the restricted role can use them
  at runtime.
- **Also fixed same day:** `TENANT_ADMIN_BLOCKED_PREFIXES` in `packages/api/src/server.ts` was
  silently blocking tenant admins from the ENTIRE `/api/v1/voice-bot` prefix (a leftover from
  before the Voice Bot admin screen was built for them) — discovered while testing the new
  endpoints, when even the pre-existing `GET /config` 403'd for a tenant admin despite the
  route itself explicitly permitting that role. Fixed by excluding `/api/v1/voice-bot` from
  the wall (every route in that file already gates itself correctly per-route). A second bug
  in the same fix: `/api/v1/voice-bot` also matched the separate, unrelated `/api/v1/voice`
  block by prefix (`startsWith`) — added an explicit early exemption so the two don't collide.

---

## 2026-07-13 (2) — voice_bot_configs.bot_name (migration 050) + Haier passwords restored + 049/050 applied to live DB

- **Migration 049 APPLIED to Supabase** (it was pending in the morning entry below): applied
  manually with the admin (postgres) connection and recorded in `_migrations`, after Railway's
  auto-migration failed the 05:07 deploy — the app's restricted `crm_app` role cannot ALTER
  tables it doesn't own. **Process rule going forward:** ALTER-ing migrations must be applied
  manually + recorded BEFORE pushing, or the deploy fails its healthcheck.
- **Migration 050 applied + recorded** the same way: `voice_bot_configs.bot_name TEXT NOT NULL
  DEFAULT 'Nadia'` — per-tenant display name for the self-hosted voice bot, editable from the
  new Voice Bot admin screen.
- **Passwords restored for the 5 `haier-electronics` users** (admin@…, sarah.manager@…,
  mike.linemanager@…, amir.agent@…, zoya.agent@…) to the owner's documented values — the
  2026-07-12 all-users diagnostic reset had orphaned them, which turned out to be why the
  owner "couldn't log in since yesterday". Verified with a real login against production.

---

## 2026-07-13 — voice_bot_configs: LiveKit agent columns + sip_uri/ivr_menu bug fix (migration 049)

### What changed
`ALTER TABLE voice_bot_configs` (all idempotent `ADD COLUMN IF NOT EXISTS`):
- `sip_uri TEXT`, `ivr_menu JSONB` — these were already referenced by `PUT /config` in
  `voice-bot.ts` but no migration had ever created them; every save of those two fields has
  been failing with "column does not exist" since they were added to the route.
- New LiveKit-specific columns: `tone`, `speaking_rate`, `stt_provider`, `stt_language_hint`,
  `tts_provider`, `llm_model`, `interruption_sensitivity`, `max_call_duration_sec`,
  `end_call_phrases`, `sip_trunk_provider`, `sip_trunk_number` — config knobs for the new
  self-hosted "Nadia" LiveKit voice agent (see `CHANGE_LOG.md` 2026-07-13), equivalent to what
  Retell AI/Vapi's own dashboards expose for a hosted agent.

### Why
The self-hosted LiveKit agent has no vendor dashboard of its own — the CRM's Voice Bot Config
screen has to be that dashboard, so it needs columns for the settings a hosted platform would
otherwise store on their side.

### Filename-numbering note (resolves the ambiguity flagged in the 2026-07-12 entry below)
Checked `_migrations` directly before writing this: no row for `049`, `050`, `051`, or `052`
exists in the live database — filename `049_livekit_agent_config.sql` does not collide with
anything already applied. The gap between `048` and `053` in the live history is unexplained
by this session but confirmed harmless for this migration.

### Verification
**Not yet applied** — file exists at
`packages/core/src/database/migrations/049_livekit_agent_config.sql`, `npm run db:migrate`
has not been run against Supabase yet. Do that before relying on the new columns; the
migration is purely additive so it's safe to run at any time.

---

## 2026-07-12 — No structural database changes

- Application-code-only push (quick-capture validation, mobile UX fixes). Password reset on non-protected test user field.officer@demo.com (rotated by a parallel session, reset to documented test value).

---

## 2026-07-12 — New table: contact_channel_consent (migration 053)

### What changed
New append-only table `contact_channel_consent` for per-channel communication consent:
`id, tenant_id (FK tenants), contact_id (FK contacts), channel (whatsapp|sms|email),
opted_in (bool), source (manual|reply|form|import|api), consented_at, recorded_by (FK users,
SET NULL on delete), notes`. Two indexes for latest-state and history lookups. RLS enabled
with the standard `tenant_isolation` policy (`app.tenant_id` GUC or `app.bypass_rls`).

### Why
Meta's WhatsApp Business API requires provable customer opt-in before business-initiated
messages (account-suspension risk). Rows are never updated or deleted by the application —
every opt-in/opt-out is a new row, preserving the compliance audit trail.

### Verification
Applied via Supabase migration `053_contact_channel_consent` and live-tested the same day:
insert/read through the API under a tenant-scoped connection works; a different tenant's
manager receives an empty result for the same contact (RLS isolation confirmed); mirrored in
repo at `packages/core/src/database/migrations/053_contact_channel_consent.sql`.

Note: migration numbering — the repo also contains an unrelated, not-yet-committed
`049_livekit_agent_config.sql` in the AmanahCX working tree (separate voice-agent work, not
part of this change); crm-platform's local sequence runs 049–052 with different content.
The Supabase migration history is the authoritative record of what is applied to the live DB.

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

## 2026-07-18 — Voice Bot: minute thresholds, concurrency, human handoff, agent templates

### What changed
- `064_voice_bot_minutes_thresholds.sql` — adds `voice_bot_quotas.notified_70/90/100` (BOOLEAN,
  tracks whether a tenant has already been notified at each usage threshold for the current
  allocation cycle, reset on top-up) and a new `platform_notifications` table (not tenant-scoped —
  Super Admin has no tenant context — for platform-level alert delivery).
- `065_voice_bot_concurrency.sql` — adds `voice_bot_configs.max_concurrent_calls` (per-tenant
  concurrent-call cap) and a new `active_voice_calls` table (tenant_id, call_id, started_at) used
  to enforce both the per-tenant cap and a VPS-wide global cap in real time. Not tenant-RLS-scoped
  (Super Admin and the concurrency check both need a cross-tenant view).
- `066_voice_bot_human_transfer.sql` — adds `voice_bot_configs.human_transfer_destination` (SIP
  URI/number Nadia hands a call to when she can't take it herself). NULL by default — live
  transfer only activates once a real destination is confirmed and configured.
- `072_voice_bot_agent_templates.sql` — new `voice_bot_agent_templates` table (reusable agent
  "recipes": name, sector, company name, department, tone, character, language, guardrails, voice,
  call direction, bot engine). Adds `voice_bot_configs.source_template_id` (provenance — which
  template a tenant's config was last assigned from; not a live binding).

### Why
Together these cover the two ways a call can fail to be served (minutes exhausted, too many calls
at once), what Nadia does about it (ticket + attempted live transfer instead of just a dead end),
and the tooling (Agent Builder) to configure a bot without hand-editing `voice_bot_configs`
directly. See `docs/CHANGE_LOG.md` 2026-07-18 entries for full feature description and live-test
evidence.

### Impact
None on existing data — all four are additive, nullable/defaulted columns and new tables.
Existing tenants' voice bot behaviour is unchanged until minutes are allocated, a concurrency cap
or transfer destination is explicitly set, or a template is explicitly assigned.

---

## 2026-07-18 — Sub-Admin Roles enforcement (no schema change)

### What changed
No new migration — `platform_roles` and `users.platform_role_id` already existed
(`014_platform_roles.sql`). This was an application-layer fix: the JWT issued at login now
carries `platformRoleId` and `platformPermissions` (read from `platform_roles.permissions` via a
`LEFT JOIN` added to both login queries in `auth.ts`), and every `/super-admin/*` route now checks
that permission map before allowing the request through.

### Why
`platform_role_id`/`platform_roles.permissions` were being written and read for display, but never
checked before authorizing an action — see `docs/CHANGE_LOG.md` 2026-07-18 entry for the full
security description.

### Impact
None on existing data. Existing sub-admin accounts (`role = 'platform_admin'`) that were
previously locked out of `/super-admin/*` entirely (base role check didn't allow `platform_admin`)
can now log in and use exactly what their assigned role's matrix grants.

---

## Earlier migrations (001–047)

See `packages/core/src/database/migrations/` for the full ordered list. Notable structural
migrations: `012_line_manager` (manager_id / reporting hierarchy), `018_departments_and_opportunities`,
`023_tenant_entitlements`, `024_ticket_deal_link`, `025_default_departments`, `030_sla_enhancements`,
`033_sla_pause` (business hour profiles), `044_voice_bot_self_service`, `045_quotations`,
`046_dept_type_nullable`, `047_sla_time_unit`. Each is idempotent and safe to re-run.
