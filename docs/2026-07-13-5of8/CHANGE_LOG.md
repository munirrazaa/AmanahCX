# CHANGE LOG
_Most recent at top. Treated as the primary record for development tracking._

---

## Change Log - 2026-07-13 (Push 5 of 5) — Tenant admin can now actually reach the Voice Bot page

### Fixed
**Voice Bot was licensed to the tenant but the tenant admin had no way to open it** —
two gaps: (1) the tenant-admin sidebar had no Voice Bot link at all; (2) the `/voice-bot`
routes were wrapped in the `op()` guard, which REDIRECTS tenant admins to `/admin` — so
even typing the URL bounced them away. The Voice Bot config is administrative work
(name, voice, tone, ticket rules), exactly the tenant admin's job.
- Sidebar: "Voice Bot" link added to the tenant-admin WORKSPACE section, shown only when
  the workspace is licensed for the `voice_bot` module.
- Routes: `op()` removed from `/voice-bot`, `/voice-bot/calls`, `/voice-bot/tickets`
  (the underlying APIs already permit tenant_admin).
- Browser-verified as the Haier admin: link appears → page opens → Self-Hosted card →
  Bot Name / Voice / Tone / Speaking Speed fields all render.

---

## Change Log - 2026-07-13 (Push 4 of 4) — Tenant ⋮ actions menu was rendering off-screen (unusable since day one)

### Fixed
**The per-tenant ⋮ actions dropdown on Super Admin → Tenants never appeared** — measured
live: it rendered at pixel 874 on an 870px viewport. The menu was nested inside its own
full-screen click-away overlay with `top: 100%`, i.e. 100% of the VIEWPORT height — always
just below the screen. Restructured so the overlay and menu are siblings and the menu
anchors to the row's cell; table container switched to `overflow-visible` so the dropdown
isn't clipped. This menu (plan change, Licensed Modules, roles, users, suspend/delete) had
been unusable since it was built.

### Verified end-to-end (browser-driven, local frontend + local API against the live DB)
Logged in as super admin → Tenants → ⋮ on Haier Electronics → Licensed Modules (Ticketing
and Voice Bot now listed, per Push 3) → ticked Voice Bot → Apply. Database confirmed:
`active_modules` gained `voice_bot` AND `entitled_features` gained `voice_bot.calls` +
`voice_bot.config` automatically (Push 3's entitlement-sync working as designed). Haier
Electronics is now properly licensed for Voice Bot through the console flow.

---

## Change Log - 2026-07-13 (Push 3 of 3) — Super admin tenant licensing fixes

### Fixed

**Ticketing and Voice Bot were impossible to license from the Super Admin console** —
the hardcoded module list in `SuperAdmin.tsx` (`ALL_MODULES`) only offered
CRM/Emails/Integrations/Analytics/Sales; the backend catalog had all 7 modules but the UI
checklist never showed the other two. Both added (with a sync-comment pointing at the
backend `MODULE_CATALOG` as the source of truth). This was why "enable Voice Bot for
Haier" couldn't be done through the proper flow.

**Licensing a module didn't grant its feature entitlements** — `PATCH
/super-admin/tenants/:id/modules` updated `active_modules` only, but API routes gate via
`requireEntitlement(feature)` against `entitled_features`. For any tenant with explicit
feature entitlements (all newly created ones), a newly licensed module would appear in
nav but 403 on use. The endpoint now syncs `entitled_features`: drops features of
unlicensed modules, grants the full feature set of newly licensed ones. Legacy tenants
with an empty entitlement list are untouched (middleware allows everything for them).

**Tenants table no longer shows each workspace's Contacts/Deals counts** — a tenant's
business data volume is their own concern, not the platform operator's; only the Users
count remains (owner decision).

### Explicitly NOT changed
Super admin sidebar keeps the full CRM modules (Contacts, Deals, etc.) — the platform
owner's org uses AmanahCX as its own CRM (clarified after a brief misunderstanding; an
initial sidebar-stripping change was reverted before commit).

### Also
- New P2 backlog item: move the super admin OUT of the `demo` workspace to a
  platform-level login with no workspace field (control-plane pattern; deferred by
  joint decision — auth changes deserve a fresh session).
- Super admin password reset to a documented value after the 2026-07-12 all-users reset
  orphaned it (see user's credentials doc; verified against production).

---

## Change Log - 2026-07-13 (Push 2 of 2) — Login "spinner forever" ROOT CAUSE FIXED + Voice Bot admin screen

### Fixed

**Login spinner deadlock — root cause of the long-standing "spinner that never stops" reports (backlog 0c) — FOUND and FIXED**
- Live-diagnosed with the user while their login spun: the production API was healthy and answering probes in <2s the whole time, and the server was actually REJECTING their sign-ins as wrong-password — but the UI showed an infinite spinner instead of the error.
- Root cause in `packages/frontend/src/services/api.ts`: the response interceptor treated EVERY 401 as "expired token" and fired the token-refresh flow. A 401 from `/auth/login` (wrong credentials) triggered a `/auth/refresh` call; that refresh call's own 401 re-entered the interceptor while `isRefreshing` was true and got queued behind itself — a deadlock. The awaiting login promise never settled → spinner forever. The same deadlock fired for any user whose session expired mid-day, silently freezing the app.
- Fix: the interceptor now passes 401s from `/auth/login` and `/auth/refresh` straight through to the caller. Browser-verified both ways: wrong password → "Invalid credentials" shown, button resets; correct password → logs in, lands on the admin dashboard.
- Why the user's password was wrong at all: the 2026-07-12 diagnostic session reset all 73 users' passwords to a test value, orphaning the user's documented credentials. All 5 `haier-electronics` accounts restored to their documented passwords (see DATABASE_CHANGE_LOG).
- Also confirmed during diagnosis (secondary, pre-existing): CORS only allows the canonical `amanahcx.vercel.app` origin — logins attempted from Vercel's per-deployment preview URLs are silently blocked. Left as-is for now (canonical bookmark works); noted in backlog.

### Added

**Voice Bot admin screen (Settings → Voice Bot → "Self-Hosted Voice Bot" card)**
- 4th provider card alongside Vapi/Retell/Bland for the self-hosted LiveKit agent: **Bot Name** (changeable — spoken in the greeting), **Voice** picker (Uplift `helpdesk-agent` / `broadband-support`), **Tone** (empathetic/professional/friendly/formal), **Speaking Speed** slider (0.5×–1.5×), plus the shared greeting/system-prompt/ticket-rule fields.
- Provider-irrelevant UI (webhook URL, third-party API-key warnings, outbound test-call panel) hidden for the self-hosted card.
- Backend: `bot_name` column (migration 050, applied), `botName` accepted by `PUT /voice-bot/config`; the agent (`services/nadia-voice-agent`) now templates `{bot_name}` through its system prompt and greeting, so a rename takes effect on the next call with no restart.
- Number-pronunciation rules refined per user feedback: identifier numbers (CNIC, phone, ticket numbers) spoken digit-by-digit in ENGLISH ("four two three zero one"), abbreviations letter-by-letter ("C-N-I-C"); quantities (money, durations) spoken normally in Urdu.
- Deploy-process note learned the hard way this morning: migrations that ALTER tables must be applied manually with the admin connection + recorded in `_migrations` BEFORE pushing — Railway auto-runs migrations as the restricted `crm_app` role, which cannot alter tables it doesn't own (this failed the 05:07 deploy; fixed by applying 049 manually and redeploying).
- Also fixed in passing: `ivr_menu` TypeScript type in `VoiceBotConfig.tsx` was too narrow (3 pre-existing build errors gone).

---

## Change Log - 2026-07-13 — Nadia: self-hosted LiveKit voice agent (Pakistani-market alternative to Retell/Vapi)

### Added

**New service: `services/nadia-voice-agent/`** — a self-hosted voice bot built on LiveKit
Agents (Python), positioned as a lower-cost alternative to Retell AI/Vapi for Pakistani-market
call volume (their US-market per-minute pricing doesn't work at local scale). Reuses the
existing `provider='livekit'` code path already present in `voice-bot.ts` (webhook ingestion
for Vapi/Retell/Bland was built provider-agnostic from the start — this just adds the
provider itself instead of subscribing to one).

- **STT:** self-hosted Whisper (`faster-whisper`), tuned for Urdu/Roman-Urdu/English
  code-switching ("Minglish"). Custom `stt_node` override drives Silero VAD directly and
  batch-transcribes each utterance — LiveKit's default STT pipeline only wires up a custom
  `stt_node` when a session-level `stt=` object is truthy, which cost real debugging time to
  find (see `agent.py` docstring).
- **TTS:** Uplift AI's official LiveKit plugin (`livekit-plugins-upliftai`), voice
  `helpdesk-agent`. Confirmed via direct API testing (bypassing our pipeline entirely) that
  **Urdu script produces noticeably more natural speech than Roman Urdu transliteration** on
  this voice — so Nadia's spoken output is now always Urdu script, independent of whatever
  mix (Urdu/Roman Urdu/English) the caller uses. Numbers that identify something (CNIC, phone,
  ticket/reference numbers, abbreviations like "CNIC" itself) are spoken as individual English
  digits/letters, phonetically in Urdu script — quantities (money, durations) are spoken
  normally. Speed control implemented as our own ffmpeg time-stretch post-process, since
  Uplift's API has no native rate parameter (confirmed against both their REST and WebSocket
  docs).
- **Conversation content:** HBL Microfinance Bank's complaint-handling flow (categories,
  priority matrix P1-P4, SLA commitments, fraud protocol) adapted from the client's own prior
  Retell AI conversation-flow export into a single system prompt (`src/prompts.py`) — our
  architecture uses one LLM reasoning over a system prompt rather than Retell's node-graph
  state machine, so the flow was flattened rather than ported 1:1.
- Ticket creation calls the CRM's real `/voice-bot/livekit/complaint` endpoint and reads back
  a real, persisted `ticket_number` — deliberately not the original flow's approach of having
  the LLM invent its own reference number as a post-call-analysis field with no guarantee it's
  ever retrievable.
- Manual test harness at `webtest/` (LiveKit token minting + a minimal browser client) for
  talking to the agent directly without depending on LiveKit Cloud's own dashboard console
  (which turned out to be for their separately-hosted "Cloud Agents" product, not for an
  externally-run worker like this one).

### Fixed

**`voice_bot_configs.sip_uri` / `.ivr_menu` — columns referenced by code but never migrated**
(migration `049_livekit_agent_config.sql`). The `PUT /config` route has been inserting into
these two columns since they were added to the Zod schema, but no migration ever created
them — every save of those fields would have failed with "column does not exist". Same
migration adds the new LiveKit-specific config columns (tone, speaking_rate, stt/tts
provider, interruption_sensitivity, sip_trunk_provider/number, etc.) — all idempotent
`ADD COLUMN IF NOT EXISTS`. **Not yet applied to the live database** — filename `049` was
checked against `_migrations` and confirmed unclaimed (see `DATABASE_CHANGE_LOG.md`), but
`npm run db:migrate` hasn't been run yet.

**Ticket-counter/ticket-number collision on the "First National Bank" (`fnb-test`) demo
tenant** — found while live-testing the new voice agent's ticket creation. That tenant had
leftover tickets from 2026-06-09 testing up to `TKT-00005`, but `ticket_counters.next_val`
was reset to a lower value, so every new ticket collided with the unique constraint on
`(tenant_id, ticket_number)` and silently failed (`{"success":false,"error":"ticket_creation_failed"}`,
HTTP 500 — reproduced directly via curl, independent of the voice agent, confirming it's a
data issue rather than an integration bug). Corrected the counter to one past the real max;
live-verified with a real ticket creation immediately after (then deleted, since it was a
synthetic test).

### Telephony (not yet done)
SIP trunk + hosting for this agent is coming from Telecard (Pakistan) — trunk credentials not
received yet. `README.md` in the new service documents the inbound-trunk/dispatch-rule wiring
steps for whenever they arrive.

---

## Change Log - 2026-07-12 (Live phone-test fixes — field capture round 1)

### Context
First live test of the production APK on a real Android phone (field.officer@demo.com). Check-in → remarks → complete verified working with real GPS. Three issues found and fixed:

### Fixed
**1. Lead save rejected in sector workspaces (found: "save failed" on phone)**
- The demo (Banking) workspace requires Customer Type / Account Number / Account Type on every contact — impossible for a walk-in field lead. Quick-capture sources (`card_scan`, `voice`, `mobile`, `field`) are now exempt from sector-required fields; the requirement still applies when the lead is later converted/edited to a full customer. Matches Salesforce/Zoho quick-create behaviour.

**2. Voice capture could get stuck on "listening" with no data**
- The mic button turned red before the phone's recognizer confirmed it started; if the recognizer failed/ended silently, Stop did nothing. Stop now always resets immediately, and a failed start shows a clear "voice unavailable" message instead of hanging.

**3. Card scan missed the person's name and mobile number**
- Scan photo quality raised (0.6 → 0.8) and the AI instructions now explicitly hunt for the stylised name text and classify Pakistani mobile prefixes (03xx / +92 3xx, Cell/Mob/WhatsApp labels) into mobile vs landline.

### Added
- **New Lead + Task buttons on the My Tasks screen** (field officer's landing screen) — previously only reachable via the Dashboard tab.

### Also
- Password for field.officer@demo.com was rotated by a parallel session and reset back; test jobs re-seeded for live phone testing.

---

## Change Log - 2026-07-12 (Push 2 of 2) — Login Investigation + Live Wallboard 500 Errors Fixed

### Investigated

**Daily login failures reported by user ("spinner that never stops")**
- Full architecture test (GitHub → Railway → Vercel → Supabase) run live: created a throwaway account, logged in through the actual deployed Vercel site end-to-end — worked cleanly, no errors, correct dashboard load.
- Confirmed API is genuinely hosted on Railway (not dependent on the user's laptop) and Vercel's deployed frontend correctly points at the Railway API URL (not localhost, not its own domain).
- Confirmed CORS is correctly configured between Vercel and Railway.
- Live-verified a real user login (manager account) while streaming Railway logs in real time — login itself succeeded with no errors.

### Fixed

**Live Wallboard — `agent-load` and `queue-stats` endpoints were 500ing on every call**
- Found via live log streaming during login investigation: `column t.is_overdue does not exist` and `column tq.department does not exist` — both columns referenced in `packages/api/src/routes/analytics.ts` never existed in the schema at all (not recent drift — these were broken from the start).
- `is_overdue` was never a stored column; "breached" must be computed as `sla_due_at IS NOT NULL AND sla_due_at < NOW()`. Fixed in both endpoints.
- `ticket_queues.department` was never modeled (no department concept exists on queues) — dropped the field rather than inventing a fake data source. Matching unused field removed from the frontend `QueueStat` type (`packages/frontend/src/pages/Wallboard.tsx`).
- Both endpoints are gated to `manager`/`tenant_admin`/`super_admin` — every manager who opened Live Wallboard hit this 500 error. Live-verified fixed: both now return correct `200 OK` data.
- Not yet confirmed whether this was the root cause of the reported login-spinner issue specifically, or a separate pre-existing bug surfaced during the investigation — needs the user to reproduce the spinner again with live log streaming to confirm.

### Housekeeping

**Reset test password for all 73 existing users to a known value** for login diagnostics, at user's request. Real per-user passwords cannot be recovered (bcrypt one-way hashes) — this was necessary to test the actual login flow live.



### Added

**Per-channel consent tracking + enforcement (CB-04 → CB-08) — WhatsApp compliance**
- New `contact_channel_consent` table (migration `053_contact_channel_consent.sql`, applied to Supabase): per-contact, per-channel (whatsapp/sms/email) opt-in/opt-out events with timestamp, source, recording user, and note. Append-only — history is never overwritten, giving the provable audit trail Meta's WhatsApp Business API requires.
- New API endpoints on contacts: `GET /:id/consent` (current state per channel), `GET /:id/consent/history` (full audit trail), `POST /:id/consent` (record an event).
- New **Consent tab** on the Contact Detail page: per-channel toggles, optional "how consent was obtained" note, and expandable history view.
- New shared helper `packages/api/src/lib/consent.ts` (`getChannelConsent`/`recordChannelConsent`) for any outbound-messaging feature to consult.
- **Enforcement wired in now, not later:** ticket creation (manual + voice-bot paths) auto-records an opt-in when the customer picks WhatsApp/SMS as their preferred channel; the ticket-reply dispatcher checks the latest consent and falls back to email if the customer has explicitly opted out. Live-verified end to end: reply while opted-in dispatched via WhatsApp; after opt-out, further replies produced zero WhatsApp attempts.
- Tenant isolation verified: another tenant's manager gets an empty result, not another workspace's consent data (RLS `tenant_isolation` policy on the new table).
- Note for future work: bulk/marketing WhatsApp sends (when built) must be stricter — "no consent record" must mean NO send; for ticket replies, the customer choosing the channel on the ticket is itself the opt-in.

**Sector auto-provisioning at tenant creation (TA-04 root cause + fix, SP-01 → SP-04)**
- Root cause of the "Education sector sidebar" issue: the sector picked at tenant creation was never wired to module/feature licensing — the sidebar is driven purely by `active_modules`/`entitled_features`, which sector never touched. Not a crash; a missing feature.
- Each sector in `packages/shared/src/config/sectors.ts` now declares `defaultModules` + `defaultFeatures` (all 8 sectors populated with benchmarked defaults, e.g. Education → CRM + Ticketing + Sales + Emails; eCommerce → + Integrations + Analytics).
- `POST /super-admin/tenants` seeds the new tenant with the sector's defaults, unioned with anything explicitly requested; `PATCH /tenants/:id/modules` still adjusts afterwards. Matches the industry-template onboarding pattern in Salesforce/HubSpot verticals.
- Live-verified: education tenant auto-provisioned correctly; default ("other") tenants unchanged (no regression); manual module picks union with sector defaults; post-creation module editing unaffected.

### Fixed

**Webhook delivery pipeline silently dead (ST-09 → ST-12)**
- Root cause: the webhook worker (`packages/api/src/lib/webhook-worker.ts`) and dead-letter replay used raw `db.query()`, which sets neither `app.tenant_id` nor `app.bypass_rls` — since the DB role stopped being superuser, RLS silently rejected every insert/update. This broke BOTH the manual "Test" button AND all background webhook delivery in production.
- All 5 occurrences fixed to `db.withSuperAdmin(...)`. Live-verified: full enqueue → deliver → retry → dead-letter cycle observed in server logs; Delivery Logs UI shows real attempts.

**Routing & SLA settings save blocked for managers (RS-01 → RS-05)**
- `PATCH /settings/routing` rejected any manager save containing `routing_method` (even unchanged), blocking the whole form. Per decision (benchmarked vs Zendesk/Salesforce/Freshdesk/Intercom/HubSpot): ticket-routing method is operational configuration → now open to managers alongside the other routing knobs. No regression for tenant admin/agents (route-level role list unchanged).

**SMS-failure admin alert never delivered**
- `SmsService.notifyAdminNoConnector` inserted into a `message` column that doesn't exist on `notifications` (real column: `body`) — so the "SMS gateway not configured" warning to admins silently failed on every failed send. Fixed in `packages/core/src/sms.service.ts` (+ stale `.js` build artifact). Live-verified: notification row now lands with correct title/body.

### Verified (no change needed)

**Super-admin wall confirmed shipped**
- The super_admin operational-access wall (tenant.middleware 403 outside `/super-admin/*`; `requirePermission` bypass now tenant_admin-only) was found already committed and pushed (`b854929`) — earlier "pending approval" status was stale. Re-verified live: super_admin token gets 403 on `/api/v1/tickets`. Leftover unreachable `super_admin` mentions in route-level role checks across 5 route files are dead code — cleanup deprioritized by decision.

### QA test plan
- +14 new test cases this session (RS-01..05, TA-04 closure, SP-01..04, CB-04..08), all recorded as **pass** in the hosted QA test plan (Supabase-backed `qa-test-plan.html`).

---

## Change Log - 2026-07-11 (Field Mobile App — recovery, cloud re-test, field-visit flow)

### Recovered
**Mobile app + field API work restored from git stash**
- A parallel session had stashed all uncommitted mobile work (stash@{0}); restored surgically without touching newer web-CRM code: `activities.ts` (My Tasks `/mine`, GPS `/:id/checkin`, completion email + GPS on `/:id/complete`, parameterised activity list SQL), `contacts.ts` (`/scan-card` AI card scanner, `/parse-lead-text` voice-lead AI), `attachments.ts` registration in `server.ts`, and the entire `packages/mobile` diff (navigation-mount fix, cached-session restore, expo-location plugin, Vivid branding).

### Added
**Field-visit flow (mobile) — tested end-to-end against the cloud (Supabase) backend**
- Field officer login → My Tasks (assigned activities only, To do / Done counters) → Job Details → GPS check-in → outcome remarks → Mark complete (confirmation dialog) → CRM updated with completion time, GPS location, and remarks; customer notification email fires automatically (currently blocked only by pending vividsns.com SendGrid DNS verification).
- Cross-platform dialog helper `src/lib/dialog.ts` (RN `Alert` is a silent no-op on web preview).
- Test account: `field.officer@demo.com` (agent, Sales) created in cloud DB; 3 sample field jobs seeded.
- Attachments lazy table-create now tolerates hardened DB roles (skips DDL when table already exists).

### Verified (8-test suite vs AmanahCX repo code)
- Login, My Tasks, GPS check-in, complete-with-remarks, voice-lead AI, voice-task AI (+auto contact link, Urdu date phrases), AI card scan — all PASS. Deal-photo attachment verified earlier with a deal-owning account (officer correctly sees no deals — visibility scoping).

### Known gaps (next up)
- Manager field-team view (today's agenda / approached / locked), last-sync display (mobile + desktop), remarks mirroring to ticket timeline.

---

## Change Log - 2026-07-10 (Push 3 of 3) — Agent Dashboard 403 Fixed at Root Cause

### Fixed

**Agent dashboard 403 FORBIDDEN — real root cause traced and fixed**
- The Dashboard Audit (added in push 2) found an agent getting `403 FORBIDDEN` on their home dashboard. Initial theory (permission-record drift) was incomplete — traced further to the actual cause: the dashboard route (`GET /api/v1/analytics/ops-dashboard`) required `requireScope('analytics:read')`, which checks `permissions.analytics`. That value is correctly forced to `"none"` by tenant module-licensing enforcement (`applyModuleLicensing`) for any tenant without the paid Analytics module — Haier Electronics' actual entitlement (Core CRM + Ticketing only).
- The route's own existing code comment states the dashboard is "the home screen for all roles — not gated by analytics feature flag" — the scope check contradicted that stated intent.
- Fix: removed the scope requirement from `dashPreHandler` in `packages/api/src/routes/analytics.ts` entirely. The dashboard now loads for every role regardless of Analytics module licensing, matching its intended purpose as a universal home screen. Global JWT auth (already enforced on every non-public route) is sufficient.
- Also updated `settings.ts`'s agent default permission for `analytics` from `"none"` to `"view"` (matching the manager default pattern) — a minor improvement that only takes effect for tenants that do license Analytics; module-licensing enforcement still correctly overrides it to `"none"` otherwise.
- Verified: both affected agents (Amir, Zoya) now get `200 OK`, re-confirmed with their permission value deliberately left at `"none"` (matching real licensing) to prove the fix doesn't depend on it and introduces no entitlement bypass.

### Found, Not Fixed (logged to Backlog item 0b)

**Three separate, unsynchronized entitlement systems**
- While tracing the above, found that `tenant.settings.features.analytics` (a boolean feature flag) is a *third* mechanism gating analytics access, separate from `tenant.active_modules` (the module-licensing array) and `user.permissions.analytics` (per-user level) — and it's out of sync with the other two. Confirmed: Haier's `active_modules` correctly excludes analytics, but `settings.features.analytics` still permitted a paid analytics summary endpoint to return data.
- This is a larger architectural inconsistency (which routes use `requireFeature()` vs `requireScope()` vs direct permission checks, and which should be authoritative) that needs a dedicated audit before consolidating — not attempted in this session to avoid rushing a fix that could introduce a real entitlement bypass.

---

## Change Log - 2026-07-10 (Push 2 of 2) — Reference Document Restructure + Live Dashboard/Reports Audit

### Changed — AmanahCX-Roles-and-Flow.html (v5.7 → v5.9)

**Structural cleanup (v5.8)**
- Removed the standalone "Sales End-to-End Flow" section — it duplicated content now built directly into the main End-to-End Flow section, and included a dead, previously-abandoned stub left over from an earlier incomplete cleanup attempt.
- Rewrote the main End-to-End Flow to show the real cross-department journey by default: Voice call → Complaints → Support → Sales, built on the platform's actual cross-department origination, view-only handoff, and ticket-to-deal conversion features (not invented).
- Removed the "Gap Log" section entirely — confirmed it was a third restatement of the same facts already covered by the four `*-compliance` sections and the Master Gaps table, with no unique interactive value. Its 2 real 2026-07-10 entries were ported into the Master Gaps table instead of being lost.
- Fixed a structural bug: 6 whole sections (Data Visibility, Module Allocation, Functional Tests, Dept Comparison, Login Views, Sector Fields) were rendering outside the page's `<main>` element.
- Fixed two confirmed factual errors: the Permission Matrix was missing a Policy Admin column entirely and incorrectly showed Tenant Admin as able to configure SLA policies (Tenant Admin is actually blocked — only Policy Admin can, per already-tested code); `MASTER_PRODUCT_DOCUMENT.md` separately stated Policy Admin's rank as 25 (below Manager) when the real code ranks it 32 (above Manager, intentionally, so no operational role can manage a compliance officer).
- File shrank from 3,422 to 2,838 lines (~17% smaller) with zero information loss — verified with a JS syntax check before and after.

**New: Dashboard Audit + Reports Audit sections (v5.9)**
- Added two new sections, each with a sector selector, built from **live testing against the running application** — not assumed from code.
- Tested every available role (Tenant Admin, Manager, Line Manager, Agent) on the one live test tenant that exists (Haier Electronics, ecommerce sector), cross-checking dashboard figures against real database counts.
- **Confirmed bug found:** an agent's dashboard returns `403 FORBIDDEN` because their stored `analytics` permission has drifted to `"none"` in the database, despite the code's own default-permission function correctly setting it to `true` for the agent role. A change log entry from 2026-06-28 documents this exact class of bug being fixed previously — it has resurfaced for at least one live user, indicating the fix was applied to existing records at the time but not to the underlying default seeding path used for new tenants/users created afterward.
- **Confirmed inconsistency found:** the same permission blocks the Ops Dashboard but does not block the equivalent Reports endpoints (ticket trends, resolution, heatmap, team dashboard) — the same conceptual data is gated in one place and not the other.
- Sectors without a live test tenant (Banking, Telecom, Insurance, Retail, Utilities) are explicitly marked "Not Yet Audited" — no findings were invented for them.

---

## Change Log - 2026-07-10 (Critical Data-Isolation Fix, Auto-Contact-Creation, Manager Queue Visibility, Deployment Sync)

### Fixed — CRITICAL

**Database connection was silently bypassing tenant data isolation**
- The API was connecting to Postgres using a role (`postgres`) with `BYPASSRLS` — meaning every Row-Level Security policy in the database, including tenant isolation, was being ignored regardless of how correctly those policies were written.
- Discovered while testing ticket routing: a brand-new tenant with zero ticket queues of its own was having its tickets silently assigned to another tenant's queue.
- Fix: created/repurposed a restricted, non-superuser Postgres role (`crm_app`, `NOSUPERUSER NOBYPASSRLS`) with only the table-level privileges the app actually needs. Switched both the local dev environment and the live Railway production API to connect as this role. Two narrow, unrelated grants were needed to keep existing behaviour working: `CREATE` on the `public` schema (for an existing idempotent table-bootstrap step in `team-messages.ts`) and ownership of the 4 analytics materialized views + the `team_messages` table (Postgres requires ownership, not just a grant, to `REFRESH`/`CREATE INDEX`).
- Verified independently at the raw SQL level (same query returned a cross-tenant leak under the old role, returned nothing under the new role) and end-to-end against the live production app (not just a local copy) — confirmed a ticket claim/routing action that was failing due to this leak now succeeds correctly.
- Recorded as a tracked, idempotent migration (`048_restricted_app_role.sql`) instead of remaining an untracked manual database change.
- See `DATABASE_CHANGE_LOG.md` for full technical detail.

### Added

**Auto-contact-creation on ticket creation (manual + voice bot)**
- Ticket creation no longer requires an agent to search for and select an existing contact first. On submit, the system looks up an existing contact by email (manual tickets) or phone number (voice-bot tickets); if found, the ticket is linked to it; if not found, a new contact is created automatically and linked.
- Applied consistently to both the manual "New Ticket" form (`POST /api/v1/tickets`) and the voice-bot ticket-creation path (`POST /api/v1/tickets/from-voice`), so the behaviour is the same regardless of how the ticket originates.
- Matches the pattern used by Zendesk, Freshdesk, and HubSpot for inbound support tickets.
- Files: `packages/api/src/routes/tickets.ts`, `packages/frontend/src/pages/Tickets.tsx`.

**Manager visibility of unclaimed/unassigned tickets**
- Managers previously only saw tickets already assigned to one of their reports — an unclaimed ticket sitting in the team's queue was invisible to them until an agent picked it up.
- Extended manager ticket-list visibility to also include unassigned, open tickets in queues their reports belong to (or tickets with no queue at all), matching Zendesk/Freshdesk supervisor team-queue visibility.
- Files: `packages/api/src/routes/tickets.ts` (ticket list visibility query).

**Dashboard quick actions now respect licensed modules**
- Dashboard quick-action buttons (New Ticket, Voice Calls, Bot Calls, New Invoice, Voice Bot) previously showed for every role regardless of which modules the tenant had actually been allocated. The backend already correctly blocked access to unlicensed features — this was a visual/UX mismatch only.
- Buttons are now filtered against the tenant's active modules (`GET /api/v1/modules`) before rendering.
- Files: `packages/frontend/src/pages/Dashboard.tsx`.

### Fixed — Deployment Pipeline

**Vercel was connected to the wrong GitHub repository and required manual deploys**
- Discovered the Vercel project (`amanahcx`) was linked to an unrelated repository (`AI-Operations-Platfrom-`) instead of the actual `AmanahCX` repo, and had no auto-deploy configured — every release required a manual `vercel --prod` push.
- Reconnected the Vercel project to the correct repository and confirmed (via a live test commit) that it now builds automatically on every push to `main`, matching Railway's existing auto-deploy behaviour.
- Standing rule going forward: GitHub, Railway, Vercel, and Supabase must always be kept in sync — no manual deploy step as the normal workflow.

### Housekeeping

**Migration tracking cleanup**
- Re-verified the `_migrations` tracking table against files on disk — found them in full agreement (a previously-noted drift from an earlier session had already been resolved separately and no longer applied).
- Removed 3 duplicate migration files (`023_tenant_entitlements 2.sql`, `024_ticket_deal_link 2.sql`, `025_default_departments 2.sql`) confirmed byte-identical to their originals. No schema impact.

---

## Change Log - 2026-07-06 (Sales Module — Aging Table, Quotations, Template Fix, Builder Fix)

### Added

**Aging of Receivables table on Sales Dashboard**
- Full-width table at the bottom of the Sales Dashboard showing per-customer outstanding balances broken into 6 time buckets: < 30 days, 30–60 days, 61–90 days, 91–180 days, 181–365 days, and > 365 days past due date.
- Rows are sorted by total outstanding (highest first). Only customers with open, unpaid balances appear.
- Backend: new `agingByCustomer` SQL query in `sales-dashboard.ts` using `CURRENT_DATE - i.due_date` arithmetic across 6 CASE buckets.
- Frontend: full-width responsive table in `SalesDashboard.tsx` with colour-coded bucket headers.

**Quotations module**
- New `quotations` and `quotation_line_items` tables (migration `045_quotations.sql`) with RLS, indexes, and foreign keys.
- Full API CRUD at `POST/GET/PATCH/DELETE /api/v1/sales/quotations` plus `POST /api/v1/sales/quotations/:id/convert`.
- Convert endpoint copies the quotation to `invoices` + `invoice_line_items`, marks the quotation `accepted`, and sets `converted_to_invoice_id`. Quotation totals are excluded from sales figures until conversion.
- Frontend: `QuotationList.tsx` — searchable/filterable table with Convert to Invoice and View Invoice actions; `QuotationCreate.tsx` — full form with client, currency, template, issue date, validity period (auto-calculated Valid Until), line items, totals, notes and terms.
- Routes added to `App.tsx` at `/sales/quotations` and `/sales/quotations/new`.
- Sales Dashboard 5th KPI card: **Open Quotations** (violet, clickable → quotations list). Dashboard grid changed to `lg:grid-cols-5`.
- `quotationSummary` (totalValue + count of draft/sent) added to the dashboard API response.

**Voice Bot Self-Service configuration (G-F3)**
- Tenant admins can now configure the voice bot's self-service menu directly from Settings → Voice Bot.
- New `voice_bot_self_service_options` JSONB column on `tenants` (migration `044_voice_bot_self_service.sql`).
- API: `GET/PATCH /api/v1/voice-bot/self-service` — fetch and update up to 8 menu items (label + intent + enabled toggle).
- Frontend: `VoiceBotConfig.tsx` updated with a Self-Service Options card; items are reorderable, each has an enable/disable toggle.

### Fixed

**Invoice template selector — all templates now show distinct layouts**
- Previously, choosing a different template in the invoice detail/preview always rendered the same classic layout.
- Now `InvoiceDetail.tsx` branches on `inv.templateId`:
  - `tpl-minimal`: Typographic layout, no coloured boxes, border-bottom separators, uppercase tracking labels, 4-column table (no Tax column).
  - `tpl-consulting`: Full-width dark header band with white text, striped table rows.
  - Default (tpl-classic, tpl-agency, etc.): Original logo-box layout with coloured table header.

**Invoice Builder drag-drop — palette items now drop onto occupied canvas**
- Previously, dragging a palette element onto the canvas only worked when dropping onto empty canvas space. Dropping onto an existing element did nothing.
- Fixed in `SalesBuilder.tsx` `onDragEnd`: `overCanvas` now also returns `true` when `e.over.id` matches any existing canvas element id, so palette drops land correctly regardless of what the cursor is over.

---

## Change Log - 2026-07-02 (Agent Escalation + Sector-Specific Ticket Fields)

### Added

**Agent → Manager Escalation (G-P3)**
- Agents can flag any ticket with an escalation reason via an "Escalate to Manager" button in the ticket panel.
- Managers see an orange "Escalated" badge on the ticket and a full escalation reason banner showing who escalated, why, and when.
- Managers can acknowledge the escalation (clears the flag). Non-managers see a disabled indicator only.
- API: `POST /api/v1/tickets/:id/escalate` (agent) and `POST /api/v1/tickets/:id/acknowledge-escalation` (manager+).
- DB columns: `agent_escalated BOOLEAN`, `agent_escalated_at TIMESTAMPTZ`, `agent_escalated_reason TEXT` on tickets table.
- Audit logged on both escalate and acknowledge actions.

**Sector-Specific Custom Fields in Ticket Forms**
- New ticket creation form now shows sector-relevant custom fields (e.g. banking: Case Type, Transaction Reference, Amount Involved, Regulatory Deadline, Central Bank Ref #).
- Fields also displayed in the ticket detail panel.
- Custom field values saved with the ticket via `custom_fields` JSONB column.
- API: `GET /api/v1/sector/fields?entity=ticket` — opened to all authenticated roles (was admin-only).

**Auto-Seeding Sector Fields at Tenant Creation**
- When a super admin creates a tenant and selects a sector, all sector-specific fields are automatically provisioned for contacts, tickets, deals, and companies — no manual setup needed.
- Same seed runs on sector update (`PATCH /super-admin/tenants/:id` with `{sector}`).
- `seedSectorFields()` in `super-admin.ts` handles all 4 entity types per sector config in `sectors.ts`.

### Fixed
- Demo tenant (created before seed code existed) re-seeded with banking sector ticket fields via sector update endpoint.
- `GET /api/v1/sector/fields` permission changed from `admin:read` to `tickets:read` so agents and managers can load fields for their forms.

---

## Change Log - 2026-07-01 (SLA Governance Guardrail + Reassignment Audit + Role Reference HTML)

### Added

**SLA governance guardrail — mandatory reason for priority changes**
- Changing a ticket's priority now requires a written reason before Save is enabled (backend + frontend).
- Priority change without a reason returns HTTP 400 `PRIORITY_REASON_REQUIRED`.
- Logged as a distinct `priority_changed` audit entry (separate from generic `field_updated`) with `old_value`, `new_value`, and `meta.reason`.
- Applies to all roles that can change priority: tenant_admin, manager, line_manager.
- Files: `packages/api/src/routes/tickets.ts`, `packages/frontend/src/pages/Tickets.tsx`.

**Reassignment audit — distinct audit entry for agent changes**
- When a manager reassigns a ticket to another agent, an optional reason field appears in the Edit panel.
- Reason is optional (not a compliance gate — Save is not blocked). Helps post-incident review.
- Logged as `assignee_changed` audit entry with `old_value`, `new_value`, and `meta.reason` (empty if not given).
- Applies to manager and tenant_admin roles.
- Files: `packages/api/src/routes/tickets.ts`, `packages/frontend/src/pages/Tickets.tsx`.

**Manager ticket edit after acceptance**
- Managers can edit ticket fields (status, priority, assignee, queue) at any stage — including after agent acceptance.
- Previously only available pre-acceptance.

**Tenant admin hard-delete on closed tickets only**
- Hard DELETE endpoint now enforces closed-status guard at the API level (returns 403 if ticket is not closed).
- Only tenant_admin role can call the endpoint.

**Contact search by phone / NIC / name / email**
- Contact search on ticket creation and contact pages searches across all four fields simultaneously.

**AmanahCX-Roles-and-Flow.html — comprehensive role and flow reference**
- New HTML file covering: exhaustive role-by-role permissions (tenant_admin, voice bot, manager, line_manager, agent, viewer) and complete end-to-end information flow (voice bot call → intent detection → ticket creation → contact create/update → ACD routing → agent acceptance + TAT start → originator view-only + notes).
- Located at project root and copied to Desktop for distribution.

---

## Change Log - 2026-06-29 — Push 5 of 5 (Policy Admin Role + SLA Governance Isolation)

### Added

**Policy Admin — new governance role (independent of operations)**
- New system role `policy_admin` (ROLE_RANK = 25, between Manager:30 and Agent:20) seeded across `roles.ts`, `settings.ts`, and `auth.middleware.ts`.
- **Only** `policy_admin` can create, edit, or delete SLA policies. Managers and tenant_admin are hard-blocked (manager → 403 FORBIDDEN; tenant_admin → 403 ADMIN_NO_OPERATIONS).
- `governed_departments: TEXT[]` column added to `users` table (migration 034). Stored in JWT, used to scope which SLA policies a policy_admin can read/write.
- `ticket_type: TEXT` column added to `sla_policies` table. Tags each policy to a department (sales / support / complaints / null = all).
- Purple department badge shown on SLA policy cards when a `ticket_type` is set.
- Invite modal (`AdminUsers.tsx`): when role = policy_admin, department selector is hidden and governance checkboxes (Sales / Support / Complaints) appear instead.
- SLA Policies nav link (`App.tsx`) now only visible to `policy_admin` users (previously visible to managers).
- Migration 034: `governed_departments`, `ticket_type`, GIN index on users, BTree index on sla_policies.

**Security guarantees verified in browser**
- policy_admin: SLA page loads, policies scoped correctly ✅
- Manager POST → `{"code":"FORBIDDEN","message":"Insufficient permissions"}` ✅
- tenant_admin POST → `{"code":"ADMIN_NO_OPERATIONS"}` ✅

---

## Change Log - 2026-06-29 (Ticket-Contact Linking UI + Platform Rebrand + UX Fixes)

### Added / Fixed

**Ticket-Contact Linking — Create Ticket form (Tickets.tsx)**
- Contact search field added as the first field in the Create Ticket modal. Agent types name, email, phone, mobile, or NIC → dropdown shows matches → select to link.
- Reporter Name, Email, and Phone auto-fill from the selected contact record (read-only — cannot be manually overridden).
- `contactId` is sent to `POST /api/v1/tickets` on every ticket creation. Every ticket is now linked to a contact at birth.
- Ticket panel crash loop fixed: `React.useState` replaced with `useState` (namespace was undefined); `retry: false` added to TicketPanel query; `isError` guard prevents infinite reload on API error.
- Tickets page reads `?open=<id>` from URL on load and opens the correct ticket panel automatically (enables deep-linking from Contact 360).

**Login page rebrand (Login.tsx)**
- Product name updated from "Vivid Solutions & Services" to "AmanahCX" across the hero heading, card header, and copyright footer.

**Invite modal — department-scoped manager filter (Settings.tsx)**
- When inviting a new team member, the Line Manager dropdown now only shows managers from the same department (not all non-admin users).
- Changing the department field resets the manager selection automatically.
- Warning shown if the selected department has no managers yet ("No managers found for the X department").

**Admin Users — manager assignment on invite (AdminUsers.tsx)**
- Invite form now includes a manager_id field, populated by filtering managers in the same department and role.
- Changing department or role resets the manager selection.
- `resolveRoleName` helper added to correctly display custom role names vs system role names throughout the page.

---

## Change Log - 2026-06-29 (7 CRM Gap Features — 360 View, Wallboard, Business Hours)

### Added

**Step 1 — Agent Status Presence**
- Agents can set themselves Online / Busy / Away / Offline from the sidebar. Status shown with colored dot.
- Auto-assign (push routing) now skips agents who are Offline or Away.
- Migration 032 adds `agent_status` and `agent_status_updated_at` columns to `users`.

**Step 2 — Live Supervisor Wallboard (`/wallboard`)**
- Real-time grid of all agents with status dot, active ticket count, and SLA breaches.
- Summary strip: Online / Busy / Away / Offline agent counts.
- Queue depth panel showing open, assigned, pending, and breached counts per queue.
- Auto-refreshes every 30 seconds. Manual refresh button. Managers only.

**Step 3 — New Ticket Quick Action on Customer 360**
- "New Ticket" button added to the Tickets tab on any contact page.
- Inline modal: enter subject, priority, and department without leaving the 360 view.
- Ticket is automatically linked to the contact on creation.

**Step 4 — Unified Timeline on Customer 360**
- The Timeline tab now shows activities, voice calls, tickets, AND deals in one chronological feed.
- Ticket and deal events appear with distinct icons (lifebuoy / trend arrow).

**Step 5 — CSAT Score on Customer 360 Profile Panel**
- If any resolved tickets from this contact have CSAT responses, a star rating and count appear in the profile sidebar.
- Data sourced from `csat_surveys` joined to `tickets.contact_id`.

**Step 6 — Clickable Deals on Customer 360**
- Deal rows in the Deals tab are now buttons that navigate to `/deals?open=<id>`.
- The Deals page reads `?open=<id>` from URL and automatically opens that deal's detail panel.

**Step 7 — Per-Department Business Hour Profiles**
- New "Business Hours" tab added to SLA Policies page.
- Managers can create named schedules (e.g., "Support 9–6 Mon–Fri") scoped to specific departments.
- Each profile specifies open/close times per day; closed days are marked explicitly.
- Migration 033 adds `business_hour_profiles` table with RLS.

---

## Change Log - 2026-06-29 (Customer 360 — NIC on Profile, Clickable Tickets)

### Added
**NIC number on Contact 360 profile panel**
- Contact's NIC number now shows in the left panel alongside phone and mobile, with a card icon.
- Agents can verify a customer's NIC during a call without leaving the screen.

**Clickable tickets on Contact 360**
- Each ticket row in the Tickets tab is now a button. Clicking navigates to the Tickets page and opens that ticket's detail panel directly.
- The Tickets page reads `?open=<ticketId>` from the URL on load and opens the panel automatically.
- An external link icon on the right of each ticket row signals it's clickable.

---

## Change Log - 2026-06-29 (Ticket-Contact Linking — Mandatory Contact on Every Ticket)

### Added
**Ticket creation now requires a linked contact**
- Every new ticket must be linked to a contact record before it can be submitted.
- Contact search field added at the top of the Create Ticket form. Agents search by name, email, phone, mobile, or NIC number and select the customer before filling in any other details.
- Once a contact is selected, Reporter Name, Email, and Phone auto-fill and become read-only (no manual override — data comes from the CRM record).
- `contactId` is sent to `POST /api/v1/tickets` and stored as `contact_id` on the ticket.

**Contact search extended to phone, mobile, and NIC**
- `GET /api/v1/contacts?search=...` now searches across name, email, phone, mobile, and NIC number — in both the list query and the count query.
- Agents can type any customer identifier to locate the correct contact record without knowing their name.

### Why this matters
- Agents receiving callbacks can immediately see a customer's full history (all prior tickets, calls, deals) on the Contact 360 page.
- Without `contact_id`, the Tickets tab on ContactDetail would always show 0 tickets — the link is required for the callback workflow to function.
- Matches global CRM standard: Zendesk, Freshdesk, and Salesforce all require a contact on every ticket.

---

## Change Log - 2026-06-28 (AmanahCX Rebrand, Role Display Names in Invite, Customer 360, Line Managers, Dashboard Fix)

### Changed
**AmanahCX rebrand — all screens**
- All occurrences of "Vivid Solutions & Services" replaced with "AmanahCX" across:
  - Login page (left panel wordmark, mobile header, footer copyright)
  - Main app sidebar brand name
  - Invite email footer (sent when a new user is created)
  - Onboarding email footer (sent by super-admin when provisioning a tenant)

**Role display names in Invite User form**
- The manager dropdown label now shows the organisation's own display name for that tier (e.g. "Territory Manager", "Floor Manager") instead of the generic label "Line Manager" or "Department Manager".
- Display name is resolved from the custom role attached to the managers in the dropdown. Falls back to system role name if no custom role is set.
- Manager options show only the person's name — no redundant role suffix.
- Role selector moved above the manager dropdown so the admin picks the role tier first, which then filters the manager list accordingly (agents see only Line Managers; new managers see only Dept Managers).

---

## Change Log - 2026-06-28 (Customer 360, Contact 360 Cross-Dept Tickets, Dashboard Fix, Line Managers, Dept-Scoped Dropdown)

### Added
**Customer 360 — Contact detail page enhancements**
- Callback search: search contacts by phone/mobile from the ticket view.
- 360 view tab: shows contact's full profile, company, tags, and custom fields in a single panel.
- Notes tab: agents can add/view timestamped notes on a contact record.
- Cross-department ticket view: a new `/api/v1/contacts/:id/tickets` endpoint returns ALL tickets for a contact across all departments. Agents opening a customer record now see every ticket the customer has — regardless of which department handled it — in a unified "Tickets" tab with a purple department badge per ticket.

**Line managers for all departments**
- Created Support Line Manager (`support.line.manager@demo.com`), Sales Line Manager (`sales.line.manager@demo.com`), and Complaints Line Manager (`complaints.line.manager@demo.com`) in the demo tenant.
- Full 3-level hierarchy per department: Dept Manager → Line Manager → Agent.
- Line managers see only their own data and their reportees' data in dashboards and reports (powered by the existing `getVisibleUserIds` recursive CTE).

**Department-scoped Line Manager dropdown (Invite & Edit)**
- When inviting a new user, selecting a department immediately filters the Line Manager dropdown to show only managers from that same department.
- Switching department resets any previously selected manager.
- If no managers exist for the selected department, an amber warning is shown.
- Same filter applies to the Edit panel inline manager dropdown.
- Backend: `GET /api/v1/settings/team` now returns `department` and `department_type` per user so the frontend can filter correctly.

### Fixed
**Agent dashboard showing 0 tickets**
- `deptTicketFilter` (`ticket_type = 'support'`) was incorrectly applied to agents' `myTickets` query. Support agent tickets were seeded with `ticket_type = 'inquiry'`, so the filter excluded all of them.
- Fixed by splitting the analytics query: agents use a clean SQL without dept filter; managers still use the dept-scoped version.

**Agents blocked from ops-dashboard (403)**
- Agent default `analytics` permission was `false`. Updated default in `roles.ts` to `analytics:read: true` so all newly invited agents can access their dashboard immediately.
- Existing demo agents' DB permissions patched to `analytics = "view"`.

---

## Change Log - 2026-06-24 (Visibility Guards, Originator View, Reports Hub, Complaints Manager)

### Added
**Ticket visibility guards — department-scoped, hierarchy-aware**
- `GET /api/v1/tickets` now enforces `getVisibleUserIds`: agents see only tickets assigned to them; managers see their full reportee hierarchy; super_admin/tenant_admin see all.
- Visibility is department-scoped — Support Manager sees only Support team tickets; Complaints Manager sees only Complaints team.

**Cross-department originator view**
- When a support agent creates a ticket that is routed to and accepted by another department (Sales or Complaints), the originating agent retains read-only visibility on that ticket.
- `is_originated_by_me` + `assignee_department` fields added to ticket list response.
- Frontend shows an amber **"👁 View only"** badge on these tickets in the list and detail panel.
- Write attempts on originated cross-dept tickets return `ORIGINATOR_READONLY` (HTTP 403).
- Industry standard (Zendesk / Freshdesk / Salesforce): originator keeps status/resolution visibility but cannot act on the ticket once accepted by another team.

**Complaints Manager — correct department hierarchy**
- Created `Complaints Manager` (`complaints.manager@demo.com`) for the demo tenant.
- Complaints Agent now correctly reports to Complaints Manager, not Support Manager.
- Full 3-department hierarchy: Support Manager → Support Agent; Complaints Manager → Complaints Agent; Sales Manager → Sales Agent.

**Reports hub (10 downloadable CSV reports)**
- New `/reports` page available to both managers and agents from the sidebar.
- Manager reports: Ticket Volume, SLA Performance, Agent Performance, CSAT, Issue Categories, Ticket Backlog.
- Agent reports: My Tickets, My Activities, My SLA, My Call Log.
- All reports export to CSV with correct column headers and live data.

**Ops Dashboard KPI strip**
- Added 4-card live KPI strip to the Manager Dashboard: CSAT Score, SLA Compliance %, Avg Resolution Time, Avg First Response Time.

**Analytics sidebar section**
- Collapsible "Analytics" button in the manager sidebar with sub-links: Ops Dashboard and Ticket Reports.

### Modified
- Sales Agent ticket permission changed from `none` to `view` — sales agents can now access tickets assigned to them (their core workflow).
- Sales Manager ticket permission changed from `none` to `full`.

### Fixed
- Complaints Agent was incorrectly reporting to Support Manager, causing Support Manager to see Complaints tickets. Fixed by creating a dedicated Complaints Manager.

---

## Change Log - 2026-06-24 (Ticket Reports)

### Added
**Full Ticket Reports page for managers — benchmarked vs Zendesk / Freshdesk**
- New **Ticket Reports** page accessible to managers from the sidebar.
- **6 KPI summary cards:** Total Tickets, Resolved (with resolution rate %), SLA Compliance % (colour-coded green/amber/red), Avg Resolution Time, Avg First Response Time, Escalation Rate %.
- **Ticket Volume chart:** Bar chart showing total, resolved, and SLA-breached tickets over the selected period (daily/weekly/monthly breakdowns auto-selected by period).
- **SLA Performance Trend chart:** Dual-axis line chart — SLA compliance % and avg resolution/first-response times over time.
- **Tickets by Priority:** Donut chart (Urgent/High/Medium/Low) with count and percentage.
- **Tickets by Channel:** Donut chart (Voice Bot/Manual/Email etc.) with count and percentage.
- **Top Issue Categories:** Horizontal bar chart of the top 10 ticket tags with avg resolution time and SLA breach rate per category.
- **Tickets by Type:** Bar breakdown (complaint/inquiry/sales etc.).
- **Repeat Reporters:** Table of customers who raised more than one ticket in the period.
- **Period selector:** Last 7 days / 30 days / 90 days / 6 months.
- **CSV export:** Downloads volume data as a spreadsheet.
- Files: `packages/frontend/src/pages/TicketReports.tsx` (new), `packages/frontend/src/App.tsx` (import + route + nav link).

---

## Change Log - 2026-06-24 (SLA breach notifications)

### Added
**SLA escalation — all stages now send email + in-app notification**
- Previously: the warning reminder (at 80% of SLA time) only sent an in-app notification. Agents had no email alert until the SLA was already breached.
- Now: all three escalation stages send both in-app notification AND email.
  - **80% warning** → email to the assigned agent: "X minutes remaining, please action now"
  - **100% breach (L1)** → email to the agent + all managers in the workspace
  - **150% breach (L2)** → email to all tenant admins (highest authority escalation)
- Worker checks every 5 minutes and fires on server start (no breach is missed after a restart).
- Files: `modules/ticketing/src/index.ts` — added `emailSvc.send()` call inside the reminder block.

---

## Change Log - 2026-06-24 (SLA deadline engine)

### Fixed / Enhanced
**SLA Deadlines now skip non-working hours and public holidays**
- Previously: deadline = accepted time + hours (e.g. accept at 4pm Friday with 8h SLA → deadline 12am Saturday — wrong).
- Now: deadline walks forward through working days only, skipping weekends, non-working hours, and any public holidays set in the holiday calendar.
- Both the first-response deadline and the resolution deadline use this logic.
- Behaviour when no business hours are configured is unchanged (simple clock arithmetic).
- Tested: late-day acceptance skipping overnight ✅, Friday acceptance skipping weekend ✅, holiday on next working day skipping to day after ✅.
- Files: `packages/api/src/routes/tickets.ts` — `computeSlaDeadline()` and `buildSlaDeadlines()` functions added; accept handler updated to use them.

---

## Change Log - 2026-06-24 (CSAT Survey)

### Added
**CSAT Survey — full end-to-end customer satisfaction flow**
- **Public survey page** (`/csat/:token`): Customer-facing star-rating page (1–5 stars with colour-coded labels), optional comment field, thank-you confirmation screen. No login required. Handles expired (410) and not-found (404) states gracefully.
- **Ticket detail panel**: Resolved tickets now show a "Customer Satisfaction" card — displays star rating and comment if responded, or "awaiting response" if survey is pending.
- **Ticket detail API** (`GET /api/v1/tickets/:id`): Now returns `csatSurvey` field (rating, comment, responded_at, sent_at) for any ticket that has a linked survey.
- **Survey auto-send**: Pre-existing — already fires on ticket close via `sendCsatSurvey()` in `tickets.ts`. Email sent to reporter with the unique token URL. Verified working end-to-end.
- **CSAT list + summary API**: Pre-existing at `GET /api/v1/tickets/csat` and `GET /api/v1/tickets/csat/summary`. Returns all responses with rating, comment, ticket details, and aggregate stats (avg rating, response rate, distribution by star).
- Vite proxy: added `/public` path so the dev server forwards CSAT API calls correctly.
- Files: `packages/frontend/src/pages/CsatSurvey.tsx` (new), `packages/frontend/src/App.tsx` (route added), `packages/frontend/src/pages/Tickets.tsx` (CSAT card), `packages/api/src/routes/tickets.ts` (csatSurvey in detail), `packages/frontend/vite.config.ts` (proxy).

---

## Change Log - 2026-06-24 (SendGrid deliverability)

### Fixed
**Email — SendGrid sender changed from Gmail to authenticated domain**
- Root cause: `SENDGRID_FROM_EMAIL` was set to `vividd.solutions@gmail.com` — a Gmail address that SendGrid cannot authenticate. Emails were landing in spam or being rejected by enterprise mail servers.
- Fix: Changed sender to `noreply@vividsns.com` (owned domain). SPF/DKIM DNS records must be added in SendGrid and domain registrar (one-time setup — see OPERATIONS_GUIDE.md → Email Deliverability).
- Files: `packages/api/.env` (SENDGRID_FROM_EMAIL updated).
- Action required: Complete domain authentication in SendGrid dashboard (Settings → Sender Authentication → Authenticate Your Domain) and add the 3 DNS records provided.

---

## Change Log - 2026-06-24 (continued)

### Fixed
**Dashboard — ops-dashboard unblocked for all roles**
- Root cause: `requireFeature('analytics')` was gating the home-screen dashboard behind a feature flag (`settings.features.analytics = false`). Every user hit a 402 and saw a permanent spinner.
- Fix: ops-dashboard now uses `dashPreHandler` (scope check only, no feature flag). Analytics reports/exports remain feature-gated. The home screen is core product, not an analytics add-on.
- Fix: `owner_id` ambiguous column reference in `recentActivities` JOIN query — qualified as `a.owner_id`.
- Fix: `isManager` flag was false for managers with no direct reports. Now explicitly includes `role === 'manager'` in the check.
- Affected roles: Manager dashboard (Team Ticket Dashboard, leaderboard, bot stats) and all other roles now load correctly.

---

## Change Log - 2026-06-24

### Added

**SLA Module — Step 1: Policy Editor (Full CRUD)**
- Managers can now create, edit, and delete SLA policies directly inside the CRM.
- Each policy defines: priority tier (Urgent/High/Medium/Low), first-response deadline, resolution deadline, and multi-level escalation schedule (reminder → L1 supervisor → L2 admin).
- Escalation steps are configurable: set % threshold, notification label, and recipient scope (assigned agent / supervisors & managers / tenant admins).
- SLA policy auto-assigns to new tickets based on priority at creation time.
- SLA policy re-evaluates and reassigns when ticket priority changes.
- Files: `packages/api/src/routes/tickets.ts` (POST/PATCH/DELETE `/api/v1/tickets/sla-policies/:id`), `packages/frontend/src/pages/TicketSla.tsx` (new page).

**SLA Module — Step 2: Business Hours**
- Each SLA policy can be scoped to business hours only.
- Manager picks active days (Mon–Sun) with per-day on/off toggle in a visual editor.
- SLA clock only ticks during enabled days — tickets raised outside hours don't count against SLA.
- Benchmarked against Zendesk/Freshdesk: matches global standard.
- DB: `business_hours_only boolean`, `business_hours_schedule jsonb` on `sla_policies`.

**SLA Module — Steps 4–6: Holiday Calendar, First Reply Time, Smart Policy Matching**
- **Holiday Calendar** (Step 4): Managers can now define public holidays at workspace level. SLA clocks pause on holiday dates — applies across ALL SLA policies. Holidays can recur yearly (e.g. Eid, national holidays). New tab on the SLA page. API: `GET/POST/PATCH/DELETE /api/v1/tickets/holidays`. DB: new `sla_holidays` table with RLS and `UNIQUE(tenant_id, date)` constraint. Benchmarked: matches Zendesk/Freshdesk standard.
- **First Reply Time** (Step 5): New `first_replied_at` column on `tickets` table. Stamps when the agent posts their first public reply — tracked independently of the SLA `first_response_at` timer. Useful for pure performance metrics without SLA distortion.
- **Smart Policy Matching** (Step 6): SLA policies now have `match_conditions` (jsonb: channels, departments, tags). When creating a ticket, the system picks the most specific matching policy — most conditions set = highest priority, with fallback to least-specific policy. Manager can set conditions via comma-separated fields in the policy editor. DB: `match_conditions jsonb NOT NULL DEFAULT '{}'` on `sla_policies` (migration 030).
- Migration: `030_sla_enhancements.sql` applied.

**SLA Module — Step 3: Pause on Pending**
- New toggle on each SLA policy: "Pause SLA when waiting for customer."
- When a ticket is set to Pending/Waiting status, the SLA clock pauses automatically; it resumes when the customer replies.
- Prevents agents being penalised for time spent waiting on the customer — standard in Zendesk, Freshdesk, Jira Service Management.
- DB: `pause_on_pending boolean NOT NULL DEFAULT false` on `sla_policies` (migration applied).
- Frontend: checkbox in the policy editor + amber "⏸ Pauses on pending" badge on policy cards.

**Entitlements & Licensing System (Phases 1, 2a, 2b)**
- Phase 1: Super admin provisions entitlements per workspace at creation time (which modules/features each tenant is licensed for). Stored in `entitled_features` table.
- Phase 2a: Roles screen ceiling — tenant admin cannot grant permissions beyond what the workspace is licensed for. Unlicensed modules are hidden from the Roles editor.
- Phase 2b: Sidebar nav gated by entitlement — unlicensed modules don't appear in the navigation. API routes protected by `requireEntitlement` guard.
- Files: `packages/api/src/routes/roles.ts`, `packages/frontend/src/pages/Roles.tsx`, `packages/frontend/src/App.tsx`.

**Super Admin Improvements**
- Password change blocked for super_admin account in Personal Settings (security hardening).
- Super admin sidebar operational with working Reports section.
- Files: `packages/frontend/src/pages/PersonalSettings.tsx`, `packages/api/src/routes/super-admin.ts`.

### Modified
- `packages/api/src/routes/auth.ts` — auth hardening, change-password improvements.
- `packages/api/src/routes/settings.ts` — team query fixes.
- `packages/frontend/src/hooks/useRole.ts` — role detection improvements.
- `packages/frontend/src/pages/Login.tsx` — login UX fixes.

### Fixed
- SLA INSERT param count corrected (14 params after adding `pause_on_pending`).
- SLA PATCH correctly shifts param indices after adding `pause_on_pending` column.

### Backlog Items Closed
- Condition-based SLA auto-assignment on ticket create ✅ (was pending — now done via `findSlaPolicy()`).
- Condition-based SLA re-assignment on priority change ✅ (added to PATCH handler).

---

## Change Log - 2026-06-23

### Added
- Established the three source-of-truth documents: `MASTER_PRODUCT_DOCUMENT.md`, `CHANGE_LOG.md`, `BACKLOG.md`.

### Modified
- None (operational only — started local dev servers).

### Removed
- None.

### Fixed
- None.

_Operational note: ran the solution locally — API on `:3000` (healthy) and frontend on `:5173`
(login screen renders, manager login verified). No code changed._

---

## Change Log - 2026-06-22

### Added
- **Separation of duties:** tenant admin blocked from all operational + billing API routes (gateway in `server.ts`); admin nav hidden; home redirects to Settings; call widget hidden.
- **Record visibility helper** `packages/api/src/lib/visibility.ts` (`getVisibleUserIds`, `ownerScopeSql`) — hard filter by line-manager hierarchy; applied to contacts, deals (list/board/pipeline value), activities, and (companion session) companies, opportunities, team-messages, ticket-analytics.
- **Sales ticket → deal:** migration `024_ticket_deal_link.sql` (`tickets.deal_id`); auto-convert on accept; idempotent `POST /tickets/:id/convert-to-deal`; frontend **Convert to Deal** button.
- **System email (SendGrid):** onboarding temp-password email + admin password reset/re-send.
- **TAT countdown** on the customer record (Contact → Tickets tab).
- Light-theme pitch deck (`Reducing-Call-Centre-Workload.pptx/.pdf`) + full solution handover doc.
- Pipeline backfill helpers + smoke-test scripts (companion session).

### Modified
- Both billings (subscription + customer invoicing) moved off the admin role to a Finance/Sales permission.
- Activities `today`/`overdue` switched from "managers see all" to hierarchy-scoped visibility.
- Docs reorganised under `docs/22062026/`.

### Removed
- "Routing & SLA" settings tab hidden from the super-admin view.

### Fixed
- **Departments 500:** queries referenced a non-existent `users.department_id`; rewired to link by `department` name/type. List, single-view, assign, remove all work.
- Earlier: sales dashboard $0 / partial-payment tracking; bcryptjs vs bcrypt; `users.is_active`.

---

## Change Log - 2026-06-24 (Customer 360 — Search, Clickable Customer, Any-Agent Notes)

### Added
**Multi-field ticket search — mobile, NIC, name, phone**
- Ticket search now finds tickets by: ticket number, subject, reporter name, reporter phone, reporter email, contact mobile number, contact NIC (National Identity Card) number.
- Any agent receiving a customer callback can type the customer's mobile or NIC and instantly find all their tickets.
- Migration `031_contact_nic.sql` — added `nic_number` column + index to contacts table.

**Clickable customer name → Customer 360**
- Customer/reporter name in the ticket list card and the ticket detail panel is now a clickable link.
- Clicking it opens the customer's full Contact record (all tickets, calls, activities, deals across all departments).
- Only shown as a link when the ticket has a linked contact (`contact_id`).

**Any-agent internal note on any ticket**
- New `POST /api/v1/tickets/:id/notes` endpoint — requires only `tickets:read` (no ownership required).
- Any agent who receives a customer callback can add an internal note to any ticket, even one owned by another department.
- Notes are always internal (not visible to the customer). Stored as `comment_type = 'note'`, `is_internal = true`.
- Does not change ticket ownership, SLA timers, or status.
- Audit logged as `note_added`.

**Originator panel — note box**
- View-only (originated) tickets now show an amber banner with a **"+ Add Note"** button.
- Agent can expand the note box, type context from the customer call, and submit — note appears in the ticket's conversation thread visible to the owning department.

---

## Change Log - 2026-06-28 (Contact 360 — Cross-Department Ticket View)

### Fixed
**Contact 360 Tickets tab now shows ALL departments' tickets for that customer**
- Previously: the Tickets tab on a customer's contact page was filtered by the viewing agent's visibility scope. A Support Manager opening a customer's 360 view would only see the Support ticket, missing Complaints and Sales tickets for the same person.
- Now: new `GET /api/v1/contacts/:id/tickets` endpoint returns all tickets for the contact across all departments, regardless of who is viewing.
- Each ticket shows a coloured department badge (purple) so agents can see at a glance which team owns it.
- Tested: contact with 5 tickets across Support, Complaints, Sales — new endpoint returns all 5; old scoped endpoint returns only 1.
- Files: `packages/api/src/routes/contacts.ts` (new endpoint), `packages/frontend/src/pages/ContactDetail.tsx` (Tickets tab updated).
