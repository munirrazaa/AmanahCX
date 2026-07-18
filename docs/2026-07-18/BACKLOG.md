# BACKLOG
_All ideas, pending work, and deferred items. Prioritised against enterprise readiness and benchmarked vs. Zendesk, Freshdesk, Salesforce Service Cloud, HubSpot._

**Priority scale:**
- **P1 – Critical** → Blocks enterprise sale. Every top CRM ships this. Missing = demo fails.
- **P2 – High** → Important for serious buyers. Do within next few sessions.
- **P3 – Medium** → Good to have. Won't lose a deal without it but adds polish/depth.
- **P4 – Low** → Nice idea. Post-launch or on-request only.

---

## 🔴 P1 — Critical (Do Now — blocks enterprise readiness)

### 0f. Voice-bot ticket-type bug + cross-department SLA escalation leak — FIXED
- **Verdict:** Done ✅ — 2026-07-18
- **Trigger:** line-by-line audit of the Developer Orientation doc's end-to-end flow diagram against real code.
- **Findings, both fixed:** (1) Nadia voice-bot tickets persisted `ticket_type='complaint'` always, regardless
  of the sales/inquiry/complaint classification already used for queue routing — so voice-originated sales
  enquiries never auto-converted to pipeline deals on accept. (2) SLA breach escalation notified every
  manager/tenant_admin tenant-wide instead of the ticket assignee's own manager chain, breaking department
  isolation. Full detail in `CHANGE_LOG.md` (2026-07-18).

### 0d. Super Admin nav showed unreachable items + 4 other real bugs found in full toggle audit — FIXED
- **Verdict:** Done ✅ — 2026-07-17
- **Trigger:** user reported Super Admin "not able to save roles"; asked for a systematic audit so no toggle silently fails anywhere.
- **Findings, all fixed:** wrong-role nav-visibility flag showing 4 dead-end Super Admin menu items (Roles/Integrations/Sales/notifications); Super Admin's Billing tab missing its database table entirely; a SQL bug that broke any workspace-settings save touching 2+ fields at once; a cross-account react-query cache leak on login/logout; Super Admin's tenant-picker dropdowns broken by a pageSize cap mismatch. Full detail in `CHANGE_LOG.md` (2026-07-17).
- **Also found and fixed (not a bug, a missing feature dressed as one):** Notification Preferences and Active Sessions/Revoke were fully cosmetic screens with zero backend — built real ones for both, live-verified.
- **Still open, not touched this pass:** items 0a/0b/0e below (agent-dashboard entitlement drift, three-entitlement-system consolidation, dashboard audit) remain as previously logged.

### 0c. Daily Vercel login "spinner that never stops" — ROOT CAUSE FOUND & FIXED
- **Verdict:** Done ✅ — 2026-07-13, reproduced live with the user exactly as planned
- **Root cause (two stacked problems):** (1) the axios response interceptor treated a 401 from `/auth/login` (wrong password) as "expired token" and fired the refresh flow; the refresh call's own 401 got queued behind itself inside the interceptor — a deadlock that left the login promise pending forever → infinite spinner instead of an error. The same deadlock froze the app for any user whose session expired. (2) The user's password genuinely WAS wrong — the 2026-07-12 all-users diagnostic reset had orphaned their documented credentials, so every login was correctly rejected… and then displayed as an endless spinner by bug (1).
- **Fix:** interceptor now passes `/auth/login` and `/auth/refresh` 401s straight through (`packages/frontend/src/services/api.ts`); Haier passwords restored to documented values. Browser-verified: wrong password shows "Invalid credentials", right password logs in.
- **Follow-up left open (minor):** CORS allows only the canonical `amanahcx.vercel.app` — logins from Vercel per-deployment preview URLs are silently blocked. Add preview-origin support or keep using the canonical bookmark.

### 0a. Agent dashboard access blocked — fixed; deeper entitlement drift found
- **Verdict:** Done ✅ — 2026-07-10
- **Why it happened:** The dashboard route required an `analytics:read` scope, which reads the `permissions.analytics` value — the same value tenant module-licensing correctly forces to `"none"` for any tenant that hasn't purchased the Analytics module (Haier's real situation: licensed for Core CRM + Ticketing only). The route's own code comment says the home dashboard shouldn't be gated this way, but the scope check silently reintroduced that exact gate.
- **Fix:** Removed the scope requirement from the dashboard route entirely (`packages/api/src/routes/analytics.ts`) — the global auth check already applies to every route, and the home dashboard doesn't need a paid-module permission to load. Verified working for two agents (Amir, Zoya), confirmed independent of their stored permission value (re-tested with it correctly left at `"none"`, matching real licensing — no bypass introduced).
- **Also fixed:** `settings.ts`'s agent default permission for `analytics` changed from `"none"` to `"view"` (matches the pattern already used for managers) — a minor improvement for tenants that *do* have Analytics licensed; module-licensing enforcement still overrides this to `"none"` for tenants that don't, so no bypass either way.
- **New finding, left open:** while tracing this, found a *third*, separate entitlement flag (`tenant.settings.features.analytics`) that exists alongside `tenant.active_modules` and is out of sync with it. Three parallel systems (feature flag, module-licensing array, per-user permission level) all represent "does this tenant have analytics" without being kept in sync — see item 0b below.

### 0b. Three separate, drifted entitlement systems for module access
- **Verdict:** Done ✅ — 2026-07-17 (the `settings.features` half of it; see below)
- **Status:** Audited every real usage of `requireFeature()` (the `settings.features` flag) across the codebase — only 3 routes actually used it (Analytics, Webhooks, Voice-Bot outbound calling), not the widespread problem originally feared. All 3 replaced with `requireModule()` (the actively-maintained `active_modules` source). The third system described below (`user.permissions.<module>`) turned out not to exist as a real feature-gating mechanism on investigation — it was a misreading of the standard RBAC action-permission system (`tickets:read` etc.), which is a different, correctly-functioning thing. So in practice there were 2 real systems, now consolidated to 1.
- **Impact confirmed before fixing:** checked live data across all 24 tenants — 7 were correctly licensed but silently blocked from Analytics/Webhooks/Voice-Bot calling because the abandoned flag was never set for them. This was actively costing tenants working functionality, not just a theoretical drift risk.
- **Why it happened (kept for history):** `tenant.settings.features.<name>` (boolean feature flags) and `tenant.active_modules` (module-licensing array) both separately gated the same 3 routes, with no single source of truth. Confirmed concretely: Haier's `active_modules` correctly excludes `analytics`, but `settings.features.analytics` still returned `true`.

### 0. Database connection was bypassing tenant data isolation (RLS)
- **Verdict:** Done ✅ — 2026-07-10
- **Why:** The API connected to Postgres as a `BYPASSRLS` role, meaning every tenant-isolation policy in the database was silently ignored. A queue belonging to one tenant was leaking onto another tenant's tickets. This is the single most serious class of bug a multi-tenant SaaS product can have.
- **Benchmark:** Non-negotiable — any enterprise security review or penetration test would find and fail this immediately.
- **Detail:** Switched the app to a restricted, non-superuser database role (`crm_app`). Verified the leak is closed both at the raw database level and against the live production app. See `DATABASE_CHANGE_LOG.md`.

### 1. Dashboard — Fix broken analytics / ops dashboard
- **Verdict:** Do Now
- **Status:** Done ✅ — 2026-06-29 (verified working for manager and agent roles; materialized views confirmed present; API returns data for all roles)
- **Detail:** Originally hung due to missing materialized views. Views now exist (`mv_daily_ticket_stats`, `mv_daily_deal_stats`, etc.). Agent + manager dashboards both render correctly.

### 2. SQL Injection Security Patch (Abdurrehman branch)
- **Verdict:** Do Now
- **Why:** Any enterprise procurement / security review will find this. It is a critical vulnerability. No enterprise will buy software with known SQL injection exposure.
- **Benchmark:** Non-negotiable across all CRMs and any SaaS product.
- **Status:** Branch `abdrehman-merge` ready — awaiting merge decision
- **Detail:** Auth bug fixes + SQL injection patch in `abdrehman-merge`. Must be merged before any customer demo or trial.

### 3. Email Deliverability — SendGrid SPF/DKIM authentication
- **Verdict:** Do Now
- **Why:** Onboarding flow sends password emails via SendGrid. If they land in spam, new customers cannot log in. This breaks the entire customer onboarding journey.
- **Benchmark:** All SaaS products configure domain authentication before go-live.
- **Status:** Code done ✅ — DNS setup pending (action required by owner)
- **Detail:** Sender changed to `noreply@vividsns.com`. DNS records (SPF TXT + 2 DKIM CNAMEs) must be added via SendGrid dashboard → Sender Authentication → Authenticate Your Domain. One-time setup.

### 4. CSAT Survey — Customer satisfaction after ticket close
- **Verdict:** Do Now
- **Why:** Enterprise contact centres are bought and judged on customer satisfaction scores.
- **Benchmark:** Zendesk, Freshdesk, Salesforce all ship CSAT as core — not an add-on.
- **Status:** Done ✅ — 2026-06-24
- **Detail:** Public survey page (`/csat/:token`), auto-sent on ticket close, rating shown on ticket panel, list + summary API available. CSAT score visible to managers via `GET /api/v1/tickets/csat/summary`.

### 5. Ticket Queue / Live Wallboard for supervisors
- **Verdict:** Do Now
- **Status:** Done ✅ — 2026-06-29
- **Detail:** Live Wallboard page at `/wallboard` (Analytics → Live Wallboard, managers only). Shows agent status grid, summary strip, SLA breach alert banner, and queue depth panel. Auto-refreshes every 30 seconds.

---

## 🟡 P2 — High (Do Soon — important for serious buyers)

### Super admin must move OUT of the 'demo' workspace — platform-level login
- **Verdict:** Do Soon — agreed with owner 2026-07-13, deliberately deferred to a fresh session (auth changes shouldn't be rushed)
- **Why:** The platform super admin (`admin@demo.com`) is currently a user row *inside* the `demo` tenant and must enter a workspace to log in. Industry standard (Zendesk, Freshdesk, all serious multi-tenant platforms): the platform operator lives in a separate control plane with its own sign-in (no workspace field). Current design muddles demo-tenant data and couples platform identity to a customer-shaped workspace.
- **Scope:** platform accounts without tenant attachment; separate "Platform Administration" sign-in path; JWT/middleware updated so platform identity doesn't ride on a tenant; full auth-flow regression test.

### Voice-bot usage metering, cost reports & AI credit allocation (super admin)
- **Verdict:** Do Soon — agreed with owner 2026-07-13; must exist before onboarding multiple paying voice-bot customers
- **Why:** Every voice call costs the platform real money (LLM + TTS fees), unlike near-zero-cost modules. Owner needs to know what each client costs to price correctly and buy AI credits in the right quantity. Benchmark: Twilio/Retell/Vapi all expose per-account usage + spend dashboards; multi-tenant platforms (e.g. agencies reselling Vapi) meter usage per sub-account.
- **Scope:**
  1. Super admin panel: per-tenant voice minutes/calls + estimated AI cost.
  2. Owner reports: monthly, client-wise cost breakdown.
  3. AI credits: owner purchases centrally, allocates per tenant → implies per-tenant usage caps enforced by the agent.
- **Building blocks already present:** `voice_bot_calls.duration_seconds` per tenant; cost estimation needs token/character metering added at the agent (`services/nadia-voice-agent`).

### Pre-existing TypeScript build errors — restore the safety net
- **Verdict:** Do Soon (hygiene, not urgent) — logged 2026-07-13
- **Why:** `npm run build` fails on ~20 pre-existing type errors in `@crm/core` (email/sms services, tsconfig rootDir) and several frontend pages (Tickets, MilestoneSettings, VoiceCalls). Deploys aren't blocked (Vercel runs `vite build` directly; Railway also skips the failing step) — but with the checker permanently red, a *real* new mistake can hide in the noise. Roughly a half-session of tidy-up.

### Nadia (self-hosted LiveKit voice agent) — SIP trunk + tuning
- **Verdict:** Do Soon
- **Status:** In progress — 2026-07-13. Core pipeline built and tested (STT/LLM/TTS loop, real
  ticket creation, HBL MFB complaint flow). See `CHANGE_LOG.md` 2026-07-13.
- **Remaining:**
  - Connect Telecard's SIP trunk once credentials arrive (currently only reachable via a
    browser test page, not a real phone number).
  - Move off this Mac (CPU-only) onto a real GPU server — self-hosted Whisper is currently
    running the "small" model on CPU; "large-v3" + GPU will meaningfully improve Urdu/Minglish
    accuracy and reduce response latency.
  - Voice-quality tuning: currently using Uplift AI's stock `helpdesk-agent` voice; the
    client's previous Retell AI setup used a custom-cloned voice with noticeably better
    quality — worth evaluating whether a similar custom voice clone is worth pursuing for
    Nadia specifically.
  - Our own speed-control implementation (ffmpeg time-stretch, since Uplift has no native
    rate parameter) buffers the entire reply before playing it — trades against response
    latency. A user-reported mid-speech audio glitch is being isolated against this (reverted
    to 1.0x speed temporarily to test) — not yet confirmed root cause.
  - No dedicated CRM tenant for HBL MFB yet — currently testing against the generic "First
    National Bank" demo tenant.

### 6. Holiday SLA pause — wire into deadline calculation engine
- **Verdict:** Do Soon
- **Status:** Done ✅ — 2026-06-24
- **Detail:** SLA deadlines now skip weekends, non-working hours, and public holidays. Tested with late-day, end-of-week, and holiday scenarios — all correct.

### 7. SLA Breach Notifications — in-app + email alerts
- **Verdict:** Do Soon
- **Why:** SLA escalation steps are configured but if notifications aren't delivered (email or in-app), the escalation feature has no teeth. Enterprise buyers specifically ask "what happens when SLA is breached?"
- **Benchmark:** Zendesk sends email + in-app. Freshdesk adds webhook. Both are standard.
- **Status:** Done ✅ — 2026-06-24
- **Detail:** All three escalation stages now send both in-app notification AND email. Stage 1 (warning at 80%): emails the assigned agent. Stage 2 (SLA breach at 100%): emails the agent + all managers. Stage 3 (critical escalation at 150%): emails all tenant admins. Worker runs every 5 minutes automatically.

### 8. Reports Module — SLA performance, ticket volume, agent stats
- **Verdict:** Do Soon
- **Why:** Every enterprise buyer asks for reporting. "How do I know my team is performing?" Without reports the product feels incomplete. Listed in product modules but needs confirmation it works.
- **Benchmark:** All top CRMs ship basic reports: SLA compliance %, ticket volume by channel/dept, first reply time, resolution time.
- **Status:** Done ✅ — 2026-06-24
- **Detail:** Full Ticket Reports page now live for managers. Includes: 6 KPI cards (total tickets, resolved, SLA compliance %, avg resolution time, avg first response time, escalation rate), ticket volume chart over time, SLA performance trend chart, tickets by priority (donut), tickets by channel (donut), top issue categories with avg resolution time and breach rate, tickets by type, and repeat reporters list. Period selector (7d / 30d / 90d / 6m) and CSV export included. Sales Reports (invoices, aging, customer-wise) and Team Activity Report were already working.

### 9. Agent Status — Online / Away / Busy / Offline
- **Verdict:** Do Soon
- **Status:** Done ✅ — 2026-06-29
- **Detail:** Agents set status from sidebar picker. Colored dot reflects status. Push routing skips Offline/Away agents. Migration 032.

### 10. Named Business Hour Profiles (per-department)
- **Verdict:** Do Soon
- **Status:** Done ✅ — 2026-06-29
- **Detail:** Business Hours tab in SLA Policies. Managers create named schedules with per-day open/close times, scoped to departments. Migration 033.

---

## 🟢 P3 — Medium (Backlog — good to have, post-core)

### 10a. Voice bot monthly cost tracking
- **Verdict:** Done ✅ — 2026-07-17
- **What:** Per-tenant `cost_per_minute` rate + a Super Admin cross-tenant monthly cost report, computed live from call duration. Live-verified against real call data.

### 10b. Nadia — hold-message during ticket creation
- **Verdict:** Built, unverified by ear — 2026-07-17
- **What:** A short spoken line now plays (non-blocking) while `raise_ticket`'s ~2s API call is in flight, instead of leaving the caller in silence.
- **Status:** Code compiles; cannot be verified without an actual phone call — add to the standing Nadia SIP trunk test checklist as the first thing to listen for.

### 10c. Nadia — streaming speed / reply-pause coupling
- **Verdict:** Still open — re-confirmed 2026-07-17, deliberately not touched
- **Why:** Re-checked the actual TTS code: it only avoids full-reply buffering at the *default* speaking rate; any tenant with a custom rate still pays the described delay. Not fixed blind — audio DSP changes (clicking, pitch artifacts) can't be verified without hearing them, and this pipeline hasn't been live-call-tested at all yet. Needs a human listening to changes before this is safe to touch.

### 10d. Nadia standalone-product spin-off
- **Verdict:** Not a code task — needs a scoping conversation
- **Why:** Pricing model, multi-tenant isolation for non-AmanahCX customers, and separate billing are business/architecture decisions that should be made before any implementation starts.

### 10e. Mobile app offline scanner
- **Verdict:** Already done — confirmed 2026-07-17, no work needed
- **Why:** On-device OCR (`@react-native-ml-kit/text-recognition`) was already built as the offline fallback for the business-card scanner, with graceful online/offline handoff and offline-queue sync already wired up. Closing this out — it should not have been on the open list.

### 11. First Reply Time — display on ticket detail page
- **Verdict:** Backlog
- **Why:** Column is stamped, data exists. Just needs a UI metric card on the ticket. Low effort, not blocking.
- **Status:** DB done. UI not built.

### 12. SLA Breach Webhook — notify external URL
- **Verdict:** Backlog
- **Why:** Useful for integrations but not needed to sell to first customers.
- **Benchmark:** Freshdesk has it. Zendesk has it via triggers. Not expected on day one.
- **Status:** Not Started

### 13. Department foreign key (`department_id` on users)
- **Verdict:** Backlog
- **Why:** Current text-based department link works but is fragile. Important for long-term data integrity. Not visible to buyers.
- **Status:** Not Started

### 14. Company-wide operational manager role (cross-department view)
- **Verdict:** Backlog
- **Why:** Niche requirement. Some enterprise orgs want it but it's not a blocking gap.
- **Status:** Not Started

---

### 14b. Marketing/bulk WhatsApp sends — strict consent gate
- **Verdict:** Do when WhatsApp marketing is built (blocker for that feature, not for current ops)
- **Status:** Foundation done ✅ 2026-07-12 — consent tracking + ticket-reply gate live; the bulk-send feature itself doesn't exist yet
- **Why:** Meta suspends WhatsApp Business API access for un-consented business-initiated messages. Per-channel consent tracking (`contact_channel_consent`) and the ticket-reply opt-out gate shipped 2026-07-12.
- **Detail:** When bulk/marketing sends are built, they must call `getChannelConsent()` (`packages/api/src/lib/consent.ts`) and only send where it returns `true` — for marketing, "no record" = NO send (stricter than ticket replies, where the customer choosing the channel is itself the opt-in).

### 14c. Dead super_admin references in route-level role checks
- **Verdict:** Post-launch — cosmetic only
- **Status:** Deprioritised by decision 2026-07-12
- **Detail:** ~12+ unreachable `super_admin` mentions in `requireRole()`/inline role arrays across `tickets.ts`, `contacts.ts`, `analytics.ts`, `voice-bot.ts`, `connectors.ts`. The middleware wall (commit b854929) blocks super_admin before any of these are evaluated — zero functional/security impact. Clean up only as part of a broader tech-debt pass.

### 14d. Nadia voice bot — decouple speaking speed from reply pause
- **Verdict:** Do Soon — user-facing quality issue, deliberately deferred to its own session
- **Status:** Not started
- **Why:** Current TTS speed control buffers the ENTIRE reply and runs one ffmpeg time-stretch pass before playback starts, so any speed != 1.0 adds pause. Needs per-chunk streaming time-stretch. Location: `services/nadia-voice-agent/src/agent.py` (`tts_node`), `audio_speed.py`.

### 14e. Nadia voice bot — hold/filler message during ticket creation
- **Verdict:** Do Soon — deliberately deferred to its own session
- **Status:** Not started
- **Why:** Even at the optimized ~2.2s, dead air during the `raise_ticket` tool call feels broken. Play a short recorded/synth hold line, auto-stop the instant she resumes speaking. Location: `services/nadia-voice-agent/src/agent.py` (`NadiaAgent.raise_ticket`) — check LiveKit Agents docs for a built-in filler-speech-during-tool-call pattern first.

### 14f. Nadia voice bot — admin portal roadmap (phase 1 + 2 done 2026-07-13)
- **Verdict:** Building incrementally, easy items first
- **Done 2026-07-13 (phase 1):** SIP trunk config fields, database-backed voice catalog (super admin managed), tenant-defined custom "no-ticket" reasons. See CHANGE_LOG Push 7.
- **Done 2026-07-13 (phase 2):** Minutes-consumed/remaining visibility for tenant admin (with period filter) and super admin (per-tenant, plus top-up with audit history). See CHANGE_LOG Push 8. Super-admin UI verified by code review + SQL simulation only — not yet click-tested live (no super admin password on hand); worth a quick live pass together next session.
- **Next, in order:**
  - Auto-cutoff + route to human when a tenant's minutes run out — Hard/riskiest: real-time enforcement inside a live call, must not risk cutting off a real customer on a bug
  - Call recording — needs a POLICY DECISION first (see below), not just build effort
  - Knowledge base for the agent to consult mid-call — hardest item, sequence last
- **Recording policy question (open):** default to transcript only (already free/stored); make raw audio recording an explicit per-tenant opt-in toggle, since Pakistan generally expects an audible consent notice for recorded calls and audio storage has real ongoing cost. Decide before building item 8.

## 🔵 P4 — Low (Post-launch / on-request)

### 15. Pitch deck — embed Vivid Solutions logo image
- **Verdict:** Post-launch
- **Status:** Not Started

### 16. Clean up empty module scaffolds (`modules/companies`, `modules/email`)
- **Verdict:** Post-launch — internal housekeeping only
- **Status:** Not Started

---

## ✅ Completed (moved from backlog)

- Per-channel consent tracking (WhatsApp/SMS/Email) + Consent tab + reply-dispatch opt-out gate — DONE 2026-07-12
- Sector auto-provisioning: sector choice now seeds default modules/features at tenant creation — DONE 2026-07-12
- Webhook delivery pipeline RLS fix (Test button + background worker + dead-letter replay) — DONE 2026-07-12
- Routing & SLA settings opened to managers (operational config, benchmarked) — DONE 2026-07-12
- SMS-failure admin alert column mismatch (`message` → `body`) — DONE 2026-07-12
- Email deliverability — sender changed to noreply@vividsns.com — DONE 2026-06-24 (DNS records pending owner action)
- Holiday SLA engine — deadlines now skip holidays, weekends, non-working hours — DONE 2026-06-24
- CSAT Survey — full end-to-end flow (public page, auto-send, ticket panel, API) — DONE 2026-06-24
- Holiday Calendar — DONE 2026-06-24
- First Reply Time metric (DB + stamping) — DONE 2026-06-24
- Smart Policy Matching — DONE 2026-06-24
- SLA Policies full CRUD — DONE 2026-06-24
- Business Hours per policy — DONE 2026-06-24
- Pause on Pending — DONE 2026-06-24
- Entitlements (Phase 1, 2a, 2b) — DONE 2026-06-24
- Role permissions ceiling — DONE 2026-06-24
- Tenant admin operational lockout — DONE 2026-06-24
- CRM visibility scoping (line-manager tree) — DONE 2026-06-24
- Sales ticket → deal conversion — DONE 2026-06-24
- Ticket visibility guards (department-scoped, hierarchy-aware) — DONE 2026-06-24
- Cross-department originator view (read-only after acceptance, "👁 View only" badge, write blocked) — DONE 2026-06-24
- Complaints Manager created — correct 3-department hierarchy (Support/Complaints/Sales each with own manager) — DONE 2026-06-24
- Reports hub — 10 downloadable CSV reports (6 manager, 4 agent) — DONE 2026-06-24
- Ops Dashboard KPI strip (CSAT, SLA %, avg resolution, avg first response) — DONE 2026-06-24
- Analytics sidebar collapsible section (Ops Dashboard + Ticket Reports sub-links) — DONE 2026-06-24
- Multi-field ticket search (mobile, NIC, name, phone) — DONE 2026-06-24
- Clickable customer name → Customer 360 contact record — DONE 2026-06-24
- Any-agent internal note on any ticket (callback context) — DONE 2026-06-24
- NIC number field on contacts (migration 031) — DONE 2026-06-24
- Contact 360 cross-dept ticket view (all departments visible on customer record) — DONE 2026-06-28
- Agent dashboard fix (0 tickets shown — deptTicketFilter + analytics permission) — DONE 2026-06-28
- Line managers created for all 3 departments (Support / Sales / Complaints) — DONE 2026-06-28
- Department-scoped Line Manager dropdown on Invite & Edit (only same-dept managers shown) — DONE 2026-06-28
- Role display names in Invite form (org's own hierarchy names shown in manager dropdown label) — DONE 2026-06-28
- AmanahCX platform rebrand (login, sidebar, email footers) — DONE 2026-06-28
- Ticket-contact linking (mandatory contact on every ticket, contact search by phone/mobile/NIC) — DONE 2026-06-29
- Policy Admin governance role — SLA write access isolated to policy_admin only; manager + tenant_admin blocked (403); governed_departments scope; ticket_type department tag on policies; purple badge on SLA card — DONE 2026-06-29
- NIC number on Contact 360 profile panel — DONE 2026-06-29
- Clickable tickets on Contact 360 (opens ticket panel directly) — DONE 2026-06-29
- Manager ticket edit after acceptance (all fields editable post-handoff) — DONE 2026-07-01
- Contact search by phone/NIC/name/email — DONE 2026-07-01
- Tenant admin hard-delete on closed tickets only (guard at API level) — DONE 2026-07-01
- SLA governance guardrail: mandatory written reason for priority changes, distinct `priority_changed` audit entry — DONE 2026-07-01
- Reassignment audit: optional reason for agent reassignment, distinct `assignee_changed` audit entry — DONE 2026-07-01
- AmanahCX-Roles-and-Flow.html: exhaustive role permissions + end-to-end voice bot→resolution flow — DONE 2026-07-01
- Agent → Manager escalation (G-P3): escalate button + reason, orange badge for manager, acknowledge to clear, full audit log — DONE 2026-07-02
- Sector-specific ticket custom fields: banking fields (Case Type, Transaction Ref, Amount, Regulatory Deadline, CB Ref #) in New Ticket form + detail panel — DONE 2026-07-02
- Auto-seeding sector fields at tenant creation: all 4 entity types (contact/ticket/deal/company) provisioned automatically on sector selection — DONE 2026-07-02
- Mobile: voice lead capture (mic → speech-to-text → AI field extraction → confirm dialog before CRM push) — DONE 2026-07-06
- Mobile: confirm-details dialog before every lead push to CRM — DONE 2026-07-06
- [P2] Mobile: file/photo attachments on contacts & deals (needs cloud file storage — build with cloud deployment)
- [P3] Company from card/voice scan → real company record instead of tag
- Mobile: voice-created tasks (mic → AI parse w/ due-date + priority + auto contact-link → confirm dialog → activities API, offline queue support) — DONE 2026-07-06
- Mobile: voice language selector (EN/اردو/ਪੰਜਾਬੀ, remembered per device) + AI transliteration to English CRM records; Urdu tested incl. Urdu-script digits — DONE 2026-07-06
- Aging of Receivables table on Sales Dashboard (6 time buckets, per customer, sorted by balance) — DONE 2026-07-06
- Quotations module: create/list/convert to invoice, totals excluded until converted, Open Quotations KPI card on dashboard — DONE 2026-07-06
- Invoice template fix: 3 structurally distinct layouts (minimal, consulting, classic) — DONE 2026-07-06
- Invoice Builder drag-drop fix: palette items now drop onto canvas that already has elements — DONE 2026-07-06
- Voice Bot Self-Service configuration (G-F3): tenant admin can configure up to 8 self-service menu items from Settings — DONE 2026-07-06
- Database connection bypassing tenant isolation (RLS) — fixed by switching to a restricted, non-superuser DB role — DONE 2026-07-10
- Auto-contact-creation on ticket creation (find existing by email/phone, else create) — manual + voice bot tickets — DONE 2026-07-10
- Manager visibility of unclaimed/unassigned tickets in their team's queue — DONE 2026-07-10
- Dashboard quick-action buttons filtered by tenant's licensed modules — DONE 2026-07-10
- Vercel reconnected to the correct repo + auto-deploy enabled (previously required manual deploy) — DONE 2026-07-10
- Mobile: field-visit flow (My Tasks, GPS check-in, complete w/ remarks + GPS, customer auto-email) — BUILT & TESTED 2026-07-11 (email release pending SendGrid DNS)
- Mobile work recovered from parallel-session git stash; re-tested vs Supabase cloud backend, 8/8 tests pass — 2026-07-11
- [P1] Manager field-team day view: today's agenda per officer, leads assigned/approached/locked
- [P2] Last-sync indicator on mobile dashboard + desktop CRM (per field device)
- [P2] Mirror field completion remarks to linked ticket timeline + Contact 360
- Mobile live phone test round 1 (2026-07-12): check-in/complete w/ real GPS PASS; fixed sector-required-fields blocking quick capture, stuck voice button, card-scan name/mobile accuracy; New Lead/Task buttons on My Tasks
- [P2] Render sector-required fields dynamically on mobile lead form (full capture instead of exemption)
- [P3] Investigate per-device speech recognition availability matrix (Google app dependency)
